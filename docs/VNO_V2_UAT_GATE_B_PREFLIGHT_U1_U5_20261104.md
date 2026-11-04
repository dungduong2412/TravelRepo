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
