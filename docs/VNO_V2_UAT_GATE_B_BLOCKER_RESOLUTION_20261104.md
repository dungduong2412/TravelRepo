# VNO V2 — Gate B blocker resolution and activation preparation (2026-11-04)

Written for: the owner, who completes the remaining steps in Railway and the Supabase dashboard.

**Status: privacy blocker FIXED and deployed (API only). Delivery is still disabled, the Send Email hook is still off, no e-mail was sent.** Stopped at gate G: the SMTP password, the tester addresses and the hook secret are not yet in place.

## 1. Privacy fix (owner decisions 1–2)
- **Change** (commit `1471baae48216d30ac07e292dc59c7eaeed7776f`, 3 files, +23/−3): `GET /merchants/verified` is now produced by `toLegacyVerifiedMerchant` (drops `merchant_description_format` and the ban marker). The test allow-list was **not** widened. A unit guard was added to `test-anonymous-privacy.ts`.
- **Rendering preserved:** the public Merchant Details / listing API still applies `plain_text` vs `markdown` server-side. Hosted vs patched code: all **144/144** `/public/merchants/:id` responses byte-identical; legacy response identical apart from the removed key. Unit assertions: markdown → `trích một tagx`, plain text → `> trích một #tag_x`, the public detail never exposes the flag.
- **Results:** anonymous privacy **10/10** (the original 9 + 1 new) locally against UAT data *before* deploy and again on hosted UAT after deploy. Backend suites: d6 28, d13a 37, invitation-guards 3, approve-unclaimed 7, main-media 13, public-catalog 14, media-lifecycle PASS, auth-email-hook 12, email-delivery 39/0; `tsc` and lint clean.
- **Deploy:** API only, `source.commitSha` = `1471baa…`, deployment SUCCESS, `/health` ok. **Web unchanged at `45cdcc6…`.** No migration, no data written. Rollback: re-stage API to `45cdcc6f386f61efae98eff5366362b21d1649e1` (`environmentStageChanges` + `environmentPatchCommitStaged`).
- **After deploy:** hosted Playwright `00-unauth`+`20-regression`+`40-experience` **38/38**; read-only reconcile `--uat --no-db` **20 PASS / 0 FAIL / 2 NOT_RUN** (C17/C18 need the DB password); all table fingerprints equal the baseline except `user_profiles` (synthetic login tracking); 451 migrated identities untouched.
- Lesson recorded: the previous release (`45cdcc6`) was verified without the hosted anonymous-privacy scan; it is now part of every release check.

## 2. Railway `vno-api` configuration status
| Variable | State |
|---|---|
| `AUTH_EMAIL_DELIVERY` | `disabled` |
| `INVITATION_DELIVERY` | `capture` |
| `SMTP_HOST` / `PORT` / `SECURITY` | `mail.vietnamnumberone.com` / `587` / `starttls` |
| `SMTP_USER` / `FROM` / `REPLY_TO` / `FROM_NAME` | `support@vietnamnumberone.com` ×3 / `VNO Support` |
| `SMTP_PASS` | **not set** (owner enters it in Railway) |
| `AUTH_EMAIL_ALLOWLIST` | **not set** → fail closed, nobody is allowed |
| `AUTH_EMAIL_HOOK_SECRET` | **not set**; unsigned hook call → 503 |
| `INVITATION_EMAIL_ALLOWLIST` | unset (correct) |

Supabase Auth (public settings only): e-mail provider on, **confirm e-mail ON**, **open sign-up ON** (kept by decision 7), OTP expiry untouched. The Auth dashboard settings (custom SMTP empty, hook state, redirects) **cannot be read with the available token** — they are unverified (see 3.3).

## 3. Exact remaining actions (in this order)
1. **SMTP password (owner, Railway dashboard):** project `vno-v2-uat` → environment `uat` → service `vno-api` → Variables → *New Variable* `SMTP_PASS` → paste the OxMail password → Add → Deploy. Do not paste it in chat, Git or a terminal. Railway redeploys the API (it builds the branch head; the code is identical to the pinned SHA).
2. **Tester addresses (owner):** reply with the exact addresses for admin, merchant, partner, outsider, signup1, signup2 and one *separate* owner-controlled mailbox that is deliberately **not** allowlisted (negative test). No public-provider domains, no migrated V1 customer address. I set `AUTH_EMAIL_ALLOWLIST` from that list (not secret).
3. **Supabase dashboard (owner), project `hsezyogfxgnkpweoqqny`, Authentication:**
   a. *SMTP Settings*: confirm **custom SMTP is off/empty** and send me a screenshot (this is what stops Auth from mailing anyone once the hook is disabled or fails).
   b. *Hooks → Send Email → HTTPS*: URL `https://vno-api-uat.up.railway.app/auth/hooks/send-email` → **Generate secret** (format `v1,whsec_…`, shown once). Put it in Railway as `AUTH_EMAIL_HOOK_SECRET` (same Variables screen), wait for the redeploy, **then** save/enable the hook. Never paste the secret in chat.
   c. Export or screenshot: Site URL, Redirect URLs (`https://vno-web-uat.up.railway.app/**` only), Confirm email, rate limits. Do not change OTP expiry.
4. **SMTP connectivity + authentication check (non-sending).** This Mac's network blocks outbound SMTP on all ports (25/465/587/2525 on the VNO and OxMail hosts, and `smtp.gmail.com:587`), so it cannot run here. Cleanest option that keeps the password inside Railway: register an SSH key with Railway (`ssh-keygen -t ed25519`, then `railway ssh keys add`) — I will not add one to your account without your say-so — and run inside the container: `railway ssh --service vno-api -- node -e "const c=require('./dist/modules/auth-email-hook/smtp-config');(async()=>{const s=c.readSmtpSettings();console.log('config OK: '+c.describeSmtp(s));try{await c.createSmtpTransport(s).verify();console.log('session OK (no message sent)')}catch(e){console.error('SESSION FAIL: '+c.classifySmtpError(e));process.exit(1)}})()"`. It connects, does STARTTLS with certificate verification ON, authenticates and quits; nothing is sent. If 587 fails with `connection_failed`/`timeout`, set `SMTP_PORT=465`, `SMTP_SECURITY=tls` and repeat — certificate verification stays on in every case; if the failure is `tls_failed`, the fix is the name/chain (`SMTP_TLS_SERVERNAME`), never disabling verification. Ask OxMail whether it restricts by source IP (Railway egress IPs are not fixed).
5. **Gate F proof (me, after 1–3, delivery still disabled):** unsigned/wrong-signature hook → 401/503; signed hook calls for (a) a non-allowlisted address, (b) the negative mailbox, (c) a migrated identity id/address hash → HTTP 200 *suppressed* with zero SMTP traffic and nothing in the provider log; admin invitation in `capture` mode returns the link once and requests no e-mail; e-mail-mode invitation refused with `INVITATION_DELIVERY_DISABLED`. The same matrix already passes offline (hook 12/12, delivery 39/39, including migrated-and-allowlisted blocked two ways and zero SMTP connections for blocked recipients); this step repeats the signature/recipient cases against the hosted hook. No live form is ever submitted with a migrated address.
6. **Gate G report (me):** PASS/FAIL table for steps 1–5. **Only after it is green, and with your separate approval,** `AUTH_EMAIL_DELIVERY=enabled` and the real-mailbox UAT (runbook A7–A8). `INVITATION_DELIVERY=email` only after the capture-mode dry run.

## 4. Known risks
- With the hook **off** and sign-up **open**, anyone can submit the sign-up form; whether Supabase then sends anything depends on Auth's SMTP setting (3.3a). Until that screenshot is confirmed this is unverified; enabling the hook before delivery (steps 3–5) makes the gateway the only sender.
- `support@vietnamnumberone.com` appears to be the existing support mailbox, not a UAT-only credential: revoking the password later (rollback R3) also affects it.
- A Railway variable change redeploys from the branch head, not the pinned SHA; keep the branch free of code changes during the activation window.

Evidence (local, not committed): `migration/v2/evidence/gate-b-blockers-20261104/`.
