# VNO V2 — Gate B preflight U1–U5: execution record (2026-11-04)

Written for: the owner, who supplies the remaining credentials and Dashboard actions.

**Status: preflight STOPPED at U1/U2. No e-mail sent, delivery disabled, Send Email hook not enabled, no Railway variable changed, no code or data touched.** Stop-on-failure applies: U1 has a real FAIL (certificate name) with a one-variable fix, and U2–U4 wait on owner inputs.

## Results
| Step | Result | Evidence |
|---|---|---|
| U1a Deployed SHAs | **PASS** — API `1471baae48216d30ac07e292dc59c7eaeed7776f` (SUCCESS, 12:17Z, root `/backend`), Web `45cdcc6f386f61efae98eff5366362b21d1649e1`; origin branch head = API SHA; `/health` 200, Web 200 | Railway GraphQL read |
| U1b Railway variables | **PASS (as designed)** — `AUTH_EMAIL_DELIVERY=disabled`, `INVITATION_DELIVERY=capture`, `SMTP_HOST=mail.vietnamnumberone.com`, `PORT=587`, `SECURITY=starttls`, user/from/reply-to `support@vietnamnumberone.com`. **Not set:** `SMTP_PASS`, `AUTH_EMAIL_ALLOWLIST`, `AUTH_EMAIL_HOOK_SECRET`, `SMTP_TLS_SERVERNAME` | read-only variable list, secrets masked |
| U1c SMTP reachability | **PASS** — this network now reaches `mail.vietnamnumberone.com` 587 and 465 (earlier runs were blocked). Server banner `220 mail.oxmail.vn ESMTP OxMail ready`, offers STARTTLS, max message 35 MB | TCP + EHLO only, no AUTH, no message |
| U1d TLS certificate | **FAIL on `mail.vietnamnumberone.com`** (587 and 465): self-signed `CN=rcgen self signed cert`, `Verify return code: 18`. **PASS on `mail.oxmail.vn`** (same server, 202.92.5.134): Let's Encrypt chain, `CN=mail.oxmail.vn`, valid until **2026-12-27**, `Verify return code: 0` on 587 (STARTTLS) and 465 | `migration/v2/evidence/gate-b-preflight-20261104/` (local) |
| U2 `SMTP_PASS`, tester allowlist | **BLOCKED — owner inputs** | not set |
| U3 Non-sending SMTP session check | **NOT RUN** — needs `SMTP_PASS` and a corrected host | |
| U4 Hook secret + enable hook; Auth Custom SMTP empty | **BLOCKED — Supabase Dashboard access** (local token cannot read or change Auth config) | |
| U5 Signature / recipient / migrated / delivery-disabled matrix on hosted | **PARTIAL.** Unsigned hook → **503** (fail closed, no secret yet). Signed cases, blocked recipients and migrated identities need the secret. Offline matrix already passes (hook 12/12, delivery 39/39) | hosted probe |
| Zero e-mails / no DB mutation | **PASS so far** — no SMTP session was ever opened with credentials; read-only calls only | |

## Why U1d matters
The name `mail.vietnamnumberone.com` is a CNAME to `mail.oxmail.vn`. The server picks its certificate by the name the client asks for: asked for `mail.oxmail.vn` it serves a valid Let's Encrypt certificate, asked for `mail.vietnamnumberone.com` it serves a self-signed default. The gateway keeps certificate verification on, so with the current host it would refuse the connection. Supabase's native Custom SMTP (Production) has no certificate-name override, so **`mail.oxmail.vn` is the host to use in both environments**.

## Fix (one variable, owner approval needed)
I tried to set `SMTP_HOST=mail.oxmail.vn` on `vno-api`; the action was **denied** by the session's safety classifier as a mail-destination change, so I did not retry or work around it. Either:
- you set `SMTP_HOST=mail.oxmail.vn` in Railway (Railway redeploys the same code; delivery stays disabled), or
- you tell me explicitly to set it and I will; alternative `SMTP_TLS_SERVERNAME=mail.oxmail.vn` keeps the host but still needs your approval.
Verification is never switched off. Also ask OxMail why the vietnamnumberone.com name has no certificate (the Let's Encrypt cert expires 2026-12-27; confirm automatic renewal).

## Remaining owner inputs, in order
1. `SMTP_HOST=mail.oxmail.vn` (above).
2. `SMTP_PASS` in Railway (`vno-api` → Variables); never in chat.
3. Tester addresses (admin, merchant, partner, outsider, signup1, signup2) plus one owner mailbox that is deliberately **not** allowlisted. No migrated V1 address.
4. Supabase Dashboard: confirm Auth → SMTP Settings is empty (screenshot); Hooks → Send Email → HTTPS `https://vno-api-uat.up.railway.app/auth/hooks/send-email` → generate secret → Railway `AUTH_EMAIL_HOOK_SECRET` → wait for redeploy → enable hook; raise Emails-sent rate limit for the test window.
5. Railway SSH key (`railway ssh keys add`) so U3 can run in the container, or run U3 from any network that reaches the SMTP port. This Mac now reaches it, so with 1 and 2 done, U3 can also run locally via `railway run`.

With 1–4 in place, U3 and U5 are one sitting; then the PASS/FAIL report and your separate approval for delivery.

## Addendum 2026-11-05 — owner GO for SMTP host; steps 1–3 done
- **Change:** `SMTP_HOST=mail.oxmail.vn` on UAT `vno-api` only (owner-approved). Kept `SMTP_PORT=587`, `SMTP_SECURITY=starttls`, `AUTH_EMAIL_DELIVERY=disabled`, `INVITATION_DELIVERY=capture`; no `SMTP_TLS_SERVERNAME`, verification on. Production untouched.
- **Redeploy:** same SHA `1471baa`, SUCCESS within 30 s; `/health` 200, Web 200; unsigned hook still 503.
- **TLS:** `mail.oxmail.vn` 587 (STARTTLS) and 465: `Verification: OK`, `Verify return code: 0`, `CN=mail.oxmail.vn`, Let's Encrypt, expires 2026-12-27 (`gate-b-preflight-20261104/tls-mail.oxmail.vn-587-after-host-change.txt`, local).
- **Unchanged behaviour:** hosted anonymous privacy 10/10 (144 merchant details); Playwright `00-unauth`+`20-regression`+`40-experience` 38/38. No data written.
- **Still blocked:** `SMTP_PASS` (U3), tester allowlist, hook secret and Dashboard hook (U4/U5).

## Addendum 2026-11-05 (2) — U3 and hosted U5 executed, delivery still disabled
Hook secret and `SMTP_PASS` were entered by the owner (values never read or printed; secret format `v1,whsec_…` checked, password length only). API deployment SUCCESS at 01:07Z on `1471baa`. `AUTH_EMAIL_DELIVERY=disabled`, `INVITATION_DELIVERY=capture`, `AUTH_EMAIL_ALLOWLIST` **not set** (no owner-confirmed tester list yet — the E2E accounts in `e2e-uat/.env.uat.local` are public-provider plus-aliases and were NOT used as an allowlist).

| Check | Result |
|---|---|
| **U3** `npm run smtp:check` via `railway run` (`mail.oxmail.vn:587 starttls`, certificate verification on) | **PASS** — encrypted channel + authentication accepted, no message sent |
| Supabase hook configuration (hook enabled, URL, Custom SMTP empty) | **NOT VERIFIABLE with available tokens** — owner screenshot required |
| Hosted U5 — signature: none / wrong / other-body / stale (−1 h) / future (+1 h) | **PASS** — 401 `Invalid hook signature` (5/5) |
| Hosted U5 — valid signature, payload without email/action | **PASS** — 401 `Malformed hook payload` |
| Hosted U5 — valid signature, malformed JSON | **Safe reject, expectation mismatch** — HTTP 400 from the framework body parser before the gateway; nothing processed |
| Hosted U5 — valid signature, non-allowlisted recipient; all six action types (signup, recovery, invite, magiclink, email_change, reauthentication) | **PASS** — 200 `{"suppressed":true}` (7/7) |
| Hosted U5 — 3 real migrated Auth user ids, delivery disabled | **PASS** — 200 suppressed (vacuously by `delivery_disabled`, see next row) |
| Migrated-identity protection (real gateway code + real UAT `legacy_identity_map`, **stub sender**, delivery "enabled" only inside the local process, address deliberately allowlisted) | **PASS 8/8** — 5 real migrated ids → `suppressed migrated_identity`, 0 sends; control (non-migrated + allowlisted) reaches the stub once; not-allowlisted → suppressed. Hash-of-address path covered offline only (hook 12/12); no real V1 address was read |
| Hosted logs | 10 `suppressed … delivery_disabled` lines = the 10 calls that reached the policy; **0** `sent`, `delivery failed` or SMTP lines |
| Data integrity | `legacy_identity_map` 451; migrated profiles 451, **0** with login tracking; reconcile `--uat --no-db` 20 PASS / 1 FAIL / 2 NOT_RUN, the single FAIL being C21 on `user_profiles` only (11 synthetic accounts' login tracking from the Playwright runs, as in every release since 11-03); `audit_events` since test start: 0 |

Not run / open: `AUTH_EMAIL_ALLOWLIST` (needs owner-confirmed addresses); enabled-delivery, real-mailbox UAT (needs separate approval); the Supabase-side proof that Auth really calls the hook (needs the owner's Dashboard screenshot, then one live Auth event with an allowlisted tester while delivery is still disabled → expect a `suppressed … delivery_disabled` log line). The local pre-run baseline capture was cut off by my own timeout; the last verified baseline (`gate-b-blockers-20261104/state-after.json`) was used. Evidence (local): `migration/v2/evidence/gate-b-preflight-20261104/`.

## Addendum 2026-11-05 (3) — allowlist set, live hook proof, delivery still disabled
- **Allowlist:** `AUTH_EMAIL_ALLOWLIST` = exactly `andyduong2412+uat-e2e-merchant@gmail.com`, `andyduong2412+uat-e2e-partner@gmail.com` (owner-approved; exact addresses, no domain entry; `INVITATION_EMAIL_ALLOWLIST` unset). API redeployed 03:31Z, SUCCESS, same SHA `1471baa`, `/health` 200. `AUTH_EMAIL_DELIVERY=disabled`, `INVITATION_DELIVERY=capture`, `SMTP_HOST=mail.oxmail.vn`.
- **Controlled live preflight (one request):** Supabase Auth `POST /auth/v1/recover` for the merchant tester at 03:31:49Z → HTTP 200; gateway log `suppressed recovery to a***@gmail.com: delivery_disabled` at 03:31:52Z; **0** `sent` / `delivery failed` lines. This proves Auth calls the hook, the URL and the signed secret are correct, and the gateway suppresses. Side effect: `recovery_sent_at` on that synthetic account only.
- **Hook / Custom SMTP settings:** not directly readable with any available token; an enabled Send Email hook replaces Auth's own mail sending, so the live proof shows the hook path is the active one. Owner screenshot of SMTP Settings (empty) still recommended.
- **Scope finding:** both tester aliases already exist as confirmed Auth accounts (they are the E2E merchant/partner accounts, with sign-ins). A *signup → confirmation* test therefore cannot run on them (an existing confirmed address gets no confirmation mail), and a *forgot-password → set new password* test changes the E2E account passwords, which the hosted Playwright suites log in with.

## Addendum 2026-11-05 (4) — controlled delivery ACTIVATED (UAT only)
Owner decision: Option C (GO for controlled real-email UAT, fresh alias for both signup and recovery; E2E Merchant/Partner accounts and passwords untouched).
- **Alias check:** `andyduong2412+uat-signup1@gmail.com` is **not registered** in UAT Auth (all 475 users scanned). Mailbox ownership: owner statement.
- **Allowlist (exact addresses, no domain entry):** `…+uat-e2e-merchant@gmail.com`, `…+uat-e2e-partner@gmail.com`, `…+uat-signup1@gmail.com`. `INVITATION_EMAIL_ALLOWLIST` unset. Deployed 03:49Z, SUCCESS, `1471baa`.
- **Activation:** `AUTH_EMAIL_DELIVERY=enabled` on UAT `vno-api` at 03:50Z (deployment SUCCESS, same SHA `1471baa`, `/health` 200); `INVITATION_DELIVERY=capture` kept; SMTP `mail.oxmail.vn:587` starttls, certificate verification on. No code, migration, Web, Production or V1 change.
- **Hook active:** proven live earlier (Auth → hook → gateway `suppressed … delivery_disabled`). Dashboard SMTP Settings and the Emails-sent rate limit are **not readable with any available token** — owner to confirm by screenshot; an enabled hook replaces Auth's own sending, so Custom SMTP is not an alternate path.
- **Post-enable negatives (signed calls to the hosted hook, placeholder/non-allowlisted addresses only, nothing mailable):** 5/5 suppressed — non-allowlisted placeholder, a different plus-alias, the bare base address (`not_allowlisted`), and two real migrated Auth user ids (`migrated_identity`, reason checked in the gateway log). 0 `sent` lines.
- **No email was triggered by this step.** Manual tests (owner): signup → confirmation → login, and forgot-password → set new password → login, on the `+uat-signup1` alias only.
- **Kill switch:** `AUTH_EMAIL_DELIVERY=disabled` in Railway (redeploys in ~1 min), or disable the Send Email hook in the Dashboard.
