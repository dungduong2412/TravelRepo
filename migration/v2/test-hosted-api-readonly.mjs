#!/usr/bin/env node
// Read-only verification of the imported Snapshot-5 data THROUGH THE DEPLOYED UAT APPLICATION API (not the database).
//   * admin lists: Merchants, Partners (collaborators), transactions; V1 rows match the sealed snapshot amount-for-amount
//   * approved media: public GET /media/approved/:ownerType/:ownerId returns every owner-linked asset; each signed URL is downloaded and
//     its SHA-256 / size compared with the sealed media checksum
// Signs in once with the synthetic UAT admin from e2e-uat/.env.uat.local (the same identity the UAT E2E suite uses). No writes are issued.
// Usage: test-hosted-api-readonly.mjs <snapshot-dir> <evidence.json>   env: VNO_TARGET_URL, VNO_TARGET_SERVICE_ROLE_KEY (REST reads for expectations)
// Evidence holds ids, counts and hashes only (no names, e-mails, phones or bank data).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [snapDir, evidenceOut] = process.argv.slice(2);
const SUPA = process.env.VNO_TARGET_URL, KEY = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
if (!snapDir || !evidenceOut || !SUPA || !KEY) throw new Error('usage: test-hosted-api-readonly.mjs <snapshot-dir> <evidence.json>; VNO_TARGET_URL and VNO_TARGET_SERVICE_ROLE_KEY required');
if (new URL(SUPA).hostname !== 'hsezyogfxgnkpweoqqny.supabase.co') throw new Error('refusing: not the approved UAT Supabase project');
const API = 'https://vno-api-uat.up.railway.app';
const TENANT = 'b7688a1c-23f9-637d-c2fb-3a16eb1befd2';
const lower = (v) => (v == null ? null : String(v).toLowerCase());
const sha = (b) => createHash('sha256').update(b).digest('hex');
const dec4 = (v) => { const [w, f = ''] = String(v ?? 0).split('.'); const neg = String(v).startsWith('-'); const n = BigInt(w.replace('-', '')) * 10000n + BigInt((f + '0000').slice(0, 4)); return neg ? -n : n; };
const fmt4 = (n) => `${n / 10000n}.${String(n % 10000n).padStart(4, '0')}`;
const jl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const checks = [];
const check = (id, name, pass, evidence) => { checks.push({ id, name, status: pass ? 'PASS' : 'FAIL', evidence }); console.error(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${JSON.stringify(evidence).slice(0, 220)}`); };
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function rest(path) { const rows = []; for (let off = 0; ; off += 1000) { const r = await fetch(`${SUPA}/rest/v1/${path}&limit=1000&offset=${off}`, { headers: H }); if (!r.ok) throw new Error(`GET ${path.split('?')[0]} ${r.status}`); const j = await r.json(); rows.push(...j); if (j.length < 1000) break; } return rows; }

// ---- sign in as the synthetic admin ----
const envLocal = Object.fromEntries(readFileSync(new URL('../../e2e-uat/.env.uat.local', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim().replace(/^"|"$/g, '')]; }));
const rootEnv = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()]; }));
const tok = await (await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: envLocal.E2E_SUPABASE_ANON_KEY || rootEnv.SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: envLocal.E2E_ADMIN_EMAIL, password: envLocal.E2E_ADMIN_PASSWORD }) })).json();
if (!tok.access_token) throw new Error('synthetic admin sign-in failed');
const get = async (route, { auth = true } = {}) => { const r = await fetch(`${API}${route}`, { headers: auth ? { Authorization: `Bearer ${tok.access_token}` } : {}, signal: AbortSignal.timeout(120_000) }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } return { status: r.status, json }; };

// ---- sealed expectations ----
const restaurants = jl(join(snapDir, 'tables/Emos_MdmService/dbo.Restaurant.jsonl'));
const partners = jl(join(snapDir, 'tables/Emos_MdmService/dbo.RestaurantMiddleman.jsonl'));
const txSrc = jl(join(snapDir, 'tables/Emos_MdmService/dbo.RestaurantComTrack.jsonl'));
const orphanIds = new Set(JSON.parse(readFileSync(join(snapDir, 'orphan-transaction-mapping.json'), 'utf8')).transactions.map((o) => o.transaction_id));

// A1-A3: admin lists
const [merchants, collabs, txs] = await Promise.all([get('/merchants'), get('/collaborators'), get('/transactions')]);
const mById = new Map((merchants.json || []).map((m) => [lower(m.merchant_system_id), m]));
const cById = new Map((collabs.json || []).map((c) => [lower(c.id), c]));
check('A1', 'API /merchants lists all 140 migrated Merchants (+19 pre-existing)', merchants.status === 200 && merchants.json.length === 159 && restaurants.every((r) => mById.has(lower(r.Id))), { status: merchants.status, total: merchants.json?.length, v1_present: restaurants.filter((r) => mById.has(lower(r.Id))).length });
check('A2', 'API /collaborators lists all 312 migrated Partners (+19 pre-existing)', collabs.status === 200 && collabs.json.length === 331 && partners.every((p) => cById.has(lower(p.Id))), { status: collabs.status, total: collabs.json?.length, v1_present: partners.filter((p) => cById.has(lower(p.Id))).length });
const apiTx = new Map((txs.json || []).filter((t) => lower(t.legacy_tenant_id) === TENANT || t.legacy_transaction_id).map((t) => [lower(t.legacy_transaction_id), t]));
const txBad = txSrc.filter((s) => { const t = apiTx.get(lower(s.Id)); return !t || fmt4(dec4(t.document_total)) !== fmt4(dec4(s.DocTotal)) || fmt4(dec4(t.document_discount_amount)) !== fmt4(dec4(s.DocDiscountAmt)) || fmt4(dec4(t.commission_amount)) !== fmt4(dec4(s.CommissionAmt)) || String(t.legacy_status) !== String(s.Status); }).map((s) => lower(s.Id));
const apiOrphans = txSrc.filter((s) => orphanIds.has(lower(s.Id))).filter((s) => { const t = apiTx.get(lower(s.Id)); return t && t.merchant_id === null; }).length;
const apiTotal = txSrc.reduce((a, s) => a + dec4(apiTx.get(lower(s.Id))?.document_total), 0n);
check('A3', 'API /transactions: all 105 historical transactions equal V1 amount-for-amount and status; total 380705162.0000 VND; 3 orphans kept with merchant link null', txs.status === 200 && txs.json.length === 114 && txBad.length === 0 && fmt4(apiTotal) === '380705162.0000' && apiOrphans === 3, { status: txs.status, listed: txs.json?.length, mismatched: txBad.length, total_vnd: fmt4(apiTotal), orphans: apiOrphans });

// A4: approved media through the public API, signed URL -> bytes -> SHA-256
const assets = await rest(`media_assets?select=id,merchant_id,collaborator_id,sha256_hex,size_bytes,publication_status,transfer_status&legacy_tenant_id=eq.${TENANT}`);
const owned = assets.filter((a) => a.merchant_id || a.collaborator_id);
const owners = new Map(); for (const a of owned) { const k = a.merchant_id ? `merchant/${a.merchant_id}` : `collaborator/${a.collaborator_id}`; owners.set(k, [...(owners.get(k) || []), a]); }
let urlsChecked = 0, bytesChecked = 0; const mediaBad = [];
for (const [k, list] of owners) {
  const r = await get(`/media/approved/${k}`, { auth: false });
  const got = new Map((r.json || []).map((x) => [lower(x.id), x]));
  for (const a of list) {
    const x = got.get(lower(a.id));
    if (r.status !== 200 || !x || x.sha256_hex !== a.sha256_hex) { mediaBad.push({ owner: k, id: a.id, reason: 'not returned by approved API' }); continue; }
    const d = await fetch(x.signed_url, { signal: AbortSignal.timeout(120_000) });
    const b = d.ok ? Buffer.from(await d.arrayBuffer()) : null;
    if (!b || sha(b) !== a.sha256_hex || b.length !== Number(a.size_bytes)) mediaBad.push({ owner: k, id: a.id, reason: `signed url download ${d.status}` }); else { urlsChecked++; bytesChecked += b.length; }
  }
}
check('A4', 'approved media through GET /media/approved/...: every owner-linked V1 asset is returned and its signed-URL bytes match the sealed SHA-256 and size', mediaBad.length === 0 && urlsChecked === owned.length && owned.length > 0, { owners: owners.size, assets_linked_to_owners: owned.length, verified_via_signed_url: urlsChecked, bytes: bytesChecked, failures: mediaBad.slice(0, 5) });
const adminMedia = await get('/media');
check('A5', 'API /media (admin) lists every media asset: 14 pre-existing + 602 imported', adminMedia.status === 200 && adminMedia.json.length === 616, { status: adminMedia.status, total: adminMedia.json?.length });

const out = { generated_utc: new Date().toISOString(), api: API, pass: checks.filter((c) => c.status === 'PASS').length, fail: checks.filter((c) => c.status === 'FAIL').length, checks };
writeFileSync(evidenceOut, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ pass: out.pass, fail: out.fail }));
process.exit(out.fail ? 1 : 0);
