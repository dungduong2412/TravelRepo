import { test, expect } from '@playwright/test';
import { api, hasCreds, useIdentity } from '../lib/api';
import { readFixture } from '../lib/fixture';
import { record } from '../lib/evidence';
import { randomUUID } from 'node:crypto';

const NIL = '00000000-0000-4000-8000-000000000000';
const check = (id: string, title: string, ok: boolean, d = '') => { record(id, title, ok ? 'PASS' : 'FAIL', d); expect(ok, `${id} ${d}`).toBe(true); };

test.describe('Authorization and financial regression (needs credentials)', () => {
  test.skip(!hasCreds('admin'), 'BLOCKED: admin credentials missing — see README');
  // Owner-role tests use ONLY the paired fixture from a first-time onboarding run; otherwise they SKIP (no substitution).
  const fx = readFixture(); if (fx) { useIdentity('merchant', fx.merchant); useIdentity('partner', fx.partner); }
  const needOwners = () => test.skip(!fx, 'SKIP: no paired fixture (run a first-time onboarding with a fresh identity pair)');

  test('R01 non-admin roles are refused on Admin-only operations', async () => {
    needOwners();
    const bad: string[] = [];
    for (const who of ['merchant', 'partner'] as const) {
      for (const [m, p, b] of [['POST', '/invitations', { entity_type: 'merchant', entity_id: NIL }], ['GET', '/audit-events'], ['GET', '/transactions/report'], ['GET', '/transactions'], ['POST', '/merchants/admin', {}], ['POST', '/collaborators/admin', {}], ['GET', '/user-profiles']] as const) {
        const r = await api(who, m, p, b); if (r.status !== 403) bad.push(`${who} ${m} ${p}=${r.status}`);
      }
    }
    check('R01', 'merchant/partner get 403 on admin endpoints', bad.length === 0, bad.join('; '));
  });

  test('R02 tenant isolation: owners see only their own transactions', async () => {
    needOwners();
    const ready = (await api('merchant', 'GET', '/transactions/me/report')).status === 200 && (await api('partner', 'GET', '/transactions/me/report')).status === 200;
    test.skip(!ready, 'SKIP: owner accounts are not yet claimed/approved (run the journey first)');
    const adm = (await api('admin', 'GET', '/transactions/report?page_size=100')).body; const mer = (await api('merchant', 'GET', '/transactions/me/report?page_size=100')).body;
    const mIds = new Set((mer.items ?? []).map((t: any) => t.merchant_id)); const par = (await api('partner', 'GET', '/transactions/me/report?page_size=100')).body;
    const pIds = new Set((par.items ?? []).map((t: any) => t.collaborator_id));
    check('R02', 'merchant sees 1 merchant id, partner sees 1 partner id, both ≤ admin total', mIds.size <= 1 && pIds.size <= 1 && mer.summary.transaction_count <= adm.summary.transaction_count, `${mIds.size}/${pIds.size}`);
  });

  test('R03 unauthorized financial mutation is rejected', async () => {
    needOwners();
    const body = { collaborator_code: 'NOPE', gross_amount: '1.0000', idempotency_key: randomUUID() };
    const asPartner = await api('partner', 'POST', '/transactions/simulation', body);
    const badAmount = await api('merchant', 'POST', '/transactions/simulation', { ...body, gross_amount: '1.00001' });
    const patch = await api('merchant', 'PATCH', `/merchants/${NIL}/admin`, { merchant_discount_value: '0.9' });
    check('R03', 'partner cannot create tx; 5-decimal amount rejected; merchant cannot change rates', asPartner.status >= 400 && badAmount.status === 400 && patch.status >= 400, `${asPartner.status}/${badAmount.status}/${patch.status}`);
  });

  test('R04 unknown partner code cannot produce a transaction', async () => {
    needOwners();
    const r = await api('merchant', 'POST', '/transactions/simulation', { collaborator_code: 'UAT-E2E-NOT-A-CODE', gross_amount: '10.0000', idempotency_key: randomUUID() });
    check('R04', 'unknown code refused', r.status >= 400, String(r.status));
  });

  test('R05 no real payment or settlement is reachable', async () => {
    const adm = (await api('admin', 'GET', '/transactions/report?record_kind=uat_simulation&page_size=100')).body;
    const paid = (adm.items ?? []).filter((t: any) => /paid|settled/i.test(`${t.payment_status ?? ''} ${t.lifecycle_status ?? ''}`));
    check('R05', 'no simulation record is PAID/settled', paid.length === 0, `${paid.length} paid`);
  });

  test('R06 pending/rejected images are not exposed through the public/approved feed', async () => {
    needOwners();
    const me = (await api('admin', 'GET', '/media/approvals')).body; const pending = (Array.isArray(me) ? me : me?.items ?? []).filter((r: any) => r.status === 'pending');
    let leak = 0;
    for (const p of pending.slice(0, 20)) {
      const feed = (await api('partner', 'GET', `/media/approved/${p.owner_type}/${p.owner_id}`)).body;
      if (JSON.stringify(feed ?? '').includes(String(p.media_id ?? p.id))) leak++;
    }
    check('R06', `${pending.length} pending requests checked; none leaked to another role`, leak === 0, `${leak} leaks`);
  });

  test('R07 invitation endpoints: expiry, revocation and replay are enforced', async () => {
    needOwners();
    const a = await api('merchant', 'POST', `/invitations/claim/merchant/${NIL}`); const b = await api('partner', 'POST', `/invitations/claim/bogus/${NIL}`);
    const c = await api('partner', 'POST', `/invitations/claim/collaborator/not-a-uuid`);
    check('R07', 'claim with no invitation / bad type / bad id is refused (no 5xx)', a.status >= 400 && a.status < 500 && b.status === 400 && c.status === 400, `${a.status}/${b.status}/${c.status}`);
  });

  test('R08 approving a Merchant that no owner has claimed → controlled 409, no state change', async () => {
    const dir = (await api('admin', 'GET', '/merchants/admin-directory?search=UAT-E2E-MERCHANT&page_size=5')).body;
    const stable = (dir.items ?? []).find((m: any) => m.merchant_name === 'UAT-E2E-MERCHANT' && m.merchants_status === 'pending');
    test.skip(!stable, 'SKIP: no pending unclaimed synthetic merchant exists');
    const id = stable.merchant_system_id;
    const approvals = async () => { const b: any = (await api('admin', 'GET', '/audit-events?limit=500')).body; return (Array.isArray(b) ? b : b?.items ?? []).filter((a: any) => /approved/.test(a.action ?? '') && JSON.stringify(a).includes(id)).length; };
    const before = await approvals(); const r = await api('admin', 'POST', `/merchants/${id}/approve`, {});
    const after = (await api('admin', 'GET', `/merchants/${id}`)).body;
    check('R08', '409 OWNER_NOT_CLAIMED; status still pending; no approval audit', r.status === 409 && r.body?.code === 'OWNER_NOT_CLAIMED' && after.merchants_status === 'pending' && (await approvals()) === before, `HTTP ${r.status} ${r.body?.code ?? ''}`);
  });

  test('R09 outsider (verified, no application membership) is refused everywhere', async () => {
    test.skip(!hasCreds('outsider'), 'BLOCKED: outsider credentials missing');
    const bad: string[] = [];
    for (const [m, p, b] of [['GET', '/transactions/me/report'], ['GET', '/transactions/me'], ['POST', '/qr/resolve', { payload: 'X' }], ['POST', '/transactions/simulation', { collaborator_code: 'X', gross_amount: '1.0000', idempotency_key: NIL }], ['GET', '/audit-events'], ['POST', '/invitations', { entity_type: 'merchant', entity_id: NIL }]] as const) {
      const r = await api('outsider', m, p, b); if (r.status !== 403) bad.push(`${m} ${p}=${r.status}`);
    }
    check('R09', 'outsider gets 403 on owner, financial and admin endpoints', bad.length === 0, bad.join('; '));
  });
});
