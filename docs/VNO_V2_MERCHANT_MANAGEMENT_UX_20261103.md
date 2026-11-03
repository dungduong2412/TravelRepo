# VNO V2 — Merchant Management UX Improvement (2026-11-03)

Status: implemented and verified **locally**; **not deployed**, no hosted UAT data read or written, no schema migration applied, Gate B email configuration untouched.

## 1. Root causes (investigated before any change)

| # | Finding | Evidence |
|---|---|---|
| R1 | The Admin list was a 7-column table (commercial terms, dates, source status, three action buttons per row). It had no thumbnail, no category and no location, overflowed on mobile, and only the "Details" button opened a Merchant. | `frontend/app/admin/merchants/page.tsx` (old table), `GET /merchants/admin-directory` returned no media or category data |
| R2 | The detail drawer was already read-only with a separate Edit drawer, but: after Save the View showed the **old** data until a second fetch finished; a rejected Save printed its error *behind* the overlay; closing Edit by clicking outside discarded a dirty draft silently; there was no Cancel button and no View on VNO action. | page.tsx `saveMerchant`, overlay handlers |
| R3 | **The schema already supports a Main Photo**: `media_assets.is_hero` + `display_order` + `publication_status`. The public catalog already serves the Merchant card image and the details hero from it (`is_hero desc, display_order`). | `20261018021253_vno_phase_d10b_media_approval.sql`, `public-catalog.service.ts` |
| R4 | **There was no operation to promote an existing gallery image.** The only way to change Main was to upload a new file with slot `main`; `approve_media_request` then marks the previous hero `superseded` — i.e. removes it from the gallery. That violates "gallery images remain intact". | `approve_media_request` (`add` + `main`) |
| R5 | The Admin gallery listed every row in `media_assets` (superseded / removed / rejected / pending / failed mixed in with live images) and offered no way to tell which were eligible for Main. | `operationalDetail` + old "Pictures & Gallery" section |
| R6 | No uniqueness constraint on "one effective hero per Merchant", and the public ordering had no tie-breaker, so a Merchant with no hero (or ties) got a non-deterministic image. | `media_assets` indexes (non-unique), public `order('display_order')` |
| R7 | Pre-existing layout flaw: detail grid columns were so narrow that values wrapped word by word. | screenshots |

Data facts (restore copy of UAT, 159 merchants / 413 merchant images): 115 merchants have effective images; 112 have exactly one hero, 3 have none (all three are `UAT-E2E-*` fixtures, not migrated V1 records); 0 have more than one. All 4 images of every sampled migrated merchant resolve in Storage.

## 2. Schema decision

**No migration is required and none was applied.** `is_hero` is reused. Set-Main is implemented in the API as a version-guarded swap (see §3).

Optional hardening, **proposed only, not applied** (needs separate approval; precondition: re-check hosted UAT has 0 merchants with >1 effective hero):

```sql
-- 1) atomic swap, takes the same owner advisory lock as approve_media_request
create or replace function public.set_merchant_main_media(p_merchant_id uuid, p_media_id uuid, p_actor_user_id uuid)
returns public.media_assets language plpgsql security invoker set search_path = pg_catalog, public as $$
declare owner_lock text := 'merchant:' || p_merchant_id::text; row public.media_assets;
begin
  if not exists (select 1 from public.user_profiles where user_id = p_actor_user_id and role = 'admin' and user_profiles_status = 'active')
    then raise exception 'active Platform Admin required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_lock, 0));
  update public.media_assets set is_hero = false, publication_version = publication_version + 1
    where merchant_id = p_merchant_id and is_hero and id <> p_media_id
      and publication_status in ('legacy_effective','preexisting_effective','approved');
  update public.media_assets set is_hero = true, publication_version = publication_version + 1
    where id = p_media_id and merchant_id = p_merchant_id and transfer_status = 'verified'
      and publication_status in ('legacy_effective','preexisting_effective','approved') returning * into row;
  if not found then raise exception 'media not eligible' using errcode = 'P0001'; end if;
  return row;
end $$;
-- 2) invariant: at most one effective hero per Merchant
create unique index concurrently if not exists media_assets_one_effective_hero_per_merchant
  on public.media_assets (merchant_id)
  where is_hero and merchant_id is not null and publication_status in ('legacy_effective','preexisting_effective','approved');
```

Why the API version is acceptable without it: every row change is guarded by `publication_version`; a concurrent approval/edit aborts the swap and the previous hero is restored; a pending approval request on either image blocks the swap. The residual risk is a crash between the demote and promote writes, which leaves the Merchant with *no* hero — the public site then falls back deterministically to the first image (never broken) and the Admin can re-select.

Concurrency hardening (release review): swaps are serialised per Merchant inside the API instance, and after promoting, a request that finds another effective hero (another instance) withdraws its own promotion and returns 409 — so a Merchant can never keep two Main Photos; the worst case is none (deterministic fallback), never two. Verified with 6 rounds × 12 simultaneous HTTP swaps (always exactly one hero, all 3 images still effective) and two unit tests.

## 3. Changes

Backend
- `POST /media/merchants/:merchantId/main` `{ media_id }` — Platform Admin only. The image must belong to the path Merchant (cross-tenant → 404), be effective + verified (else 400), have no pending request (409). Flips `is_hero` only: no copy, no Storage change, no legacy-mapping change, `display_order` untouched, previous hero stays in the gallery. Audited as `media.main_set`.
- `GET /merchants/admin-directory` gains `category_names` and `main_image { id, thumb_url }` (signed 160 px thumbnail of the same asset the public site uses). Lookup failures degrade to "no image".
- `media/main-media.ts`: one shared "which image is Main" rule (hero → display_order → created_at → id); the public catalog query got the same tie-breakers.
- `scripts/test-main-media.ts` (`npm run test:main-media`, 11 contract tests).

Frontend (`frontend/components/admin/` + `app/admin/merchants/page.tsx`)
- Two-line rows: thumbnail · name + verification badge / code · category · location, each line truncated; the whole row opens **View Mode**. Filters/search/sort/pagination/authorization unchanged; filter bar is now responsive.
- View Mode: Main photo hero, **Edit**, **View on VNO** (enabled only for verified, non-banned Merchants), Approve/Reject/Deactivate moved here from the row. Gallery of every effective image with **Set as main**, upload (added to the gallery; becomes Main only when the Merchant has none), and a collapsed History of non-published files.
- Edit Mode: separate state with Cancel / Save; unsaved changes prompt before discard; Save refreshes the data *before* returning to View; errors render inside the form.
- Broken/missing images: thumbnail → authorised original → placeholder; pictures show "Preview unavailable".

## 4. Verification (local, disposable restore copy of UAT; synthetic merchants `UXIMG*`, removed afterwards)

| Suite | Result |
|---|---|
| Backend `tsc`, eslint (touched files) | clean |
| Backend: main-media 13, media-lifecycle, public-catalog 9, anonymous-privacy, d6 28, d13a 37, invitation-guards, approve-unclaimed, auth-email-hook 12, email-delivery 39 | all pass |
| Frontend `tsc`, `eslint .`, `next build` | 0 errors (10 pre-existing `<img>` warnings), build OK |
| API acceptance (`e2e-uat/local-merchant-ux/api-acceptance.mjs`) | 25/25 |
| UI acceptance, desktop + mobile (`ui-acceptance.mjs`) | 27/27 |
| Read-only walk through migrated merchants (`real-readonly.mjs`) | 20/20 |

Mapped to the acceptance list: (1) layout max two lines, no horizontal scroll at 1440 and 390 px — 25 real rows each; (2) row → View, never Edit; (3) Edit/Save/Cancel incl. discard prompt and rejected save; (4) all migrated images visible and decoded; (5) Set Main persists across a full reload; (6) public card uses the selected image; (7) details hero uses the same image; (8) anonymous 401, merchant owner 403 (own and other tenant), cross-tenant media 404, malformed 400; (9) partner/QR/auth/financial code untouched, media rows' paths, order, legacy ids and statuses identical before/after; (10) no email file touched, email suites pass. Parity check over **all 147 published merchants**: admin Main image id == public card image id, 0 mismatches.

Screenshots: `docs/screenshots/merchant-ux/` — `real-list-{desktop,mobile}.png`, `list-*-long-name.png`, `view-{desktop,mobile}.png`, `edit-desktop.png`, `view-after-save-desktop.png`, `gallery-set-main-desktop.png`, `gallery-mobile.png`, `real-gallery-*`, `public-card-desktop.png`, `public-details-{desktop,mobile}.png`, `broken-images-desktop.png`. These are evidence captures, not pixel-diff baselines.

## 5. Not verified / limitations
- Not run against hosted UAT (not authorised). Local Storage has image transformation disabled, so the thumbnail transform path was exercised only through its fallback; hosted UAT already relies on transform for the public catalog.
- Public pages pick up a new Main within ~30 s (existing catalog snapshot TTL and `Cache-Control`).
- Merchant owners cannot change their own Main directly (Admin-only, as requested); their governed upload/approval flow is unchanged.
- Directory thumbnail signing is up to `page_size` (≤100) Storage calls per page.
- `backend/dist` was not rebuilt (the image builds from `src`).

## 6. Deployment recommendation
Ready to deploy to UAT **after owner approval**: backend + frontend only, no migration, no env or Gate B change. Suggested order: backend first (additive endpoint/fields), then frontend. Post-deploy, read-only: admin list + 3 merchants' galleries, public card/hero parity script; then one Set-main on a synthetic merchant. Rollback: redeploy the previous images; data written by Set-main is a reversible flag flip (re-select the previous image). Decide separately whether to apply the optional atomic function + unique index.
