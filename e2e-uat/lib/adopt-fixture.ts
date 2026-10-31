// Adopts an ALREADY-CLAIMED Merchant+Partner pair as the operational fixture, but only if it is provably a same-run pair:
// records named UAT-E2E-M-<run> / UAT-E2E-P-<run> with the same <run>, both bound to those records, both active, and the
// application itself reports the partner as assigned_to_this_merchant. Anything else is refused (no substitution).
import { api, useIdentity } from './api';
import { creds, poolFor, Cred, loadEnvFile } from './env';
import { readFixture, sha256, writeFixture } from './fixture';
import { makePng } from './images';
import fs from 'node:fs'; import path from 'node:path';

(async () => {
  loadEnvFile();
  const pool = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.auth', 'identity-pool.json'), 'utf8'));
  const all = (role: 'merchant' | 'partner'): Cred[] => [...(pool[role] ?? []), ...(creds(role) ? [creds(role)!] : [])];
  const seen = new Map<string, Cred>(); for (const r of ['merchant', 'partner'] as const) for (const c of all(r)) seen.set(c.email, c);
  const found: { merchant: { c: Cred; rec: string }[]; partner: { c: Cred; rec: string }[] } = { merchant: [], partner: [] };
  for (const c of seen.values()) {
    useIdentity('merchant', c); const me = (await api('merchant', 'GET', '/user-profiles/me')).body;
    if (me?.role === 'merchant' && me.merchant_id) found.merchant.push({ c, rec: me.merchant_id });
    if (me?.role === 'collaborator' && me.collaborator_id) found.partner.push({ c, rec: me.collaborator_id });
  }
  const dir = async (id: string) => (await api('admin', 'GET', `/merchants/${id}`)).body?.merchant_name as string | undefined;
  const pname = async (id: string) => { const b: any = (await api('admin', 'GET', '/collaborators')).body; return (Array.isArray(b) ? b : b?.items ?? []).find((x: any) => x.id === id); };
  for (const m of found.merchant) for (const p of found.partner) {
    const mn = await dir(m.rec); const pr = await pname(p.rec); const mr = mn?.match(/^UAT-E2E-M-(.+)$/)?.[1]; const prr = pr?.collaborators_name?.match(/^UAT-E2E-P-(.+)$/)?.[1];
    if (!mr || mr !== prr) continue;
    useIdentity('merchant', m.c); useIdentity('partner', p.c);
    const assoc = (await api('merchant', 'POST', '/qr/resolve', { payload: pr.collaborators_code })).body?.association;
    const act = [(await api('merchant', 'GET', '/user-profiles/me')).body?.user_profiles_status, (await api('partner', 'GET', '/user-profiles/me')).body?.user_profiles_status];
    if (assoc !== 'assigned_to_this_merchant' || act.some((a) => a !== 'active')) { console.log(`run ${mr}: not usable (assoc=${assoc}, status=${act})`); continue; }
    writeFixture({ run: mr, merchantId: m.rec, partnerId: p.rec, partnerCode: pr.collaborators_code, merchant: m.c, partner: p.c, merchantImageSha: sha256(makePng(`m${mr}`)), partnerImageSha: sha256(makePng(`p${mr}`, 256, 256)) });
    console.log(`ADOPTED same-run pair from run ${mr} (merchant ${m.rec}, partner ${p.rec})`); return;
  }
  console.log('NO valid same-run pair found; fixture not written'); void readFixture; void poolFor;
})();
