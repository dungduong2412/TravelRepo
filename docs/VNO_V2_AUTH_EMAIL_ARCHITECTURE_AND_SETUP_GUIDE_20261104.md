# VNO V2 — Authentication e-mail: simplest safe architecture and Supabase setup guide (2026-11-04)

Written for: the owner, who configures the Supabase Dashboard and Railway.

**Status: review only. Nothing was activated, no e-mail was sent, nothing in Production or on the current gateway was changed.**

## 1. Answer in one paragraph
Use **Supabase Auth natively wherever it can be made safe, and keep the existing Send Email hook only where native cannot protect people.** Native Custom SMTP **cannot** be used on UAT: Supabase documents that with custom SMTP "your project's Auth server will send messages to all addresses", and offers no allowlist or blocklist. UAT holds 451 real customer identities and has open sign-up, so anyone could request a password reset for a customer's address and our sender would deliver it. The only control that stops that is the hook. Production has no such restriction to enforce, so it uses **native Custom SMTP + Dashboard templates with no hook and no VNO gateway**. One OxMail provider serves both; each environment has its own settings and controls.

| | UAT (`hsezyogfxgnkpweoqqny`) | Production (later, not touched now) |
|---|---|---|
| Sender of auth e-mails | **Send Email hook → VNO gateway → OxMail** (allowlist + migrated-identity block + delivery switch) | **Supabase Custom SMTP → OxMail** |
| Templates | gateway templates (bilingual) | Supabase Dashboard templates (same bilingual text) |
| Supabase "SMTP Settings" | **empty / off** | OxMail settings (section 4) |
| Recipient control | `AUTH_EMAIL_ALLOWLIST` + migrated block | none (customers must receive their own e-mail) |
| VNO backend | business state only (below) | business state only |

## 2. Gateway vs native Supabase (what to replace, what to keep)
| Gateway part | Native equivalent | Decision |
|---|---|---|
| SMTP transport, TLS, auth (`smtp-config.ts`, 112 lines) | Custom SMTP | Replace **in Production**. Keep on UAT only because an enabled hook replaces Supabase's sending ("SMTP not used") |
| Templates (`email-templates.ts`, 122 lines) | Dashboard templates | Replace in Production; paste the same bilingual text so UAT acceptance covers Production wording |
| Verify-link building, token handling | Auth does it | Never duplicated in VNO beyond what the hook payload requires on UAT; **the backend does not touch signup verification, recovery or tokens** |
| Hook signature check | n/a | UAT only |
| **Recipient allowlist + migrated-V1 block** (`recipient-policy.ts`, `email-policy.ts`) | **none** | **Keep for UAT** — this is the protection; Before-User-Created hook is not a substitute (it runs only when a new user is created, so it does not cover recovery/magic-link for existing migrated users) |
| Invitation business state (invitation rows, claim, revoke, first-password gate, Merchant/Partner approval, roles) | none | **Stays in the VNO backend** (the backend already uses Supabase's own `inviteUserByEmail`; it sends no mail itself) |

Net: the duplication is the e-mail *sender* only, and only on UAT, where it is the price of the recipient control. Total gateway code ≈ 465 lines; none of it is removed until the Production replacement passes acceptance.

**One small code follow-up for Production (not done):** the shared policy fails closed when `AUTH_EMAIL_ALLOWLIST` is unset, so an e-mail invitation would be refused. Production needs an explicit, reviewed switch (e.g. `AUTH_EMAIL_POLICY=open`, refused unless a Production marker is set) so the policy is off *on purpose*, never by omission.

## 3. OxMail review (what is known and what is not)
| Item | Finding |
|---|---|
| DNS | MX `gw.oxmail.vn`; SPF `v=spf1 include:_spf.oxmail.vn -all`; DMARC `p=quarantine`; DKIM key published at selector `default` → alignment is possible if OxMail signs as `vietnamnumberone.com` with that selector (owner to confirm in the OxMail console) |
| **TLS certificate — UNVERIFIED, top risk** | `https://mail.vietnamnumberone.com:443` presents a **self-signed** certificate (`CN=rcgen self signed cert`). If the SMTP listeners (465/587) present the same one, Supabase and our gateway (certificate verification is always on) will refuse the connection. This Mac cannot reach any SMTP port, so it could not be tested. Test from a network that allows SMTP: `openssl s_client -starttls smtp -connect mail.vietnamnumberone.com:587 -servername mail.vietnamnumberone.com -verify_return_error` (and `-connect …:465` without `-starttls`); expect `Verify return code: 0 (ok)` and a certificate whose name covers `mail.vietnamnumberone.com`. If it fails, OxMail must install a publicly trusted certificate — verification is never switched off |
| Ports | Supabase's docs do not list supported ports (their example uses 587). Prefer **587/STARTTLS**; use **465/TLS** if 587 is closed — prove it with the test above and the in-container check in `VNO_V2_UAT_GATE_B_BLOCKER_RESOLUTION_20261104.md` |
| Limits | **Not found.** `oxmail.vn` does not resolve and nothing public was found. Ask OxMail for: messages/hour and /day, recipients per message, whether application (transactional) sending is allowed, source-IP restrictions (Railway egress IPs are not fixed), app-password or sub-account support |
| **Trial expiry — critical for Production** | Not known. If the account is a trial, auth e-mail (including customers' password resets) stops at expiry. Get the expiry date in writing; Production must not go live on a trial; add a calendar alert 14 days before any expiry |
| Sender account | `support@vietnamnumberone.com` looks like the shared human support mailbox. Safer: a dedicated auth sender/login per environment (e.g. `no-reply` for Production and a separate UAT login) so revoking UAT's credential never affects Production or support. If OxMail only offers the one mailbox, accept it knowingly (rollback R3 then affects it) |
| Supabase limits | Built-in sender: 2 e-mails/hour, team members only. Custom SMTP starts at 30/hour (docs differ on wording). With the hook enabled the 2/hour default may still apply — see step U4 |

## 4. Settings to enter in the Supabase Dashboard
### UAT now (project `hsezyogfxgnkpweoqqny`) — nothing here sends mail by itself
| Where | Setting | Value |
|---|---|---|
| Authentication → SMTP Settings | Custom SMTP | **Off / all fields empty** (screenshot it) |
| Authentication → Hooks → Send Email | Type / URL | HTTPS · `https://vno-api-uat.up.railway.app/auth/hooks/send-email` |
| | Secret | *Generate secret* (`v1,whsec_…`) → copy straight into Railway `AUTH_EMAIL_HOOK_SECRET`, wait for the API redeploy, **then** enable the hook |
| Authentication → Rate Limits | Emails sent | raise for the test window (e.g. **30/hour**; confirm the current value first) |
| Authentication → URL Configuration | Site URL / Redirect URLs | `https://vno-web-uat.up.railway.app` / `https://vno-web-uat.up.railway.app/**` only |
| Sign In / Providers | Confirm email / sign-up | stay ON / stay open (decision); **OTP expiry unchanged** |
Railway `vno-api`: `SMTP_PASS` (you), `AUTH_EMAIL_ALLOWLIST` (exact tester addresses + none of the V1 customers), `AUTH_EMAIL_HOOK_SECRET`; already set: `AUTH_EMAIL_DELIVERY=disabled`, `INVITATION_DELIVERY=capture`, `SMTP_HOST/PORT/SECURITY/USER/FROM/FROM_NAME/REPLY_TO`.

### Production later (enter only after UAT acceptance and a separate approval)
| Authentication → SMTP Settings | Value |
|---|---|
| Sender email / name | `support@vietnamnumberone.com` (or the dedicated no-reply) / `VNO Support` |
| Host | `mail.vietnamnumberone.com` |
| Port | `587` (STARTTLS) or `465` (TLS) — whichever passed the certificate test |
| Username / Password | OxMail login / password (owner types it in the Dashboard) |
| Hook | **none** (Send Email hook disabled) |
| Templates | Confirm sign up · Invite user · Reset password · Magic link · Reauthentication · Change email — bilingual VI + EN, button + visible fallback link, from `email-templates.ts`, using Supabase's template variables (`{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .SiteURL }}`, `{{ .Email }}` — confirm the exact list in the Dashboard's template editor; the docs pages fetched do not list them) |
| Rate limits | set to the OxMail cap, below it |

## 5. UAT acceptance steps (stop at the first FAIL; no e-mail before step U5)
**Preconditions — all green or stop**
- **U1** OxMail answers (in writing): plan, **trial expiry**, hourly/daily cap, application sending allowed, IP restrictions, DKIM selector. SMTP certificate test (section 3) = `Verify return code: 0`.
- **U2** Owner enters `SMTP_PASS` in Railway; confirms tester list (6 addresses) + 1 separate non-allowlisted mailbox; I set the allowlist. Auth → SMTP Settings is empty (screenshot).
- **U3** Non-sending SMTP check from an environment with outbound SMTP (in-container, password stays in Railway): `session OK`; if 587 fails try 465/TLS; never disable verification.
- **U4** Hook secret in Railway → redeploy → hook enabled. Rate limit raised.
**Fail-closed proof — delivery still disabled**
- **U5a** Unsigned / wrong-signature / stale hook call → 401 or 503, zero SMTP.
- **U5b** Signed calls (test harness, no live forms) for: non-allowlisted address, the negative mailbox, a migrated identity (by id and by address hash) → 200 *suppressed*, zero SMTP connections, provider log empty.
- **U5c** Backend: invitation in `capture` mode returns the link once and requests no e-mail; e-mail mode refused with `INVITATION_DELIVERY_DISABLED`; non-allowlisted invitee refused before any Auth call.
- **U5d** Migrated V1 identities: `legacy_identity_map` 451 and `last_sign_in_at` unchanged; no live form is ever submitted with a V1 address.
- **Report PASS/FAIL, then stop for your approval.**
**Real mailboxes — after approval; `AUTH_EMAIL_DELIVERY=enabled`**
- **U6** Sign-up (Merchant `signup1`, Partner `signup2`): exactly one VI+EN message each → button → lands signed in on `…?confirmed=1`.
- **U7** Login / logout; wrong password; unconfirmed account message.
- **U8** Forgot password (`merchant`) → one message → set new password → login works → **same link again = expired**.
- **U9** Invitation (`INVITATION_DELIVERY=email` after a capture dry run): Merchant (`merchant`) and Partner (`partner`) → one message → claim → mandatory first password → pending → Admin approves → role redirect (Merchant → `/merchant/dashboard`, Partner → `/collaborator/dashboard`, Admin → `/admin/dashboard`); each blocked from the others.
- **U10** Negatives: `outsider` opens the merchant link → wrong-mailbox message; invite `outsider` then revoke before clicking → link dead; non-allowlisted invitee refused with no Auth user created; **negative mailbox receives nothing**; no recipient outside the tester list in the provider log or gateway log (`suppressed …` lines only).
- **U11** Devices: Gmail iOS / Android / desktop, fallback link, dark mode; mail not in spam (SPF/DKIM/DMARC aligned, tracking off).
- **U12** Close: hosted Playwright suites, anonymous-privacy 10/10, read-only reconcile unchanged (451 identities), kill-switch tested once (hook off → no mail; on → mail), `INVITATION_DELIVERY` back to `capture`.

**Production readiness (separate, later):** repeat U6–U11 on the Production project with a canary mailbox *after* installing the Dashboard templates and Custom SMTP there; add the explicit open-policy switch (section 2); only then retire the gateway on Production. UAT keeps the hook.

## 6. Rollback / kill switch
Supabase → Authentication → Hooks → Send Email → **disable** (SMTP Settings stays empty, so the built-in sender refuses non-team addresses). Then `AUTH_EMAIL_DELIVERY=disabled` in Railway. Credential concern → rotate the OxMail password and update `SMTP_PASS`.

Sources: Supabase docs — [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Send Email hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook), [Before User Created hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook), [rate limits](https://supabase.com/docs/guides/auth/rate-limits).
