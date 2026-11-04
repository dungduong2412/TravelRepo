# VNO V2 — Gate B (OxMail SMTP): preparation record and hold (2026-11-04)

Written for: the owner and whoever finishes the Gate B activation.

**Status: HOLD at step 3/4. No e-mail was sent, delivery is disabled, the Supabase Send Email hook is not enabled.** Steps 4–10 need inputs only the owner can supply (section 3). Nothing was touched on V1, Production, financial transactions, migrated identities or merchant records.

## 1. Done

| Step | Result |
|---|---|
| 1. Deployment / project | Railway `vno-v2-uat` / `uat`. Web deployment at `45cdcc6f386f61efae98eff5366362b21d1649e1`. API configuration is pinned to the same SHA; the API's latest deployment (07:55Z, triggered by the variable change) was built from branch head `a4dbe5d`, a docs-only commit outside the service root `/backend`, so the running code is identical to `45cdcc6`. Supabase project `hsezyogfxgnkpweoqqny` confirmed identical on the API's `SUPABASE_URL` and the web app. `/health` 200 |
| 2. Tester inboxes | **Not supplied** — `AUTH_EMAIL_ALLOWLIST` is left unset, which fails closed (nobody is allowed) |
| 3. Railway variables (non-secret) | Set on `vno-api`: `AUTH_EMAIL_DELIVERY=disabled`, `INVITATION_DELIVERY=capture`, `SMTP_HOST=mail.vietnamnumberone.com`, `SMTP_PORT=587`, `SMTP_SECURITY=starttls`, `SMTP_USER`/`SMTP_FROM`/`SMTP_REPLY_TO=support@vietnamnumberone.com`, `SMTP_FROM_NAME=VNO Support`. **Not set:** `SMTP_PASS`, `AUTH_EMAIL_ALLOWLIST`, `AUTH_EMAIL_HOOK_SECRET` |
| DNS (A2.1) | MX `gw.oxmail.vn`; SPF `v=spf1 include:_spf.oxmail.vn -all`; DMARC `p=quarantine` (reports to a VNO mailbox); DKIM public key published at selector `default`. Provider-side "sender verified" and DKIM signing with that selector still to be confirmed by the owner |
| Hook gateway | Unsigned `POST /auth/hooks/send-email` → **503** (fails closed, no secret yet), before and after the redeploy |
| Supabase Auth public settings | Email provider on, **confirm e-mail ON** (`mailer_autoconfirm=false`), **open sign-up ON** (`disable_signup=false`); no other external provider |

## 2. Regression and data integrity (after the redeploy)
- Hosted Playwright `00-unauth` + `20-regression` + `40-experience`: **38/38**.
- Read-only reconcile `--uat --no-db`: **20 PASS / 0 FAIL / 2 NOT_RUN** (C17/C18 need the DB password). Table fingerprints identical to the pre-test baseline except `user_profiles` (login tracking of the synthetic accounts); `legacy_identity_map` 451, `auth_users` 475.
- **Anonymous privacy hosted scan: 1 FAIL / 8 PASS.** `GET /merchants/verified` (legacy) now returns an extra key, `merchant_description_format` (`plain_text` | `markdown`), which is not on the test's allow-list. Cause: release `45cdcc6` added the column to the public column list; I did not run this scan on that release. It is a rendering flag, not owner/contact/financial data, and the other 8 scans (public catalog on all 144 merchants, categories, organisation profile, media, QR) pass with that one key allowed. **Owner decision needed:** (a) accept the key and add it to the allow-list in `backend/scripts/test-anonymous-privacy.ts`, or (b) strip it from the legacy response (requires an API deploy). Not changed in this task.

## 3. Blockers — what only the owner can supply
1. **`SMTP_PASS`** — enter it in Railway (`vno-api` → Variables). Not requested, not logged, not printed anywhere in this work. Note: `support@vietnamnumberone.com` looks like the existing support mailbox, not a UAT-only sub-credential (runbook section 3.3); revoking it later would also affect that mailbox.
2. **Approved tester addresses** — exact addresses for admin, merchant, partner, outsider, signup1, signup2 and one deliberately **non-allowlisted** owner mailbox (negative test); no public-provider domains, no migrated V1 customer address. They become `AUTH_EMAIL_ALLOWLIST`.
3. **Supabase Send Email hook** — the local project token cannot read or change Auth config. Owner: Authentication → Hooks → Send Email → HTTPS `https://vno-api-uat.up.railway.app/auth/hooks/send-email` → generate secret → put it into Railway as `AUTH_EMAIL_HOOK_SECRET`, wait for the redeploy, then enable the hook. Auth → SMTP settings must stay empty. Also export the Auth settings in checklist 2.C (Site URL, Redirect URLs, OTP expiry — recommend 86400 s —, rate limits).
4. **SMTP connectivity proof (step 4)** — this machine's network blocks outbound SMTP to every host tested (25/465/587/2525 on the VNO and OxMail hosts and `smtp.gmail.com:587` all time out), and Railway SSH needs an SSH key that is not configured, so `npm run smtp:check` could not be run from either side. It also needs `SMTP_PASS`. Run it from a network that allows port 587 once the password exists, and confirm with the provider that it does not restrict by source IP (Railway egress IPs are not fixed). With delivery disabled the gateway never opens an SMTP connection, so Railway → OxMail is first proven when delivery is enabled (A7).
5. **Separate approval** to set `AUTH_EMAIL_DELIVERY=enabled` (A7), and later `INVITATION_DELIVERY=email`, after steps 1–4 are green.

## 4. Not run (depends on section 3)
Steps 4 (smtp:check), 5 (hook with delivery disabled), 6 (unauthorised recipient / migrated identity probes on hosted), 7 (enable), 8 (real signup, verification, Merchant and Partner login, forgot/reset, invitations, claim, role redirects), 9 (negatives, one-time links) and the post-activation parts of 10. **No actual sent/received e-mail results exist.** Merchant/Partner login outcomes by e-mail are therefore not available; the hosted suites above (38/38) cover the existing password-login flows without e-mail.

## 5. Rollback of this change
Delete `AUTH_EMAIL_DELIVERY`, `INVITATION_DELIVERY` and the `SMTP_*` variables on `vno-api` (redeploy ≈ 1–3 min). No data, hook or Auth change was made, so nothing else needs undoing.

Evidence (local, not committed): `migration/v2/evidence/gate-b-oxmail-20261104/`.
