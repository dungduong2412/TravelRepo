# VNO V2 — Gate B code deployment to UAT (2026-11-02)

**Deployed SHA (API and Web together): `1b3d25d9c2b09f81f9782b194e346b369c970ecb`** — Railway `vno-v2-uat` / `uat`; API deployment `377638c3-d337-4562-9c15-0372c40a654b` SUCCESS, Web deployment `5634db2a-1b0a-4d28-8688-821776535cfb` SUCCESS; both services read back at this `source.commitSha`. One staged patch containing only the two `commitSha` values.
Rollback: re-stage both services to API `d84fce427565ced62aed5ff712aa6b190a1a6ba1` / Web `f89dfb909c230abae28579568c2e9249d96522af` with `environmentStageChanges` and `environmentPatchCommitStaged`. No database migration is involved.

Not done, by instruction: no SMTP credential, no Railway variable, no Auth setting, no Send Email hook, no e-mail, no change to V1, Production, financial history, payments or settlement.

## Review (item 1–5)
* Reviewed diff = 22 files (provider-neutral SMTP, shared recipient policy, templates, claim-page password gate, admin invitation wording, tests, docs, `.env.example` placeholders). Staged by explicit path; **not** staged: `backend/dist`, `.gitignore`, `migration/**`, `frontend/AGENTS.md`, `docs/V1_V2_*`, evidence, screenshots.
* Scan of the 22 files: no secret-shaped strings, no service key, no PEM/JWT; 20 e-mail addresses, all synthetic; their SHA-256 hashes match **0** rows of the hosted `legacy_identity_map` and 0 of the 475 `auth.users`.
* Password only after verified identity and an authorized claim: the form is rendered only after the server accepted the claim, and only if Auth's `getUser()` (server-validated token) reports a **confirmed e-mail**; otherwise the person gets login / forgot-password and never the form (X18b).
* Passwordless onboarding: for an invited identity without a password the form is **mandatory** (no skip, no workspace button until saved; weak / mismatched passwords never reach Auth) (X18). Limit: `password_set` is a UX marker; someone who closes the tab keeps a bound profile and recovers through "Quên mật khẩu" (verified e-mail).
* Delivery failure vs claim status: e-mail invitations are refused with `INVITATION_DELIVERY_DISABLED` / `INVITATION_RECIPIENT_NOT_ALLOWED` before any Auth call; an Auth/hook/provider failure returns `502 INVITATION_EMAIL_FAILED`, creates **no** invitation row and removes an unused invited identity; success returns `delivery_status` (`handed_to_auth` / `link_captured`). A `pending` invitation therefore never means "failed delivery". No token or address in errors or audit.

## Local verification before deploy
Backend typecheck + production build (temp outDir) + ESLint clean; frontend typecheck, ESLint (0 errors; 11 pre-existing warnings) and `next build` clean. Backend suites: **e-mail delivery 39/39** (the 38 plus the new delivery-failure case), hook unit 12/12, invitation guards 3, approve-unclaimed 7, public catalog 9, D6 28, D13A 37, media lifecycle PASS, anonymous privacy unit 2. Hermetic claim-gate E2E X18/X18b PASS.

## Hosted results on the deployed SHA
| Check | Result |
|---|---|
| `/health` | 200 `{"status":"ok"}` |
| Web `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/claim/merchant/<id>` | all 200 |
| `POST /auth/hooks/send-email` unsigned / wrong signature | **503** (no `AUTH_EMAIL_HOOK_SECRET`; fails closed before reading the request) |
| Anonymous privacy contract against hosted (144 merchant details) | **9/9 PASS** |
| Hosted Playwright: `00-unauth` + `20-regression` + `40-experience` (incl. X10 QR scan/download, X11 QR remaps, X13 login by role, X14/R01–R09 authorization, X15 forgot/reset/claim states, X18 claim password gate) | **38 PASS / 0 FAIL / 0 SKIP** (`e2e-hosted-1b3d25d.log`) |
| Not run on purpose | `30-operational` (writes simulated transactions into financial tables) and `10-onboarding` (consumes a fresh identity pair and a mailbox) — both would change data or need e-mail |

## E-mail stays off (item 10)
* Railway `vno-api` variable names after deploy: `CORS_ORIGINS FRONTEND_URL NODE_ENV PORT SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_URL` — **no** `AUTH_EMAIL_*`, `SMTP_*` or `INVITATION_*`; therefore delivery is disabled, the hook route has no secret and no SMTP transport can even be built.
* API log since deploy: only start-up lines for the hook module; **no** `suppressed`, `sent` or `delivery failed` line, i.e. the route was never reached by Auth.
* Supabase Auth settings cannot be read with the available token. Evidence that the Send Email hook is not enabled: the gateway has never received a call, and with no secret it would answer 503. The owner's G5 export remains the authoritative confirmation.

## Data integrity (item 11) — read-only
`reconcile-import-target.mjs --uat --no-db` after all testing: **20 PASS / 0 FAIL / 2 NOT_RUN** (C17/C18 need SQL; `supabase db query --linked` answered 42501 on the login role today, so they were not re-run and are not claimed). C1 (140 Merchants, 312 Partners, 105 transactions), C3/C4 (financial totals and every transaction amount-for-amount = V1), C14 (pre-existing rows byte-identical), C19 (602 media objects match V1 SHA-256 and size), C20, C22 (QR mappings) and C23 (4 Partner remappings) PASS.
All 14 fingerprinted tables equal the post-deploy baseline **except `user_profiles`**: 11 synthetic admin/merchant/partner profiles carry login tracking from the E2E logins (the same, previously explained difference). Direct reads: 0 of 451 migrated profiles has any login tracking, `auth.users` 475, `legacy_identity_map` 451, batch status `validated`, stored invitation links 0, all 451 migrated profiles `active`.
**A first reconcile run reported 4 FAIL** (C19 with 10 "mismatched" files and three `READ:` failures, all `fetch failed`): a transient network error of the checking script (it counts a failed download as a mismatch — same behaviour seen on 2026-11-02 earlier). The three tables read fine immediately afterwards (1 / 109 / 14 260 rows) and the **full rerun passed 20/0**. Both runs are kept in `migration/v2/evidence/gate-b-prep-20261102/`.

## Remaining e-mail activation prerequisites
Owner-supplied: the existing VNO e-mail service's SMTP facts (host, port, security mode, UAT-only credential, UAT sender with SPF/DKIM/DMARC, IP restrictions, limits, tracking off, recipient restriction), the exact tester addresses plus one deliberately non-allowlisted mailbox, the open-sign-up decision, and an export of the Supabase Auth settings (Site URL, redirect allow-list, hook, SMTP, templates, OTP expiry — 24 h recommended). Approvals still required, each separately: setting Railway variables with `AUTH_EMAIL_DELIVERY=disabled`; enabling the Supabase hook; then `AUTH_EMAIL_DELIVERY=enabled`. Steps, rollback and troubleshooting: `VNO_V2_UAT_EMAIL_GATE_B_RUNBOOK_20261102.md`.
