# VNO V2 — Gate B runbook: real-email UAT with the existing VNO e-mail service (provider-neutral)

Written for: the owner and whoever configures Railway / Supabase Auth for the UAT e-mail gate.

**Status: the code is prepared and, once the owner-approved deployment is done, runs on UAT with everything switched off** (`AUTH_EMAIL_DELIVERY` disabled, Supabase Send Email hook disabled, no SMTP credentials, no e-mail sent). The exact deployed SHA, hosted results and data-integrity checks are recorded in `VNO_V2_UAT_GATE_B_CODE_DEPLOYMENT_20261102.md`. Owner decision: AWS SES is **not** used; the existing VNO e-mail service is reused once its SMTP capabilities and credentials are confirmed (section 3). Gate A (invitation migration) stays PASS and is not reapplied. Activation (sections 7–8) needs separate approvals and has **not** been started.

## 1. What the Gate B code contains

| Area | Change | Files |
|---|---|---|
| Provider-neutral SMTP | One parser for any standard SMTP submission endpoint: STARTTLS (587 or custom port), implicit TLS (465), credential-less relay (loopback test only). No guessing: ambiguous or unsafe values keep delivery off. Certificates always verified (TLS ≥ 1.2), **no switch to disable verification**, no downgrade to clear text, 1–4 s timeouts (Auth abandons a hook call after ~5 s), failures reduced to a stable class (`auth_failed`, `recipient_rejected`, `tls_failed`, `connection_failed`, `timeout`, `temporary_failure`, …) with no server text, address or credential in responses or logs | `backend/src/modules/auth-email-hook/smtp-config.ts`, `auth-email-hook.service.ts` |
| One recipient policy | Hook and admin invitations now share **one** module: recipient must be on `AUTH_EMAIL_ALLOWLIST` **and** must not be a migrated V1 identity (matched by Auth user id **and** SHA-256 of the address, fail closed). Previously the invitation path had its own list (`INVITATION_EMAIL_ALLOWLIST`) and no migrated check. `INVITATION_EMAIL_ALLOWLIST` may still be set but can only *narrow*. Whole-domain entries for public mailbox providers (`@gmail.com`, …) are ignored; malformed addresses and header-injection strings never match | `backend/src/common/email/recipient-policy.ts`, `invitations.service.ts` |
| First-time password | Invited accounts are created **without a password**; the claim page had no way to set one although the invitation e-mail promises it. After the server accepts the claim, the page re-validates the session with Auth (`getUser()`: e-mail must be confirmed) and only then shows the password form (12+ chars, same rule as reset). For an invited identity that has no password yet the form is **mandatory** (no skip, no workspace button until saved); established accounts may skip; an unverified or rejected session gets login / forgot-password and never the form. Limit: the "password_set" marker is a UX flag, so someone who closes the tab mid-way keeps a bound profile and recovers through "Quên mật khẩu" (a usable, verified-email method) | `frontend/components/FirstPasswordForm.tsx`, `frontend/app/claim/[entityType]/[entityId]/page.tsx` |
| Invitation delivery vs claim status | E-mail invitations are refused with coded errors **before** Auth is called when e-mail delivery is off (`INVITATION_DELIVERY_DISABLED`) or the recipient is not allowed (`INVITATION_RECIPIENT_NOT_ALLOWED`); if Auth/hook/provider fails the call returns `502 INVITATION_EMAIL_FAILED`, **no invitation row is created** and an unused invited Auth identity is removed. So a `pending` invitation always means "handed to Auth" (`delivery_status: handed_to_auth`) or "link captured once" (`link_captured`); claim statuses (`pending/accepted/revoked/expired`) never encode delivery. No token or address appears in errors or audit | `invitations.service.ts`, admin pages |
| Tooling | `npm run smtp:check` (read-only: config + encrypted, authenticated session, **sends nothing**); template preview renderer; env documented in `.env.example` | `backend/scripts/smtp-check.ts`, `render-email-previews.ts`, `.env.example` |
| Tests | Local SMTP server + 39-case e-mail suite (section 6) | `backend/scripts/support/mini-smtp.ts`, `test-email-delivery.ts` |

It is deployed as API **and** Web together (the web change is the claim-page password gate and the admin invitation wording). Rollback targets: API `d84fce427565ced62aed5ff712aa6b190a1a6ba1`, Web `f89dfb909c230abae28579568c2e9249d96522af`.

## 2. Environment-variable matrix (Railway → `vno-api`, UAT only)

Enter secrets through the Railway dashboard (Raw Editor) or `read -s` + `railway variables --set`; never chat, Git, screenshots or shell history. The existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRONTEND_URL`, `CORS_ORIGINS` are already set and unchanged.

| Variable | Req. | Secret | Value / rule | Provided by |
|---|---|---|---|---|
| `AUTH_EMAIL_DELIVERY` | yes | no | `disabled` until step A7, then `enabled`. Anything other than exactly `enabled` suppresses all mail | owner (operator) |
| `AUTH_EMAIL_HOOK_SECRET` | yes | **yes** | `v1,whsec_…` generated by Supabase when the hook is created (shown once) | Supabase dashboard |
| `AUTH_EMAIL_ALLOWLIST` | yes | no | **Exact** tester addresses, comma-separated, e.g. `name+vno-uat-admin@example.org, …+merchant, …+partner, …+outsider, …+signup1, …+signup2`. Plus aliases match literally (`a+x@d` ≠ `a@d`). Domain entries (`@domain`) only for a domain you control; never a public mailbox provider | owner |
| `INVITATION_DELIVERY` | yes | no | `capture` (default: link shown once to the admin) until step A8 is green, then `email` | owner |
| `INVITATION_EMAIL_ALLOWLIST` | **leave unset** | no | Legacy. If set it can only narrow the list above | — |
| `AUTH_EMAIL_SUBJECT_PREFIX` | no | no | default `[UAT] ` | — |
| `SMTP_HOST` | yes | no | provider's submission host | **VNO e-mail service owner** |
| `SMTP_SECURITY` | yes unless port 587/465 | no | `starttls` (usually 587), `tls` (usually 465). `plain` is refused for non-loopback hosts | VNO e-mail service owner |
| `SMTP_PORT` | yes unless implied by `SMTP_SECURITY` | no | 587 / 465 / provider-specific (e.g. 2525 needs explicit `SMTP_SECURITY`) | VNO e-mail service owner |
| `SMTP_USER` | yes (or `SMTP_AUTH=none`) | semi | username, or the literal user the provider defines for API keys (e.g. `apikey`) | VNO e-mail service owner |
| `SMTP_PASS` | yes (or `SMTP_AUTH=none`) | **yes** | password / API key. **UAT-specific credential**, revocable without touching Production | VNO e-mail service owner → Railway |
| `SMTP_AUTH` | no | no | `none` only for a relay that authenticates by source IP and takes no credentials | VNO e-mail service owner |
| `SMTP_FROM` | yes | no | UAT sender, e.g. `no-reply@uat.<domain>` or `VNO UAT <no-reply@uat.<domain>>`; must be authorised by the provider | owner + provider |
| `SMTP_FROM_NAME` | no | no | display name (overrides a name inside `SMTP_FROM`) | owner |
| `SMTP_REPLY_TO` | no | no | monitored mailbox for replies | owner |
| `SMTP_TLS_SERVERNAME` | no | no | only if the host is an IP/alias whose certificate carries another name | VNO e-mail service owner |
| `SMTP_TIMEOUT_MS` | no | no | 1000–4000, default 3000 | — |

Validation: `npm run smtp:check` (section 7, step A2) prints the verdict without secrets. Unsafe combinations (plain text off-loopback, 465 with `starttls`, 587 with `tls`, missing credentials, unknown mode for a non-standard port, out-of-range timeout) are rejected; the gateway then answers `503 SMTP is not configured` and sends nothing.

## 3. Exact settings still to be supplied by the owner / VNO e-mail service owner

Nothing below was assumed or invented.

**From the existing VNO e-mail service**
1. Does it offer **SMTP submission**? (Required; an HTTP-API-only service needs a small adapter — tell me and I will add one behind the same policy.)
2. `SMTP_HOST`, `SMTP_PORT`, security mode (`starttls` / `tls`), authentication method, `SMTP_USER`, `SMTP_PASS` (delivered straight into Railway).
3. **Separation from Production:** a UAT-only credential (own sub-user/API key) that can be revoked alone, and a UAT-only sender address (e.g. `no-reply@uat.<domain>`).
4. Sender authentication: SPF, DKIM (selector) and DMARC for the UAT sender domain published and *aligned* with the From domain.
5. Source-IP restrictions: if the service only accepts listed IPs, Railway's outbound IPs are not fixed — say so now; the answer changes the plan (static egress or relay).
6. Limits: messages/hour, message size, any per-recipient throttling, bounce/complaint handling and who reads the provider's message log.
7. **Click / open tracking must be off** for these messages (link rewriting breaks one-time verification URLs).
8. Whether the service can restrict recipients itself (sandbox / verified-recipient list). Optional second layer; if not available, the gateway allowlist is the only recipient layer and you accept that explicitly (gate G2).

**From the owner**
9. The **exact tester addresses** (becomes `AUTH_EMAIL_ALLOWLIST`): suggested `+vno-uat-admin`, `+merchant`, `+partner`, `+outsider`, `+signup1`, `+signup2` aliases of mailboxes you control, plus one owner-controlled mailbox that is deliberately **not** allowlisted (negative test).
10. Decision on open sign-up (`disable_signup`); the gateway makes it safe, but UAT can also be invitation-only.
11. Approval to commit/push, to deploy API+Web, to set Railway variables, to enable the Supabase hook, and (separately) to set `AUTH_EMAIL_DELIVERY=enabled`.
12. Export (dashboard, not API) of the Auth settings in section 4 for gate G5.

## 4. Supabase Auth review (project `hsezyogfxgnkpweoqqny`) — what must be true before activation

The project token available locally cannot read Auth config, so these are **to be exported/confirmed by the owner** (gate G5). Expected values:

| Setting | Expected | Why |
|---|---|---|
| Site URL | `https://vno-web-uat.up.railway.app` | fallback destination when a redirect is refused |
| Redirect URLs | `https://vno-web-uat.up.railway.app/**` (nothing wider, no localhost in the shared UAT project unless needed) | the app sends these `redirect_to` values (below); a refused one silently falls back to the Site URL and the person lands on the home page instead of the flow |
| Providers → Email, **Confirm email** | ON (asserted by test `U03` on every run) | verified e-mail ownership is what claim relies on |
| Send Email hook | HTTPS `https://vno-api-uat.up.railway.app/auth/hooks/send-email`, secret copied to Railway | hook is the only sender (G1) |
| SMTP Settings (Auth) | **empty** | with the hook on, Auth uses neither SMTP nor its dashboard templates; if the hook is ever disabled Auth falls back to its built-in sender, which refuses non-team addresses — a safe default |
| Email OTP expiration | **86400 s (24 h)** recommended; default is 3600 s | the invitation record lives 7 days but the e-mailed Auth link only lives as long as this setting; after it the person needs a new invitation (revoke + re-invite) — the claim page shows the expired state |
| Rate limits (e-mails/hour, per address) | confirm values | a tester loop can hit the cap and look like "mail not sent" |
| Password policy | confirm minimum length ≥ 12 (the app enforces 12 + complexity on the client) | avoid a policy mismatch between client and Auth |
| Secure password change / reauthentication | note the setting | if ON, `AccountSettings` password change needs the `reauthentication` code — the template exists and is tested |
| Secure e-mail change | note the setting | the app has no change-address screen; the gateway mails only the *current* address (never a new, non-allowlisted one) |

Redirects the application sends (must all fall under the allow-list), verified against the code:

| Flow | `redirect_to` | Set in |
|---|---|---|
| Merchant sign-up confirmation | `<web>/merchant/onboard?confirmed=1` | `frontend/app/merchant/onboard/page.tsx` |
| Partner sign-up confirmation | `<web>/collaborator/onboard?confirmed=1` | `frontend/app/collaborator/onboard/page.tsx` |
| Password recovery | `<web>/reset-password` | `frontend/app/forgot-password/page.tsx` |
| Admin invitation (and magic-link fallback) | `<FRONTEND_URL>/claim/<merchant|collaborator>/<id>` | `backend invitations.service.ts` (`FRONTEND_URL` must be the UAT web origin) |

**Review findings (all handled or listed):**
1. *Invited users had no way to set a password* → fixed locally (claim panel).
2. *Application invitation allowlist and hook allowlist could drift, and invitations ignored migrated identities* → one shared policy (tested for parity: 9 probes × 3 narrowing configurations).
3. *Invitation e-mail "sent" is optimistic:* `inviteUserByEmail` succeeds when Auth hands the message to the hook; if the hook suppresses it (delivery disabled, not allowlisted) the invitation still shows `pending`. Check the gateway log (`suppressed …`) and revoke + re-invite.
4. *Auth link lifetime (OTP expiry) < invitation lifetime (7 days)* → set expiry to 24 h or accept re-invites (table above).
5. *`email_change` is not a supported UAT flow* (known limit, section 4 table).
6. A delivery failure returns **503**, which Auth surfaces to the person as a failed request (no silent loss). Suppression returns **200** so forms never reveal which addresses exist.
7. Hook delivery is at-least-once from Auth's side if the call exceeds ~5 s: the 1–4 s SMTP timeouts keep us inside that budget.

## 5. Templates (Vietnamese first, English second)

One message carries both languages: Vietnamese heading/body, then English; subject `[UAT] <Vietnamese> / <English>`; brand header (`#d91e4a`), 16 px text, full-width button ≥ 48 px (wraps to two lines on 320 px phones), **visible copy-able fallback link**, plain-text alternative, "didn't request this" notice, UAT notice. Source of truth: `backend/src/modules/auth-email-hook/email-templates.ts`. Reviewable output: `migration/v2/evidence/gate-b-prep-20261102/previews/*.html|.txt` and screenshots (`email-recovery-*`, `email-invite-*`).

| Type | Trigger | Subject (after `[UAT] `) | Button | Lands on |
|---|---|---|---|---|
| `signup` | sign-up / confirmation | Xác nhận email đăng ký VNO / Confirm your VNO email | Xác nhận email / Confirm email | onboarding `?confirmed=1` |
| `recovery` | forgot password | Đặt lại mật khẩu VNO / Reset your VNO password | Đặt lại mật khẩu / Reset password | `/reset-password` |
| `invite` | admin invitation | Lời mời tham gia VNO / You are invited to VNO | Nhận tài khoản / Claim account | `/claim/<type>/<id>` (then password panel) |
| `magiclink` | existing-account fallback | Liên kết đăng nhập VNO / Your VNO sign-in link | Đăng nhập / Sign in | claim or login |
| `email_change` | (not used in UAT) | Xác nhận thay đổi email VNO / … | Xác nhận thay đổi / Confirm change | login |
| `reauthentication` | secure password change | Mã xác minh VNO / Your VNO verification code | (6-digit code) | — |

Render check (Chromium, 320/360 px light, 390 px dark, 6 types): **18/18 PASS**, no horizontal overflow, body 16 px, button 48–72 px. The real-device check (tap from Gmail on iOS/Android/desktop, dark mode) can only be done with real delivery — step A8.

## 6. Local test results (no network, no provider, no real address, no Supabase)

`npm run test:email-delivery` — real Nest HTTP route + real gateway + real nodemailer against a local SMTP server (STARTTLS / implicit TLS / plain-loopback, self-signed certificates trusted only through `NODE_EXTRA_CA_CERTS`, so verification stays ON in the code under test): **39 PASS / 0 FAIL.**

| Requested scenario | Tests |
|---|---|
| Config matrix | accepted provider combinations; every unsafe/ambiguous value rejected; logs never contain password/full user; failure classes |
| Transport | STARTTLS+auth, implicit TLS, plain loopback relay; **no downgrade** (server without STARTTLS refused and password never sent); untrusted certificate and wrong server name refused; wrong password; recipient rejected 550; 451 on DATA; refused connection; stalled greeting gives up in < 3.5 s |
| Signup / confirmation | exactly one bilingual message, correct recipient, verify link keeps the exact `redirect_to`, plain-text twin, From / Reply-To / `Auto-Submitted` |
| Recovery / reset | same, `/reset-password` |
| Invite / claim | merchant and partner claim redirects; magic-link fallback; email-change; reauthentication code (no link); UTF-8 Vietnamese survives the wire |
| Invalid recipients | non-allowlisted, base-of-alias, migrated-but-allowlisted (two ways: by id and by address hash), malformed, header-injection (`\r\nBcc:`), comma-list → HTTP 200, **zero SMTP connections** |
| Delivery switch | unset / `disabled` / `ENABLED` / `true` all suppress with zero SMTP traffic; `enabled` sends |
| Hook authentication | unsigned, wrong secret, stale timestamp → 401; no secret → 503; none touch SMTP; identity lookup down → 503 (fail closed) |
| Delivery failures | 550, 535, 451, no STARTTLS, untrusted cert, stall, unreachable, unsafe config → 503 with a stable class; **no password, user name, host or recipient in the response or logs** |
| Invitation delivery failure | switch off or Auth send error → coded error (400 / 502), no invitation row, unused invited identity removed, audit without address, no provider text in the response |
| Admin invitations | email mode sends one Auth invitation with the claim redirect and stores no link; refused **before any Auth call and without a database row** for non-allowlisted, migrated+allowlisted, unset allowlist, lookup down; capture mode returns the link once and never stores or re-serves it |
| Same allowlist | hook vs invitation verdict identical for 9 probes × 3 narrowing configurations |
| Revoked / expired / used links | revoke deletes an unused invited Auth identity (kills the e-mailed link) but keeps a confirmed or signed-in one; claim refuses expired, revoked, already-used, wrong mailbox and unconfirmed e-mail, consumes nothing, creates no profile; replay refused |

Other suites after the change: hook unit 12/12, invitation guards 3/3, approve-unclaimed 7/7, public catalog 9/9, D6 28, D13A 37, anonymous privacy (unit) 2/2; typecheck and lint clean (backend, frontend).

**Honest scope:** Auth-side behaviours — one-time use and expiry of the verify link, redirect allow-listing, rate limits — belong to Supabase Auth, not to the gateway, and cannot be simulated locally. They are covered by the earlier real-GoTrue rig (12/12, 2026-11-02) for hook mechanics and by the frontend expired-link states (`X15`); their real behaviour is proven only in step A8.

## 7. Activation runbook (each step reversible; stop at the first failure; record evidence)

**A0 — Preconditions:** section 3 answered; approvals in item 11 obtained; `INVITATION_DELIVERY=capture`, `AUTH_EMAIL_DELIVERY=disabled`, hook off.

**A1 — Deployment (done under the 2026-11-02 Gate B code deployment; repeat only for a new commit).** Commit exactly the files listed in section 1 (never `backend/dist`, `.env`, evidence, migration working files), push, stage both `source.commitSha` values with the `environmentStageChanges` mutation, commit the patch. Verify: `/health` 200; unsigned `POST /auth/hooks/send-email` → **503** (no secret yet); `npm run test:anonymous-privacy` with `BASE_URL` 9/9; hosted `00-unauth`+`20-regression`+`40-experience` unchanged (36/36). Rollback: re-stage the SHAs at the top.

**A2 — Provider facts and sender authentication.**
1. `dig +short TXT <sender-domain>` shows the provider's SPF include; `dig +short TXT <selector>._domainkey.<sender-domain>` (or the CNAMEs the provider gave) resolves; `dig +short TXT _dmarc.<sender-domain>` returns a policy (`p=none` is fine for UAT). The provider console must show the sender/domain **Verified**.
2. Without echoing the secret: `read -s SMTP_PASS; export SMTP_PASS SMTP_HOST=… SMTP_PORT=… SMTP_SECURITY=… SMTP_USER=… SMTP_FROM=…; cd backend && npm run smtp:check` → `config OK … / session OK: encrypted channel + authentication accepted (no message sent)`. Any failure prints a class (see section 9). If the provider only accepts known IPs, run it from an allowed network and re-confirm from Railway in A5.

**A3 — Set Railway variables on `vno-api` only,** with `AUTH_EMAIL_DELIVERY=disabled`, the allowlist, SMTP_*, `INVITATION_DELIVERY=capture`. (Railway redeploys the service on a variable change — about 1–3 minutes.)

**A4 — Enable the Send Email hook (delivery still disabled).** Authentication → Hooks → Send Email → HTTPS → URL above → *Generate secret* → copy it into Railway as `AUTH_EMAIL_HOOK_SECRET`, wait for the redeploy, **then** save/enable the hook (no window in which Auth calls a gateway that does not know the secret). Leave Auth → SMTP empty. Export hook, SMTP, templates and redirect settings (G5).

**A5 — Prove the gate with delivery disabled (G1, G2, G3).**
1. Forgot-password and sign-up for an allowlisted alias, and for the owner-controlled non-allowlisted mailbox: API log `suppressed recovery to t***@…: delivery_disabled`; both mailboxes empty; the provider's message log shows nothing. Auth still answers normally (no existence leak).
2. **Never submit a migrated V1 address to a live form.** G3 evidence is the local suite (migrated + allowlisted → suppressed) and the earlier real-stack rig; confirm `legacy_identity_map` count 451 and unchanged `last_sign_in_at`.
3. Provider-side proof if the provider supports a recipient restriction (G2 second layer); otherwise record "gateway-only, accepted by owner".

**A6 — Re-run the read-only checks:** hosted anonymous privacy 9/9, `reconcile-import-target.mjs --uat --no-db` all PASS (compare with the baseline in section 10).

**A7 — Enable delivery (separate approval).** `AUTH_EMAIL_DELIVERY=enabled` (redeploy). Each action to an allowlisted alias produces **exactly one** message (check the provider log); the non-allowlisted mailbox still gets nothing and the log says `suppressed not_allowlisted`. Count `auth.users` and `legacy_identity_map` before/after (only the aliases you created may differ).

**A8 — Real-mailbox browser acceptance.** Use Playwright headed or a manual browser; capture screenshots and the provider log.
1. Sign-up (`+signup1`, Merchant onboarding) → message arrives in Vietnamese+English → tap the button → lands on `/merchant/onboard?confirmed=1` signed in and verified. Repeat for Partner (`+signup2`).
2. Login / logout; wrong password message; unconfirmed account message.
3. Forgot-password (`+merchant`) → reset page → set a password → login works; **open the same link again → expired state**.
4. Admin creates an invitation for a test Merchant whose owner e-mail is `+merchant` (set `INVITATION_DELIVERY=email` after one `capture` dry run) → one message → claim → **first password panel** → pending screen → admin approves → role redirect to the Merchant workspace. Same for a Partner (`+partner`).
5. Negatives: open the invitation while signed in as another mailbox (`+outsider`) → "Sai tài khoản email"; invite `+outsider` then **revoke before clicking** → the link no longer works and the claim shows revoked/expired; an invitation to a non-allowlisted address is refused by the admin UI/API with no Auth user created.
6. Device check: tap the button from the Gmail app on iOS and Android and desktop Gmail; the fallback link works when the button is blocked; dark mode readable.
7. Switch nothing else on; keep `INVITATION_DELIVERY=email` only while testing.

**A9 — Close.** Record: gates G1–G6 with evidence, provider log excerpt (masked), exported Auth settings, hosted suites, reconcile result. Decide: keep delivery enabled for the tester window, or disable (below).

## 8. Disable and rollback — exact procedures

| # | Situation | Action | Time to effect |
|---|---|---|---|
| R1 | **Stop all mail now** | Supabase → Authentication → Hooks → Send Email → **disable**. Auth falls back to its built-in sender, which refuses non-team addresses while Auth SMTP is empty | immediate |
| R2 | Stop delivery, keep hook | Railway `AUTH_EMAIL_DELIVERY=disabled` (or delete the variable). The gateway then answers 200 `suppressed` to everything | next deploy, ≈ 1–3 min (do R1 first if urgent) |
| R3 | Credential leaked or provider misuse | Revoke/rotate the UAT SMTP credential at the provider (immediate, provider-side); then update `SMTP_PASS` in Railway | immediate at provider |
| R4 | Hook secret leaked / signature errors after rotation | Generate a new secret in the hook dialog, update `AUTH_EMAIL_HOOK_SECRET` in Railway, wait for the deploy, then save the hook. Between the two, signed calls are refused (401) — no mail | ≈ 3 min |
| R5 | Bad release | Re-stage `source.commitSha`: API `d84fce4…` (or `f89dfb9…` to remove the gateway entirely) and Web `f89dfb9…`; `environmentPatchCommitStaged`. No database migration is involved, nothing to undo in data | ≈ 3–5 min |
| R6 | Invitations misbehaving | `INVITATION_DELIVERY=capture`: links are shown once to the admin again and no e-mail is requested from Auth | next deploy |
| R7 | **A message reached an address that is not a tester** | R1 immediately; record time, action type, masked address, provider message id; check the provider log for the recipient; rotate the SMTP credential (R3) if the cause is unknown; do **not** contact the recipient from UAT; report to the owner | — |
| R8 | Test accounts to clean up | Only Auth users created with the allowlisted aliases may be removed by an admin; never touch the 451 migrated identities, `legacy_identity_map`, the validated batch or financial tables | manual |

## 9. Troubleshooting

Gateway log lines (Railway → `vno-api` logs) never contain secrets; addresses are masked (`t***@domain`).

| Symptom | Log / evidence | Likely cause → fix |
|---|---|---|
| Sign-up/forgot form shows an error, or "Error sending … email" | `delivery failed for … : <class>` (HTTP 503 from the hook) | see the class rows below |
| Nothing arrives, form looks normal | `suppressed … : delivery_disabled` | `AUTH_EMAIL_DELIVERY` is not exactly `enabled` (typo, not redeployed) |
| | `suppressed … : not_allowlisted` | address not in `AUTH_EMAIL_ALLOWLIST` (case is ignored; a plus alias is literal; dots in Gmail do not match) |
| | `suppressed … : migrated_identity` | **by design** — a migrated V1 identity is never mailed in UAT |
| 503 `Recipient policy is unavailable` | — | identity lookup failed (Supabase keys/URL on the API, or Supabase outage); fail-closed, nothing sent |
| 503 `Auth e-mail hook is not configured` | — | `AUTH_EMAIL_HOOK_SECRET` missing on the API |
| 401 `Invalid hook signature` | — | secret in Railway ≠ secret in the hook (rotated?), or server clock off by > 5 min |
| 503 `SMTP is not configured` | `SMTP configuration rejected: <reason>` | fix the named variable (e.g. "Set SMTP_SECURITY…", "Port 465 is implicit TLS") and run `npm run smtp:check` |
| class `auth_failed` | — | wrong/rotated `SMTP_USER`/`SMTP_PASS`, or the sender not authorised for that credential |
| class `tls_failed` | — | wrong mode for the port (587 → `starttls`, 465 → `tls`), provider certificate not publicly trusted or name mismatch (`SMTP_TLS_SERVERNAME`), or the server does not offer STARTTLS. There is deliberately no way to disable verification |
| class `connection_failed` | — | wrong host/port, DNS, provider IP allow-list (Railway egress not allowed), firewall |
| class `timeout` | — | provider slower than 4 s (Auth abandons at ~5 s). Try the other port/region; do not raise timeouts |
| class `recipient_rejected` | — | provider sandbox or suppression list, mailbox does not exist; check the provider log |
| class `sender_rejected` / `message_rejected` | — | `SMTP_FROM` not authorised or content rejected; check sender verification (A2) |
| class `temporary_failure` | — | provider throttling/greylisting (4xx); wait and retry; check limits |
| Mail arrives in spam | — | SPF/DKIM/DMARC not aligned with the From domain; click/open tracking on (turn off) |
| Button opens the home page, not the flow | URL has no `/reset-password` etc. | the `redirect_to` is not covered by Auth's Redirect URLs → falls back to Site URL; fix the allow-list |
| Link says expired immediately (`#error_code=otp_expired`) | — | a mail scanner or preview pre-fetched the one-time link; use personal tester mailboxes; or OTP expiry too short (set 24 h) |
| Click-tracked link (`https://track.provider…`) | link host is not `…supabase.co` | provider rewriting links: disable tracking for this sender |
| Invitation shows `pending` but no mail | gateway log `suppressed …` | see suppression rows; revoke and re-invite after fixing |
| Invited person cannot log in with a password | — | invited accounts start without one: use the password panel on the claim page, or "Quên mật khẩu" |
| Duplicate messages | two `sent` lines for one action | the person pressed twice, or Auth retried after a > 5 s hook call; check timing |

## 10. Data-integrity verification (this preparation)

Everything in this task is local: no hosted write, no Railway/Auth change, no e-mail. Hosted was only **read**:
`reconcile-import-target.mjs --uat --no-db` (REST/Storage GET only) after all work in this task: **20 PASS / 0 FAIL / 2 NOT_RUN** (C17/C18 need SQL; both passed earlier on 2026-11-02 and nothing touched the database since). All 14 fingerprinted tables — including `legacy_identity_map` (451), `legacy_migration_batches` (1, still `validated`), `referral_transactions` (114), `collaborators` (331), `merchant_details` (159), `media_assets` (616) — are **byte-identical (row count and SHA-256) to the post-deploy baseline** `gate-a-20261102/reconcile-no-db-post-api-deploy.json`; C19 re-verified 602/602 media objects. No hosted write, e-mail, Auth or Railway change happened. Evidence: `migration/v2/evidence/gate-b-prep-20261102/` (reconcile JSON, state fingerprint, template previews, render screenshots).

## 11. Final activation checklist

- [ ] Owner answers section 3 items 1–8 (VNO e-mail service) and 9–10 (testers, sign-up decision)
- [ ] Approval: commit + push the section-1 files; deploy API + Web
- [ ] A1 deployed SHA recorded; hook route unsigned → 503; privacy 9/9; hosted suites 36/36
- [ ] A2 SPF / DKIM / DMARC verified; `npm run smtp:check` session OK
- [ ] A3 Railway variables set with `AUTH_EMAIL_DELIVERY=disabled`, allowlist exact, `INVITATION_DELIVERY=capture`
- [ ] A4 hook enabled with the generated secret; Auth SMTP empty; Auth settings exported (G5)
- [ ] A5 G1 hook is the only sender · G2 non-allowlisted mailbox empty · G3 migrated block evidenced (local + rig, no live submission)
- [ ] A6 read-only reconcile unchanged
- [ ] **Separate approval** → A7 `AUTH_EMAIL_DELIVERY=enabled`; G4 exactly one message per action; G6 no bulk action, 451 identities untouched
- [ ] A8 mailbox acceptance 1–7 green, including device and dark-mode checks
- [ ] A9 evidence filed; R1/R2 tested at least once (disable → no mail; enable → mail)
- [ ] `INVITATION_DELIVERY` back to `capture` (or `email` by decision) and tester window end date agreed
