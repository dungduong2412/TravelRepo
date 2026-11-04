# VNO V2 — Merchant Management direct edit: UAT release record (2026-11-04)

**Deployed SHA (API and Web together): `45cdcc6f386f61efae98eff5366362b21d1649e1`** — Railway `vno-v2-uat` / `uat`. API deployed 02:08Z and verified first; Web deployed second (SUCCESS, `source.commitSha` read back); no staged patch left over.
Rollback: re-stage both services to `3735333efaa3bb6e7cc59b2894c75a96eb494111` with `environmentStageChanges` + `environmentPatchCommitStaged` (service ids: API `4fc48af8-08a4-4040-8938-a2f75223f8ee`, Web `f23dacf5-e25d-4c9d-a9a1-dd37128d3264`). No database migration is involved.

Not done: no migration, no SMTP/Auth Hook/email change, no Railway variable change, no Production/V1 change, no merchant/media/financial data written. The hosted checks below are read-only.

## Scope
Admin row click opens the editor directly (View Mode removed); Save keeps the editor open; unsaved-change protection on Cancel/Close/outside click/Escape; every public merchant field grouped with "Shown on VNO" tags and live previews; Save sends only changed fields; the public description keeps meaningful characters (`3*`, `#1`, `Wi-Fi_free`, `> 10 khách`, `<500k`).

## Hosted results
| Area | Result |
|---|---|
| `/health`, API deployed first | PASS |
| Public catalog vs pre-deploy baseline (`public-before.json`): 144 merchants, card image changed **0**, gallery main/count changed **0**, non-main order changed **0**, detail fetch failures 0 | PASS |
| Hosted Playwright `00-unauth` + `20-regression` + `40-experience` | PASS 38/38 (same count as the previous release) |
| Read-only hosted admin walk, desktop + mobile, 3 merchants (2 migrated, 1 synthetic): row opens editor directly, Save disabled and no unsaved flag while clean, "Shown on VNO" tags and offer/address previews, no horizontal overflow, gallery with exactly one Main badge, Cancel on a clean form closes with no prompt, **0 write requests** | PASS 38/38 |
| Read-only reconcile `--uat --no-db`, state compare vs the pre-deploy fingerprints | 20 PASS / 1 FAIL / 2 NOT_RUN |

## Reconcile detail
- All 13 data tables are byte-identical to the pre-deploy fingerprints; only `user_profiles` differs (same row count 473).
- The single FAIL is **C21 — `user_profiles` only**: 11 synthetic profiles carry login tracking from the E2E/walk logins; direct read: 0 of the 451 migrated profiles have any. Same explanation as the 2026-11-03 release.
- C17/C18 are NOT_RUN (need `SUPABASE_DB_PASSWORD`), as in every no-DB run.

## Not verified on hosted
- An actual Save of an edit on hosted was **not** exercised (it would write to a merchant). Save, only-changed-fields PATCH, unsaved-change protection and public propagation were proven on the local stack by `e2e-uat/local-merchant-ux/edit-acceptance.mjs`. A hosted proof needs an owner-approved edit on the synthetic `UAT-E2E-MERCHANT` (to be reverted afterwards).
- Imported descriptions that rely on Markdown structure are still flattened by design; the format selector lets an Admin choose plain text.

## Remaining open items (carried over)
Hosted public propagation test, DB unique-hero review, 47-merchant gallery order variance, C21 explanation (above), C17/C18 NOT_RUN.

Evidence (local, not committed): `migration/v2/evidence/merchant-edit-release-20261104/`; screenshots `docs/screenshots/merchant-edit-hosted/`.
