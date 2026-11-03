# VNO V2 — Merchant Management UX: UAT release record (2026-11-03)

**Deployed SHA (API and Web together): `3735333efaa3bb6e7cc59b2894c75a96eb494111`** — Railway `vno-v2-uat` / `uat`; API deployment `dca5696e-72b2-4064-b016-78c3e4474052` SUCCESS, Web deployment `a25dacdf-164c-43aa-901d-2133c36a2ff4` SUCCESS; both services read back at this `source.commitSha`; no staged patch left over. API was deployed and verified first, Web second.
Rollback: re-stage both services to API/Web `1b3d25d9c2b09f81f9782b194e346b369c970ecb` (previous deployments API `377638c3-d337-4562-9c15-0372c40a654b`, Web `5634db2a-1b0a-4d28-8688-821776535cfb`) with `environmentStageChanges` + `environmentPatchCommitStaged`. No database migration is involved; Set-as-Main only flips `media_assets.is_hero`.

Not done, by instruction: no migration (the optional atomic-swap function and unique index were **not** applied), no SMTP/Auth Hook/email change, no Railway variable change (API variable names unchanged), no Production/V1 change, no financial or settlement mutation, no media object deleted, duplicated or overwritten.

## Review
Committed by explicit path: 20 files (backend media/merchants/public-catalog, new `main-media.ts`, frontend admin page + 3 components, report, loopback-only `e2e-uat/local-merchant-ux/` harness, tests). Not staged: `backend/dist`, `.gitignore`, `migration/**`, `frontend/AGENTS.md`, `docs/V1_V2_*`, screenshots, evidence. Scan: no secret-shaped strings; only three `local.invalid` fixture addresses and a loopback-only fixture password in a script that refuses non-loopback targets.

Release-review finding fixed before deploy: two admins selecting different images at the same moment could both promote (the second reads "no hero" after the first's demote) and leave a merchant with two Main Photos. Swaps are now serialised per merchant in the API instance, and a request that sees another effective hero after promoting withdraws its own promotion (409). Verified with 2 unit tests and 6 rounds × 12 simultaneous HTTP swaps locally (always exactly one hero, all images still effective). The version guards, pending-request block and tenant checks were re-verified (local 25/25 on fresh fixtures).

## Quality gates (final code)
Backend `tsc`, `npm run lint`; all backend suites (main-media 13, media-lifecycle, public-catalog 9, anonymous-privacy 2 + hosted live scan **9/9**, d6 28, d13a 37, invitation-guards, approve-unclaimed 7, auth-email-hook 12, email-delivery 39); frontend `tsc`, `eslint` (0 errors), `next build`; e2e `tsc`.

## Hosted results (PASS/FAIL/SKIP)
| Area | Result |
|---|---|
| `/health`, public categories, public count (144), every public card image vs pre-deploy baseline | PASS — 0 changed |
| Admin directory: 159 records, new fields, no owner password; admin Main Photo == public card image for every published merchant | PASS — 0 mismatches |
| Thumbnails: 115/115 merchants with an image have a signed thumbnail; 23/23 sampled return real images | PASS |
| Gallery images of 12 migrated merchants (26 images) resolve | PASS |
| Authorization: anonymous 401; merchant owner / partner / outsider 403; cross-tenant media 404; non-effective image 400; malformed ids 400; directory admin-only; merchant media listing tenant-scoped; all refused calls left D5's rows unchanged | PASS (20/20, `hosted-api-after-backend.txt`) |
| Browser, desktop + mobile: 25 real rows each exactly two lines, no overflow, no horizontal scroll, thumbnails decode (20/20, 13/13), row opens read-only View Mode, all 4 migrated images of two merchants visible, exactly one Main badge; landing cards = API main image (12/12), details hero = card | PASS (20/20) |
| Existing behaviour: hosted Playwright `00-unauth` + `20-regression` + `40-experience` (Auth by role, Partner workspace, QR scan/download/remaps, authorization, forgot/reset/claim) | PASS 38/38 (same count as the previous release) |
| Gate B email: unsigned and wrong-signature `POST /auth/hooks/send-email` → 503 (fails closed); no `AUTH_EMAIL_*`/`SMTP_*` variable; 0 email-related lines in the API log | PASS |
| Public propagation of a swap on the hosted site | **SKIP** — see below |
| Reconcile C17/C18 (need the DB password) | NOT_RUN, as in every no-DB run |

## Controlled Set-as-Main test (synthetic merchant `UAT-E2E-MERCHANT`, id `d5a4ffba-b500-4e32-bc82-ca73c22c57f3`)
Done through the hosted Admin UI: 4 effective images, no hero flag (effective main = fallback `ef6acbdf` `e2e-r1031233246.png`).
1. Set as main `ca761100` (`e2e-r1031233359.png`) → badge moved, still 4 images, one main; **full reload: persisted**. Audit `media.main_set` 03:14:23Z, previous `[]`.
2. Restored: Set as main `ef6acbdf` → original image main again; **reload: persisted**, 4 images intact. Audit `media.main_set` 03:14:30Z, previous `[ca761100]`.
3. The two rows then differed from the snapshot only by an explicit `is_hero=true` on `ef6acbdf` and `publication_version` (1→2 and 1→3); no row/object/path/hash/order/status change, total media still 616. Those two values were reset with a guarded REST patch on exactly those two rows; the rows are then **byte-identical to the pre-test snapshot** (`synthetic-before.json` == `synthetic-after-normalize.json`). That one patch is the only write outside the API.
Screenshots: `docs/screenshots/merchant-ux-hosted/swap-*.png` (local, not committed).

**SKIP — hosted public propagation.** The only synthetic merchant with several effective images is unverified (not public); the public synthetic merchant `VNO UAT Synthetic Merchant D5` has one effective image. Proving it on hosted would need a new upload or a verification-status change, which were outside this release's restrictions. Covered instead by: hosted read-only parity (admin main == public image for all 144 published merchants, before and after), and the local end-to-end run (public card and hero switched to the selected image after the 30 s cache, 27/27). If you want a hosted proof, authorise one governed upload to D5 (to be retired afterwards).

## Data integrity — read-only reconcile (`--uat --no-db`, state compare vs the pre-deploy baseline)
After the controlled test and exact restoration: **20 PASS / 1 FAIL / 2 NOT_RUN**. C1–C14, C15, C16, C19 (602 media match V1 SHA-256 and size), C20, C22, C23 PASS; C3–C6 financial totals and all 105 transactions amount-for-amount = V1; QR/partner mappings intact. The single FAIL is **C21 — `user_profiles` only**: 11 synthetic admin/merchant/partner profiles carry login tracking from the E2E logins (direct read: 0 of 451 migrated profiles have any login tracking; the 11 tracked are all non-migrated) — the same difference explained in the Gate B release. The first reconcile, taken before the two synthetic rows were restored, additionally showed C15 and `media_assets` in C21 failing; both cleared after the exact restoration, which confirms they were caused solely by the test rows.
Expected synthetic-test changes: 2 audit events (`media.main_set`), login tracking on the synthetic E2E profiles. API log: one expected refusal line (regression suite's unclaimed-owner approval guard).
Evidence (local, not committed): `migration/v2/evidence/merchant-ux-release-20261103/`.

## Observed side-effect (not a failure)
Public gallery comparison before/after the release (all 144 published merchants): same image set and the **same first (main) image for every merchant**, card images identical; but the order of the *non-main* thumbnails differs for **47 merchants**. Their images all share `display_order` 0, which the database previously returned in arbitrary order; the release adds a deterministic tie-break (`created_at`, then `id`), so the order is now stable but not the previous arbitrary one. No image was added, removed or changed. Admins can fix a preferred order with the existing governed reorder request; a one-off display-order backfill was not done (out of scope, would write to migrated rows).

## Remaining issues
- Hosted public propagation of a swap is not proven on hosted (SKIP above).
- Optional atomic function + unique index remain proposed, not applied; the API-level guards are the only protection against two heroes. Cross-instance races degrade to "no explicit main" (deterministic fallback), never two.
- A newly selected main appears publicly within ~30 s (catalog cache).
- C17/C18 need `SUPABASE_DB_PASSWORD`.

## Recommendation
**UAT sign-off recommended** for: compact list, View/Edit modes, gallery, upload, Set as Main and admin-side persistence, with the SKIP and the C21 explanation recorded. Public-propagation proof on hosted is the one open item; it can be closed with one governed upload to D5 if you want it before Production planning.
