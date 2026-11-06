import { test, expect } from '@playwright/test';
import { creds } from '../lib/env';
import { record } from '../lib/evidence';

// CONTROLLED REAL-MAIL STEP. Sends exactly ONE genuine recovery e-mail per account through the real UI -> Supabase -> hook -> OxMail path.
// It never reads or consumes the token (that is the mailbox owner's step) and refuses to run unless E2E_REAL_MAIL=1, so a normal
// suite run can never create competing recovery tokens.
test.describe.serial('Controlled recovery e-mail requests (opt-in)', () => {
  test.skip(process.env.E2E_REAL_MAIL !== '1', 'SKIP: set E2E_REAL_MAIL=1 to send the two controlled recovery e-mails');
  for (const role of ['merchant', 'partner'] as const) {
    test(`MR-${role}: one recovery request through the real forgot-password UI`, async ({ page }) => {
      const c = creds(role)!;
      const t0 = new Date();
      await page.goto('/forgot-password');
      await page.locator('#forgot-email').fill(c.email);
      await page.getByRole('button', { name: 'Gửi liên kết khôi phục' }).click();
      await expect(page.getByText('Đã gửi yêu cầu')).toBeVisible({ timeout: 20_000 });
      record(`MR-${role}`, `recovery requested via UI at ${t0.toISOString()}`, 'PASS', c.email.replace(/^(.{3}).*(@.*)$/, '$1***$2'));
    });
  }
});
