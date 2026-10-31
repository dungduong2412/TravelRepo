import { test, expect } from '@playwright/test';
import { api, anonKey } from '../lib/api';
import { config } from '../lib/env';
import { record } from '../lib/evidence';

// Needs no credentials. Runs against the hosted UAT and changes nothing.
const c = config();
const check = (id: string, title: string, ok: boolean, detail = '') => { record(id, title, ok ? 'PASS' : 'FAIL', detail); expect(ok, `${id} ${title} ${detail}`).toBeTruthy(); };

test.describe('@unauth UAT target and anonymous boundaries', () => {
  test('U01 target is the approved UAT stack', async () => {
    check('U01', 'hosts pinned to UAT', c.web.includes('vno-web-uat') && c.api.includes('vno-api-uat') && c.supabase.includes('hsezyogfxgnkpweoqqny'), `${new URL(c.web).host} ${new URL(c.api).host}`);
  });
  test('U02 API and web are healthy', async ({ request }) => {
    const h = await request.get(`${c.api}/health`); const l = await request.get(`${c.web}/login`);
    check('U02', 'api /health and web /login return 200', h.status() === 200 && l.status() === 200, `${h.status()}/${l.status()}`);
  });
  test('U03 email verification stays enforced (read-only Auth settings)', async ({ request }) => {
    const r = await request.get(`${c.supabase}/auth/v1/settings`, { headers: { apikey: await anonKey() } });
    const s = await r.json();
    check('U03', 'mailer_autoconfirm is false; no anonymous/phone/social sign-in', s.mailer_autoconfirm === false && !s.external?.anonymous_users && !s.external?.phone, `autoconfirm=${s.mailer_autoconfirm}`);
  });
  test('U04 admin and financial endpoints reject anonymous callers', async () => {
    const probes: [string, string, unknown?][] = [
      ['POST', '/invitations', { entity_type: 'merchant', entity_id: '00000000-0000-4000-8000-000000000000' }],
      ['GET', '/invitations/for/merchant/00000000-0000-4000-8000-000000000000'],
      ['GET', '/audit-events'], ['GET', '/transactions/report'], ['GET', '/transactions'], ['GET', '/transactions/me/report'],
      ['POST', '/transactions/simulation', { collaborator_code: 'X', gross_amount: '1', idempotency_key: '00000000-0000-4000-8000-000000000001' }],
      ['POST', '/qr/resolve', { payload: 'X' }], ['POST', '/merchants/admin', {}], ['POST', '/collaborators/admin', {}],
      ['POST', '/invitations/claim/merchant/00000000-0000-4000-8000-000000000000'], ['GET', '/commissions'],
    ];
    const bad: string[] = [];
    for (const [m, p, b] of probes) { const r = await api(null, m, p, b); if (r.status !== 401) bad.push(`${m} ${p}=${r.status}`); }
    check('U04', `${probes.length} protected endpoints return 401 anonymously`, bad.length === 0, bad.join('; '));
  });
  test('U05 public QR token route does not leak profile data for an unknown token', async () => {
    const r = await api(null, 'GET', '/c/UAT-E2E-DOES-NOT-EXIST');
    const leaks = /email|phone|bank|user_id/i.test(JSON.stringify(r.body));
    check('U05', 'unknown QR token → no data, no PII', r.status >= 400 && !leaks, `HTTP ${r.status}`);
  });
  test('U06 protected pages redirect anonymous browsers to login', async ({ page }) => {
    for (const p of ['/admin/dashboard', '/merchant/dashboard', '/collaborator/dashboard']) {
      await page.goto(p); await page.waitForLoadState('networkidle');
      await expect(page, p).toHaveURL(/login/);
    }
    record('U06', 'admin/merchant/partner dashboards require login', 'PASS');
  });
  test('U07 claim page renders and does not claim without a session', async ({ page }) => {
    await page.goto('/claim/merchant/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('button', { name: /sign in|đăng nhập/i }).or(page.getByText(/sign in|đăng nhập|session/i)).first()).toBeVisible();
    record('U07', 'claim page without session asks for sign-in', 'PASS');
  });
});
