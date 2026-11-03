# VNO V2 — Merchant Management UX: UAT acceptance and open items (2026-11-03)

**Owner decision: Conditional ACCEPT of release `3735333efaa3bb6e7cc59b2894c75a96eb494111`. The Merchant Management UX implementation scope is closed.**
UAT stays pinned at this SHA (API deployment `dca5696e-72b2-4064-b016-78c3e4474052`, Web deployment `a25dacdf-164c-43aa-901d-2133c36a2ff4`; both services read back at the SHA, nothing staged, `/health` ok) until the next approved release. This closure creates no release: nothing was deployed, no migration applied, no media uploaded, no SMTP / Auth Hook / email setting touched. Release record: `VNO_V2_MERCHANT_MANAGEMENT_UX_UAT_RELEASE_20261103.md`.

## Accepted
Compact two-line Merchant list · read-only View Mode by default · separate Edit Mode (Save/Cancel) · existing migrated media displayed in the gallery · Main Photo selection (admin) with consistent public presentation (landing card and details hero use the same image; admin main == public image for all 144 published merchants).

## Open items register (none blocks the accepted scope)

| # | Item | State | Owner / when |
|---|---|---|---|
| 1 | Hosted public propagation after a main-photo swap not directly verified | **Deferred** to the next authorised media-management UAT | Owner authorisation required |
| 2 | Database-level uniqueness and atomic main-photo swap | **Review before Production** | Not applied in this release |
| 3 | Deterministic secondary gallery ordering (47 merchants) | **Documented** below | Informational |
| 4 | Reconcile C21 | **Known variance, preserved** — complete reconciliation is **not** 100 % PASS | Informational |
| 5 | Reconcile C17 / C18 | **NOT_RUN, preserved** | Needs `SUPABASE_DB_PASSWORD` |

### 1. Hosted public propagation (deferred)
Why not done: the only synthetic merchant with several effective images (`UAT-E2E-MERCHANT`) is unverified and therefore not public; the public synthetic merchant `VNO UAT Synthetic Merchant D5` has one effective image. A hosted proof needs either a governed upload to D5 or a verification-status change — both outside this release's restrictions.
What stands in its place (not a substitute for the hosted test): hosted read-only parity before and after (admin main image id == public card image id for every published merchant; 0 card-image changes vs the pre-deploy baseline) and the local end-to-end run on a restore of UAT data (swap → public card and details hero switched after the ≤ 30 s catalog cache; 27/27).
Test to run when authorised: (a) one governed admin upload to D5 → 2 effective images; (b) Set as main on the new image via Admin UI; (c) after ≥ 30 s the public landing card and `/merchants/<D5>` hero show it (`/public/media/<id>` ids equal); (d) restore the original main; (e) retire the extra image through the governed remove request; (f) re-run reconcile and record the synthetic changes.

### 2. Uniqueness and atomic swap — review before Production
Current protection is application-level only: per-merchant serialisation in the API instance, `publication_version`-guarded row updates, a block when either image has a pending request, and a post-promotion back-out if another effective hero appears. Across several API instances the worst case is *no* explicit main (deterministic fallback to the first image), never two; no DB constraint enforces this.
Facts for the review (hosted UAT, read-only count 2026-11-03, `hero-uniqueness-hosted-readonly.json`): 616 media rows, 613 effective. **Merchants:** 115 with effective media — 112 exactly one hero, 3 none (the `UAT-E2E-*` fixtures), **0 with more than one**. **Partners:** 91 — 4 one hero, **87 none**, 0 more than one. A unique partial index per merchant is therefore applicable today without data repair; a partner-side index would only enforce "at most one" and must not require a hero.
Proposal to review (text kept in `VNO_V2_MERCHANT_MANAGEMENT_UX_20261103.md` §2, **not applied**): a `security invoker` function that takes the same owner advisory lock as `approve_media_request` and swaps the flag in one transaction, plus `create unique index concurrently … on media_assets (merchant_id) where is_hero and merchant_id is not null and publication_status in ('legacy_effective','preexisting_effective','approved')`. Review points: lock key parity with `approve_media_request`; interaction with `approve_media_request`'s own hero handling (`add`+`main` supersedes the old hero); rollback (drop index / function, no data change); a hosted pre-check re-run immediately before any apply; whether to add the equivalent partner index.

### 3. Deterministic secondary gallery ordering
Rule (admin gallery, admin main-photo choice and public catalog; `backend/src/modules/media/main-media.ts` and the public catalog query): `is_hero` descending, then `display_order` ascending, then `created_at` ascending, then `id` ascending. Before this release the last two keys did not exist, so images with equal `display_order` came back in unspecified database order.
Observed on hosted (all 144 published merchants, before vs after): card images identical; **47 merchants** show a different order of their *non-main* thumbnails — in every one of them the image set and the first (main) image are unchanged, no image was added, removed or altered. Cause: those merchants' images all have `display_order` 0 (migrated V1 images carry no explicit order). The list with old and new order is in `gallery-order-variance.json`. A preferred order can be set with the existing governed reorder request; no display-order backfill was done (it would write to migrated rows).

### 4. C21 — known synthetic-login variance
Final read-only reconcile (`--uat --no-db`, state-compare against the pre-deploy baseline), after the controlled swap and exact restoration: **20 PASS / 1 FAIL / 2 NOT_RUN**. **The reconciliation is not 100 % PASS and must not be reported as such.** The single FAIL is C21 (`tables_compared 14`, differing `user_profiles`): 11 synthetic admin/merchant/partner profiles carry login tracking from E2E logins; direct read: 0 of 451 migrated profiles have any login tracking, all 11 tracked profiles are non-migrated (same explained variance as the Gate B release). Within the same run C1–C14, C15, C16, C19 (602 media = V1 SHA-256/size), C20, C22, C23 PASS, including financial totals and all 105 transactions amount-for-amount.
Historical note: the first run (`reconcile-after.json`) additionally failed C15 and `media_assets` in C21 because the two synthetic media rows used in the swap had not yet been restored; both cleared after the guarded restore (`reconcile-after-normalize.json`, `synthetic-restore-proof.json`: media-row hash after restore == before). Both runs are kept.

### 5. C17 / C18 — NOT_RUN
C17 (fractional-rate guard trigger present and enabled) and C18 (all foreign keys resolve) need SQL and `SUPABASE_DB_PASSWORD`, which is not available; they were not run and are **not** claimed. Same status as every `--no-db` run since the Gate B release.

## Evidence (committed under `migration/v2/evidence/merchant-ux-release-20261103/`)
`reconcile-before/after/after-normalize.json`, `state-before.json`, `public-before/after.json`, `gallery-order-variance.json`, `hero-uniqueness-hosted-readonly.json`, `synthetic-restore-proof.json`, `hosted-api-after-backend.txt`, `hosted-ui-readonly.txt`, `hosted-swap-ui.txt`, `e2e-hosted-3735333.log`, `api-log.txt`.
Verified before committing: no JWT/key/token/password material, no e-mail addresses, IPs, phone numbers or local paths; the only identifiers are business/system UUIDs and V1 merchant codes. **Not committed:** screenshots (they show migrated merchants' photos, including an identifiable person on a synthetic gallery image) and the raw synthetic row snapshots (internal account ids and an upload filename) — kept locally; `synthetic-restore-proof.json` carries their hashes instead.
