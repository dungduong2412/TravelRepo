import { test, expect } from '@playwright/test';
import { api, hasCreds } from '../lib/api';
import { record } from '../lib/evidence';

// REAL-MAIL SIGNUP EVIDENCE (read/verify only). The owner performs the signup in their own browser with their own password and clicks the
// real confirmation mail; this spec never sees a password and sends nothing. It reads Auth (service key via `railway run`) and the app API (Admin login)
// to record: user exists, email_confirmed_at, time from creation to confirmation, pending business record, and (opt-in) Admin approval.
//   E2E_REAL_SIGNUP_MERCHANT=<alias> E2E_REAL_SIGNUP_PARTNER=<alias> railway run --service vno-api -- npx playwright test tests/80-real-mail-signup-verify.spec.ts
//   add E2E_APPROVE_REAL_SIGNUP=1 to approve the pending records as Admin (the owner then signs in to confirm the correct workspace).
const aliases = { merchant: (process.env.E2E_REAL_SIGNUP_MERCHANT || '').trim().toLowerCase(), partner: (process.env.E2E_REAL_SIGNUP_PARTNER || '').trim().toLowerCase() };
const mask = (e: string) => e.replace(/^(.{1,3}).*@/, '$1***@');
const items = (b: any): any[] => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);

async function authUser(email: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; process.env.E2E_ADMIN_SERVICE_TOKEN = key;
  for (let page = 1; page < 20; page++) {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const users = ((await r.json()) as any).users ?? [];
    const hit = users.find((u: any) => String(u.email).toLowerCase() === email);
    if (hit) return hit as { id: string; created_at: string; email_confirmed_at?: string | null; last_sign_in_at?: string | null };
    if (users.length < 1000) return null;
  }
  return null;
}

for (const kind of ['merchant', 'partner'] as const) {
  test.describe.serial(`Real-mail signup evidence: ${kind}`, () => {
    test.skip(!aliases[kind] || !process.env.SUPABASE_SERVICE_ROLE_KEY || !hasCreds('admin'), 'SKIP: set E2E_REAL_SIGNUP_<ROLE> and run via `railway run --service vno-api` with admin credentials');
    const email = aliases[kind]; const tag = kind === 'merchant' ? 'M' : 'P';
    let userId = '';

    test(`RS1 ${kind}: the real confirmation mail was used once; Auth recorded email_confirmed_at`, async () => {
      const u = await authUser(email);
      expect(u, 'Auth user exists (signup was submitted)').toBeTruthy(); userId = u!.id;
      expect(u!.email_confirmed_at, 'email_confirmed_at is set by Auth after the owner opened the link').toBeTruthy();
      const secs = Math.round((Date.parse(u!.email_confirmed_at!) - Date.parse(u!.created_at)) / 1000);
      record(`RS1-${tag}`, `signup ${u!.created_at} -> confirmed ${u!.email_confirmed_at} (+${secs}s)`, 'PASS', mask(email));
    });

    test(`RS2 ${kind}: a pending business record exists for this address`, async () => {
      let hit: any;
      if (kind === 'merchant') hit = items((await api('admin', 'GET', `/merchants/admin-directory?search=${encodeURIComponent(email)}&page_size=5`)).body)[0];
      else hit = items((await api('admin', 'GET', '/collaborators')).body).find((c) => JSON.stringify(c).toLowerCase().includes(email));
      expect(hit, 'record created from the onboarding form after confirmation').toBeTruthy();
      const status = kind === 'merchant' ? hit.merchants_status : hit.collaborators_status;
      record(`RS2-${tag}`, `business record present, status=${status}`, 'PASS', mask(email));
      test.info().annotations.push({ type: 'entity', description: String(kind === 'merchant' ? hit.merchant_system_id : hit.id) });
    });

    test(`RS3 ${kind}: Admin approval (opt-in)`, async () => {
      test.skip(process.env.E2E_APPROVE_REAL_SIGNUP !== '1', 'SKIP: set E2E_APPROVE_REAL_SIGNUP=1 once the owner has confirmed the record is the intended one');
      let hit: any;
      if (kind === 'merchant') hit = items((await api('admin', 'GET', `/merchants/admin-directory?search=${encodeURIComponent(email)}&page_size=5`)).body)[0];
      else hit = items((await api('admin', 'GET', '/collaborators')).body).find((c) => JSON.stringify(c).toLowerCase().includes(email));
      const id = kind === 'merchant' ? hit.merchant_system_id : hit.id;
      const r = await api('admin', 'POST', `/${kind === 'merchant' ? 'merchants' : 'collaborators'}/${id}/approve`, {});
      expect([200, 201], `approve HTTP ${r.status}`).toContain(r.status);
      record(`RS3-${tag}`, 'approved by Admin; owner now signs in with their own password and confirms the correct workspace', 'PASS', mask(email));
    });
  });
}
