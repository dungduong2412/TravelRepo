# VNO V2 — Authorized UAT Security and Experience Release (2026-11-02)

**Deployed SHA (API and Web): `f89dfb909c230abae28579568c2e9249d96522af`** on Railway project `vno-v2-uat`, environment `uat`, branch `codex/vno-phase-d4-security`. Rollback targets: API `6bbf232683f8824b17a80d81703e9274af74159c`, Web `e3b87982be915dad09220b1cdf35e040ce437247` (re-stage `source.commitSha` with the `environmentStageChanges` mutation and commit the staged patch).
A later commit `93f701c` (inert Auth e-mail hook gateway) is pushed but **not deployed**.

## Phase 1 — P0 privacy fix: DONE and verified on hosted

Audit of every anonymous route (`@Public` and unguarded controllers):

| Route | Finding | Action |
|---|---|---|
| `GET /merchants/verified` | all columns: owner name/phone/e-mail/tax code, `legacy_*` (4.5 MB, 144 Merchants) | explicit column allow-list; banned excluded; 112 KB |
| `GET /categories`, `/active`, `/:id` | exposed `legacy_category_id`, `legacy_tenant_id` | explicit columns |
| `GET /organization-profile` | `select *` | explicit columns |
| `GET /media/approved/:ownerType/:ownerId` | anonymous; returned `original_filename`, `bucket_id`, `object_path`, `sha256_hex`, and Partner images by UUID | now requires a valid token (the web only calls it from the signed-in Admin page); anonymous Merchant images go through `GET /public/media/:id` |
| `GET /c/:token`, `GET /collaborators/code/:code` | already an explicit 4-field DTO (id, name, rating, verified) | unchanged |
| `POST /auth/login` | not a data endpoint | unchanged |
| new `/public/*` | allow-list projection (no `merchant_email`/`merchant_phone`, which equal the owner's personal contact for ~140/144 rows) | n/a |

Evidence: `backend/scripts/test-anonymous-privacy.ts` deep-scans keys at any depth, nested objects/arrays and structured string values of **every anonymous GET** (including all 144 `/public/merchants/:id`). Against the previously deployed build it fails (it detects `owner_email`, `legacy_*`); against the deployed SHA **9/9 PASS** (`migration/v2/evidence/security-release-20261102/privacy-hosted-f89dfb9.txt`). Hosted spot checks after deploy: `/merchants/verified` 144 rows with 11 public keys, no `owner_*`/`legacy_*`; anonymous approved-feed 401 for Merchant and Partner.

Deployment: the API was deployed first and alone (it is backward compatible: it only removes fields and one anonymous route that no deployed screen used anonymously), verified on hosted, then the Web.

## Phase 2 — integrated experience: DONE, with one gated item

Deployed in the same reviewed commit: real discovery + detail, categories/search/pagination, public-approved resized media, Partner Home QR (enlarge/download), auth and pending-approval screens, hardened invitations, design system and responsive layouts. Release hygiene: only release paths were committed (no `.env`, credentials, evidence, `backend/dist`, `frontend/.next`, migration working files, customer data; secret/PII scan of the staged diff found only synthetic fixtures).

**Migration `20261102000001` is NOT applied (gated).** Review result: it is `UPDATE invitations SET invite_link = NULL` plus a column comment. Hosted UAT holds 4 invitations, all `accepted` (links already consumed), 0 pending, so no live Auth link or pending invitation is affected; the new code no longer reads or writes the column. It is not reversible (the links are credentials; recreate by revoke + re-invite). Applying it correctly requires reading the UAT migration history and DDL privileges, which needs `SUPABASE_DB_PASSWORD` (absent in this session; the CLI path fails with 42501 without it). A REST-only PATCH was deliberately **not** used as a substitute because it would leave `supabase_migrations` history inconsistent. To apply: export the password, read `supabase migration list --linked`, then apply this single file (never `db push` blanket).

## Phase 3 — hosted acceptance on the deployed SHA

Run: `tests/00-unauth` + `tests/20-regression` + `tests/40-experience` against `vno-web-uat` / `vno-api-uat`: **36 PASS, 0 FAIL, 0 SKIP.** Backend security suites: anonymous privacy 9/9 (hosted); public-catalog 9/9, D6 28, D13A 37, invitation-guards 3, approve-unclaimed 7, auth-email-hook 10 (local). Not run on purpose: `30-operational` (writes simulated transactions into financial tables) and `10-onboarding` (needs a fresh identity pair and a mailbox).

| Required | Result |
|---|---|
| Anonymous Merchant endpoints expose no personal/financial fields | PASS (9/9 deep scan; X08) |
| Merchant detail with actual migrated data | PASS (X04, X05, X01c: 144 listings, each once) |
| Restaurant filter | PASS (X02: 36 = DB links) |
| Approved images render | PASS (X01b decoded photos, X05, X07 SHA-256 identity vs governed object, X07b rendition 70 KB) |
| Partner QR on Home, canonical code, download | PASS (X10: decoded QR = canonical code, `VNO-QR-<code>.png`, merchant scan resolves, no financial action) |
| Migrated Partner remappings correct | PASS (X11) |
| Existing role authorization intact | PASS (R01–R09, X12, X14) |
| No regression to historical financial data | see the reconcile line below |

Historical data (read-only reconcile on hosted after deployment and testing): `reconcile-import-target.mjs --uat --no-db` **20 PASS / 0 FAIL / 2 NOT_RUN**. PASS includes C1 (140 Merchants, 312 Partners, 105 transactions), C3/C4 (financial totals and every transaction amount-for-amount equal V1), C14 (pre-existing rows byte-identical), C19 (602 media objects match V1 SHA-256 and size) and C23 (4 Partner remappings intact). NOT_RUN = C17/C18, which need SQL (no DB password). Evidence: `migration/v2/evidence/security-release-20261102/reconcile-no-db-post-deploy.json`.

## Phase 4 — e-mail: PREPARED, NOT ENABLED (separately gated)

No Auth, SMTP, hook or template setting was changed and no e-mail was sent. Delivered: the finding that an application allowlist cannot protect Supabase Auth's own sender (open sign-up is on and the 451 migrated identities exist in Auth); an inert, tested hook gateway enforcing allowlist + migrated-identity block + fail-closed (commit `93f701c`); the gate G1–G6 and the owner prerequisites in `docs/VNO_V2_UAT_EMAIL_SETUP_PREREQUISITES_20261102.md`. Genuine mailbox E2E (signup, login, forgot/reset, invitation claim) cannot run until the owner supplies the provider/sender/credentials, tester mailboxes and template/redirect export, and the gate passes.

## Residual items

1. Provide `SUPABASE_DB_PASSWORD` to apply the invitation migration safely and to run C17/C18 and the catalog verifier.
2. Phase 4 prerequisites above (SMTP provider and UAT sender, tester inboxes, Auth template/redirect export, open sign-up decision).
3. Previous business gaps remain (discount conditions/coordinates not in the data, admin/merchant sub-pages on legacy styles, display precision of money, public rate limiting, physical QR card replacement for `C2500228`/`C2500240`).
4. `C21` (state compare) differs from the 2026-11-01 state file only by authorized finalization (`validated`) and synthetic-user login tracking; refresh the state file before relying on it.
