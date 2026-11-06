# VNO V2 — Authentication Release Gate (Forgot Password + Signup) — 2026-11-06

**Verdict: Authentication is NOT yet ACCEPTED.** App behaviour is proven end to end with automated evidence on hosted UAT. Two items need the owner's
mailbox: real-mail receipt/open of the two recovery e-mails already sent, and a real-mail signup on a fresh allowlisted alias.

## Deployed revision

| Service | Git SHA | Railway deployment | Status |
|---|---|---|---|
| vno-api | `9372708` (branch `codex/vno-phase-d4-security`) | `8f961352-820d-46a0-a2fa-7804b7d1b9e9` | SUCCESS |
| vno-web | `9372708` | `78acfa77-18ac-485d-88f7-69eb9306dc5f` | SUCCESS |

Previously deployed: `cbd093c`. No migrations. Allowlist, migrated-V1 protection and single-environment setup unchanged.

## Root cause (Task 1)

1. **Consumable GET link.** The hook built `https://<project>.supabase.co/auth/v1/verify?token=…&redirect_to=…`. Auth spends the one-time token on the
   first GET, so any mail scanner, link preview or browser prefetch can use it up before the person clicks. The hook log at 17:10:41 proves the mail was
   sent; it says nothing about the token still being usable. Prefetch consumption is a *plausible* contributor but was **not proven** (no scanner traffic is observable).
2. **Any session enabled the form.** `reset-password` set `ready` for any Supabase session. A person signed in as another UAT account (or with a stale
   session) got the form, and `updateUser()` would then act on *that* session's user, not the user named in the link.
3. **One error for everything.** Every `updateUser()` failure showed "link invalid or expired", including password-policy, same-password, rate-limit and network failures.
4. Contributing: onboarding drafts lived in `sessionStorage`, which a confirmation link opened in a new tab or in-app browser cannot see.

## Fixes

- E-mail links for `recovery` and `signup` now point at the web app (`/reset-password?token_hash=…&type=recovery`, `/auth/confirm?token_hash=…&type=signup&next=…`).
  The token is spent only by `verifyOtp` after an explicit click. The link origin must equal `FRONTEND_URL`; otherwise the hook falls back to the legacy link (unit-tested).
- `reset-password` enables the form only when this page verified the token (or Supabase emitted `PASSWORD_RECOVERY` for a legacy link). After `verifyOtp` it confirms with
  `getUser()` that the session user is the token's user, shows the masked address, strips the token from the URL, and on success clears app session keys and signs out.
- Error classification by code: `weak_password`, `same_password`, rate limit, network, and only genuine token/session failures say "expired". After a genuine failure the page offers one path to `/forgot-password`.
- Safe diagnostics: browser emits `{cid, flow, stage, code}` only; `POST /auth/diagnostics` accepts a closed vocabulary and logs it (never tokens, URLs, e-mails, passwords).
  The hook now logs `accepted` and SMTP `message_id`.
- Signup: duplicate registration, rate limit, weak password and invalid e-mail have specific messages; drafts moved to `localStorage` (24 h TTL, never the password).
- Pending owners were told their account was "suspended/not activated"; they now see "awaiting approval".

## Evidence

Harness: Playwright (`e2e-uat/tests/50-…`, `60-…`, `70-…`), executed through `railway run --service vno-api` so the service key is injected, never written or printed.
Admin-issued tokens bypass the hook on purpose: they prove app behaviour, **not** mail delivery. The password of each approved account was restored after the run (`RESTORE … HTTP 200`).

### Recovery, hosted UAT (5/5)

| ID | Result | What it proves |
|---|---|---|
| RC1 | PASS | A plain GET of the link (scanner/prefetch) leaves it usable; form appears only after the click; intended identity shown masked; weak password shows the **policy** error, not "expired"; mismatch is caught; new password logs in, previous password is rejected (HTTP 400); login through the real UI works |
| RC2 | PASS | Consumed link: UI shows invalid, no form; Auth rejects the spent token; password unchanged by the replay |
| RC3 | PASS | Signed-in Partner opening `/reset-password` with no token, a junk token, an error hash, or a forged `#access_token…type=recovery` gets no form; Partner password untouched |
| RC4 | PASS | Merchant signed in, Partner's link opened: only Partner's password changed; Merchant unchanged; app session keys cleared |
| RC5 | PASS | After a genuine failure the user reaches `/forgot-password?reason=…` with an explanatory notice |

Also: unit tests (`test:auth-email-hook` 13/13, error classifier self-test), and Supabase **does** enforce the password policy server-side (422 `weak_password` for letters-only, digits-only and 5-char passwords), which closes the previously open Dashboard item.

### Signup, hosted UAT (10/10, new synthetic identities on `@vno-uat-synthetic.example`)

For each of Merchant and Partner: UI signup creates an unconfirmed user (SG1); unconfirmed e-mail cannot sign in (`email_not_confirmed`) and anonymous profile creation is refused (SG2);
a scanner GET does not confirm, one click confirms (`email_confirmed_at` set by Supabase), opened in a **different tab** the draft survives and the original tab becomes verified and submits, a second use of the link fails (SG3);
pending profile → login says "awaiting approval" → Admin approves → login reaches the correct workspace (SG4); registering the confirmed address again is rejected (SG5).
The hosted hook logged `suppressed signup … not_allowlisted` for these addresses, so the allowlist is still enforced.

### Real mail (Task 3, controlled): sent and accepted, receipt pending the owner

| Account | Requested via UI (VN time) | Hook log | OxMail message id |
|---|---|---|---|
| e2e Merchant alias (`and***+uat-e2e-merchant@gmail.com`) | 17:36:16 | `sent recovery … accepted=1` at 17:36:20 | `<1649df1d-36cd-f35e-cd8d-262dcd322054@vietnamnumberone.com>` |
| e2e Partner alias (`and***+uat-e2e-partner@gmail.com`) | 17:36:21 | `sent recovery … accepted=1` at 17:36:23 | `<8175f67d-8970-d9ee-d9a1-f8bd333cb1e3@vietnamnumberone.com>` |

No other recovery request was made for these two accounts after these sends, so the emailed tokens are the live ones. I did not read, open or consume them.

## Owner's mailbox step (needed for acceptance)

1. Find the two `[UAT] Đặt lại mật khẩu VNO` mails (check Spam). Confirm the button/link starts with `https://vno-web-uat.up.railway.app/reset-password?token_hash=` and **not** `…supabase.co/auth/v1/verify`.
2. Open each in a clean/private window, press **Tiếp tục đặt mật khẩu**, set a password (8+ chars, letter + digit), then sign out and sign in with it.
3. Re-open the same link: it must show "Liên kết không hợp lệ hoặc đã hết hạn" with no form.
4. Tell me when done: I will set both accounts back to the harness passwords so the E2E suite keeps working.
5. For a real-mail signup, one fresh address must be added to `AUTH_EMAIL_ALLOWLIST` (only `uat-signup1` and `uat-welcome1` remain and may already be registered). I did not change the allowlist.

## Remaining defects / risks

- **Mail receipt unproven** until step above. SPF/DKIM/DMARC for `vietnamnumberone.com` could not be checked from this environment (DNS unreachable); Gmail spam placement was the earlier root cause, so verify them.
- **Supabase send limit (HTTP 429)** is project-wide and was hit during testing; the UI now explains it, but it caps how many real-mail tests can run per hour.
- **Signup page says "check your e-mail" even when the UAT hook suppresses the address** (the owner's 15:44 case was a non-allowlisted gmail address). Intended for privacy, confusing for testers; consider a UAT-only note.
- **Production:** native Custom SMTP templates must use the same pattern: recovery `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`, signup `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/login`. Mails sent before this deploy still carry the old link; those work through the legacy path with the corrected checks and messages.
- **Synthetic test data left in UAT** (names `UAT-E2E-AUTH-*`, addresses `@vno-uat-synthetic.example`): Merchants `…M-sgh11061735` (active), `…M-sg11061732` (active), `…M-sg11061730` (pending); Partners `…P-sgh11061735` (active), `…P-sg11061732` (active); plus a few orphan Auth users from interrupted runs. Nothing existing was deleted; say if you want these removed.
- `frontend/app/page_old.tsx`/`page_backup.tsx` and other unrelated clutter were not touched.

No Production cutover. Authentication stays **NOT ACCEPTED** until the mailbox step is confirmed.
