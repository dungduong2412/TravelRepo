# VNO V2 — UAT custom SMTP: owner-reviewed setup and safety gate (Phase 4, NOT enabled)

Status: prepared, **nothing in Supabase Auth was changed**. Real delivery stays off until the owner supplies the items in section 4 and approves the gate in section 3.

## 1. Why an application allowlist is not enough

* Open sign-up is on (`disable_signup:false`) and the 451 migrated V1 identities exist in Supabase Auth. Anyone can submit the public **Forgot password** or **Sign up** form with any address; **Supabase Auth's own mailer** then sends the message. Today that is harmless only because the built-in sender refuses non-team addresses. Once a custom SMTP is configured, it will mail *any* address, including real customers.
* `INVITATION_EMAIL_ALLOWLIST` (already in the release) only restricts invitations our backend triggers. It cannot stop Auth's signup/recovery/magic-link/email-change messages.
* Therefore the allowlist must be enforced where Auth hands the message over: a **Send Email hook** (our gateway), and, as a second independent layer, **provider-side recipient restriction**.

## 2. Enforcement design

1. **Gateway (implemented, `backend/src/modules/auth-email-hook`, not deployed)**: `POST /auth/hooks/send-email`, authenticated only by the Standard Webhooks signature (HMAC-SHA256, 5-minute tolerance). For each message it decides: `AUTH_EMAIL_DELIVERY` must be `enabled`; the recipient must be on `AUTH_EMAIL_ALLOWLIST` (exact addresses; a plus alias is matched literally, `a+uat1@x.com` does not authorise `a@x.com`; or `@domain` entries); the Auth user id must **not** exist in `legacy_identity_map` (migrated V1 identity, blocked even if someone allowlists its address); the identity lookup failing closes the gate. Suppressed messages still return HTTP 200, so the public forms do not reveal which addresses exist. Subject carries `[UAT]`. Sending uses the UAT SMTP credentials below via the gateway, not a sink inbox.
2. **Provider-side restriction (independent layer)**: use a transactional provider/domain that can only deliver to verified recipients (for example a sandbox domain with authorised recipients, or a dedicated UAT sending domain whose API key is limited to it). The provider restriction must be proven by sending one test to a non-approved mailbox owned by the owner and observing the provider reject it.
3. Email verification stays enabled (`mailer_autoconfirm:false`, asserted by `U03` on every run).
4. Optional hardening to decide: keep open sign-up but rely on the gateway, or set `disable_signup` for UAT and create testers through admin invitation only.

Evidence available now: `backend/scripts/test-auth-email-hook.ts` (10 contract tests: signature, allowlist, plus-alias, migrated identity, fail-closed, inert without secret) and a live check through the real Express stack (bad signature 401; signed message to a non-allowlisted address 200 `suppressed`, nothing sent).

## 3. Gate to pass BEFORE real delivery is enabled (all must be recorded as PASS)

| # | Proof | How |
|---|---|---|
| G1 | Hook is the only sender | Auth > Hooks: Send Email = our HTTPS endpoint; Auth > SMTP left empty or pointing to a provider restricted per 2.2 |
| G2 | Non-allowlisted recipient receives nothing | Trigger recovery + signup for an owner-controlled non-allowlisted mailbox: gateway log `suppressed not_allowlisted`, provider shows no message, mailbox empty |
| G3 | Migrated identity receives nothing | Proven on a local clone (a clone user present in `legacy_identity_map` whose address is deliberately allowlisted: result `suppressed migrated_identity`, nothing at the provider) plus the unit tests. No real migrated address is ever submitted to the live forms and no row is written to hosted `legacy_identity_map` |
| G4 | Allowlisted tester receives exactly one message per action | plus-alias mailboxes (see section 4) |
| G5 | Sender, templates, redirect allow-list and hook list read back and recorded | dashboard export or Management API read by the owner (the project API token available locally is rejected; owner exports) |
| G6 | No bulk action | no password reset, resend or notification is issued for the 451 migrated identities; `legacy_identity_map` count and `last_sign_in_at` unchanged |

Only after G1–G6, set in Railway (UAT API): `AUTH_EMAIL_HOOK_SECRET`, `AUTH_EMAIL_ALLOWLIST`, `AUTH_EMAIL_DELIVERY=enabled`, `SMTP_HOST/PORT/USER/PASS/FROM`, `AUTH_EMAIL_SUBJECT_PREFIX` (default `[UAT] `), and in Auth enable the hook. Keep `INVITATION_DELIVERY=capture` until the mailbox E2E below is green, then switch to `email` (still allowlisted).

## 4. What the owner must provide

1. Approval of the provider and a **UAT-specific** sender (separate from Production), e.g. `no-reply@uat.<domain>`, with SPF/DKIM/DMARC DNS published; SMTP host, port, user and password delivered through Railway variables (never chat or Git).
2. Tester mailboxes: 4 real inboxes you control, plus aliases of the form `name+vno-uat-admin@…`, `+merchant`, `+partner`, `+outsider`, `+signup1`, `+signup2` (list them as the allowlist).
3. Confirmation of the Auth redirect URL allow-list for `https://vno-web-uat.up.railway.app/**` and the Site URL; export of the current Auth email templates (the repo only has `supabase/templates/recovery.html`; signup/invite/magic-link templates are not versioned) so they can be reviewed and aligned to the gateway's messages.
4. `SUPABASE_DB_PASSWORD` exported in the launching shell (needed to read migration history and verify G3/G6 by SQL).
5. A decision on open sign-up (4 above).

## 5. Mailbox E2E to run once the gate is green

Signup (confirmation link opens, account verified) → login → forgot/reset (link works once, second use shows the expired state) → admin invitation to a `+merchant`/`+partner` alias → claim (wrong-mailbox negative included) → pending approval screen → admin approval → role redirect. Evidence: provider message log, Playwright traces, screenshots, and the gateway's masked log lines.
