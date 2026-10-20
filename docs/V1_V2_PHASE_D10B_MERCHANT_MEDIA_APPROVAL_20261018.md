# VNO Phase D10B — Merchant Details and Media Approval

> **Category-rule addendum (2026-10-19):** new selections and changes allow up to three distinct categories while historical V1 associations are preserved. The migration checksum below is superseded; use `V1_V2_PHASE_D10B_CATEGORY_RULE_FINALIZATION_20261019.md` for the revised checksum and evidence.

Date: 2026-10-18

Status: **LOCAL CANDIDATE COMPLETE; MIGRATION AND VISUAL REVIEW REQUIRED**

Supabase UAT migration applied: **No**

Git commit/push/deployment: **No**

## Evidence boundary

The accepted V1 field matrix, D1 snapshot mappings, D10 implementation and current V2 migrations were reviewed. The referenced V1 Update Merchant screenshot files were not exposed in the accessible attachment or workspace paths, so field semantics were reconciled from the accepted matrix and the owner's written requirements. Exact screenshot layout remains a manual acceptance item.

## Merchant Details coverage matrix

| Capability | V1 source | V2 persistence | API/UI | Edit authority | Result / gap |
|---|---|---|---|---|---|
| Owner full name | `Restaurant.OwnerName` | `merchant_details.owner_name` | Merchant/Admin edit | Owner Merchant, Admin | Complete |
| Owner phone | `Restaurant.Phone` plus owner context | `owner_phone`; store phone remains `merchant_phone` | Separate controls | Owner Merchant, Admin | Complete without conflating phones |
| Owner email | `Restaurant.Email`/identity evidence | `owner_email`, Auth and `user_profiles.email` | Displayed read-only | Separate identity-governance workflow | Persistence complete; direct edit intentionally blocked to prevent Auth divergence |
| Owner tax code | `Restaurant.TaxCode` | new `owner_tax_code`; source remains `legacy_tax_code` | Merchant/Admin edit plus source-only display | Owner Merchant, Admin | Complete; no automatic copy from legacy |
| Store/service name | `Restaurant.Name` | `merchant_name` | Merchant/Admin edit | Owner Merchant, Admin | Complete |
| Store/contact phones | `Phone`, `ContactPhone` | `merchant_phone`, `merchant_contact_phone` | Separate controls | Owner Merchant, Admin | Complete |
| Rich description | `Restaurant.Description` | `merchant_description`, new `merchant_description_format` | Plain text or Markdown authoring | Owner Merchant, Admin | Complete for safe Markdown; WYSIWYG preview remains optional |
| Categories | update-request `Categories`, association table | `merchant_category_links` | Multi-select; transactional RPC | Owner Merchant, Admin | Complete |
| Current country | no safe modern-ID equivalence | new `new_address_country` | Free-text current field | Owner Merchant, Admin | Complete without legacy coercion |
| Current province | no safe modern-ID equivalence | new `new_address_province` | Free-text current field | Owner Merchant, Admin | Complete without legacy coercion |
| Current district | no existing active V2 field | new `new_address_district` | Free-text current field | Owner Merchant, Admin | Complete |
| Current ward | `Ward` | `new_address_ward` | Merchant/Admin edit | Owner Merchant, Admin | Complete |
| Street address | `Address` | `new_address_line` | Merchant/Admin edit | Owner Merchant, Admin | Complete |
| Historical geography | `Country/Province/District/Ward` and IDs | `legacy_*` text/UUID columns | Source-only Admin detail | Read-only | Losslessly preserved; never mapped into current geography automatically |
| Main image | `MerchantImages.IsHero` | `media_assets.is_hero` plus publication state | Proposal UI/Admin approval | Owner proposes; Admin decides | Complete |
| Gallery images | `MerchantImages` | multiple `media_assets` | Gallery proposal/history UI | Owner proposes; Admin decides | Complete |
| Ordering | `MerchantImages.Order` | `display_order` | Reorder request | Owner proposes; Admin decides | Complete |
| Existing-image preservation | existing/imported objects | `legacy_effective` / `preexisting_effective` | Effective gallery | Read-only until governed request | Complete; no false historical approval |
| Discount/commission | `DiscountPerc`, `CommissionPerc` | exact numeric commercial fields | Admin form | Admin only | Complete; null remains null |
| Priority | `Priority` | `merchant_priority` | Admin form | Admin only | Complete; null remains null |
| Verification | `IsVerified` | `merchant_verified` | Admin form | Admin only | Complete |
| Registration/verification dates | `CreationTime`, `VerifiedDate` | registered/verified date fields | Admin detail | Historical/read-only | Complete; timezone evidence remains authoritative |
| Update-request history | `MerchantUpdateRequests` | existing payload plus new explicit request metadata | Admin history | Admin review | Existing V1 history preserved as `legacy_preserved` |

## Media state machine

Storage transfer state remains independent from publication state.

`upload → transfer verified → pending proposal → approved | rejected | cancelled`

- `approved` becomes effective atomically inside the approval transaction.
- Replacement supersedes the locked target only on approval.
- Rejection leaves the target unchanged.
- Removal and reorder are proposals against a target version.
- `legacy_effective` means imported V1 media is effective but has no verified V2 approval claim.
- `preexisting_effective` means non-legacy media predating D10B remains effective without a fabricated approval.
- Superseded, removed, rejected, cancelled and failed objects are excluded from the public effective-media endpoint.

Concurrency protection combines a row lock, per-owner transaction advisory lock, expected target version and partial unique pending-target index. Terminal requests cannot be decided twice.

## Proposed database changes

Migration: `supabase/migrations/20261018021253_vno_phase_d10b_media_approval.sql`

- Adds active owner tax-code, description-format and current country/province/district fields.
- Extends Merchant update-request provenance without rewriting V1 status values.
- Extends `media_assets` with uploader, publication state/version, effective interval and approval provenance.
- Adds restrictive `media_approval_requests` with owner/action/state/decision constraints and queue/history indexes.
- Adds service-role-only transactional RPCs for category replacement, approval, rejection and cancellation.
- Preserves private buckets and existing RLS/grant posture; no anonymous/authenticated table grants are introduced.
- Classifies existing media as legacy/pre-governance effective, never as Admin-approved.

The migration applied successfully to the disposable local Supabase schema and local security/performance advisors reported no issues. It has not been applied to linked UAT.

## API changes

- `POST /media/upload` creates a private pending `add` or `replace` proposal; Admin may explicitly request audited direct publication.
- `POST /media/requests/change` creates removal or reorder requests.
- `DELETE /media/requests/:id` safely cancels a pending request.
- `GET /media/me` returns owned effective/history/proposal state and decisions.
- `GET /media/approved/:ownerType/:ownerId` exposes only effective verified media through short-lived signed URLs.
- `GET /media/approvals` provides the Admin queue/history.
- `POST /media/approvals/:id/approve|reject` performs governed decisions.
- Merchant updates accept current geography, owner tax code, Markdown/plain-text description and category IDs.

## UI changes

- Merchant and Collaborator profiles show approved/history/proposal media states, rejection reasons, replacement, removal, ordering and safe cancellation.
- Admin navigation includes a central Media Approvals queue with owner filters, previous/proposed previews, hashes and decision actions.
- Merchant Admin detail separates active owner tax code from historical V1 tax code, current geography from legacy geography, and publication state from transfer state.

## Local candidate file inventory

- Database: `supabase/migrations/20261018021253_vno_phase_d10b_media_approval.sql` (SHA-256 `4a16e3a8cd3d9a936fe449db112c9d5db2c26dc184c60866d6257a6c2ba79139`).
- Backend source: `backend/src/modules/media/media.controller.ts`, `media.dto.ts`, `media.service.ts`, `backend/src/modules/merchants/merchants.dto.ts`, `merchants.service.ts`.
- Frontend: `frontend/components/MediaManager.tsx`, `frontend/app/admin/media-approvals/page.tsx`, `frontend/app/admin/layout.tsx`, `frontend/app/admin/merchants/page.tsx`, `frontend/app/merchant/dashboard/profile/page.tsx`.
- Import and verification: `migration/v2/import-sealed-snapshot.mjs`, `migration/v2/test-d6-functional.mjs`, `migration/v2/test-d10b-media-approval.mjs`, `backend/scripts/test-d6-contracts.ts`, `backend/scripts/test-media-lifecycle.ts`.
- Generated tracked backend build output: the matching media and merchant files under `backend/dist/modules/`.
- Report: this document. Pre-existing untracked D7–D9 reports and `migration/v2/evidence/` are unrelated and excluded from the candidate.

## Local validation

- D10B integration: 22 controls covering Merchant detail persistence, immutable legacy geography, owner uploads, pending publication exclusion, Admin queue, approve/reject, old-image preservation, owner separation, direct Storage denial, duplicate/concurrent decisions, remove, cancel, explicit Admin publication, signature rejection and financial non-mutation.
- Existing authorization: 35 controls.
- D6 functional: 22 controls.
- D10 functional: 14 controls including 1,008-row exact financial totals.
- D6 contracts: 22 assertions.
- Media lifecycle/cleanup: 8 controls.
- Local migration and Supabase advisors: PASS.
- Backend typecheck, lint and production build: PASS.
- Frontend typecheck and production build: PASS; lint completed with 15 warnings and no errors (13 pre-existing warnings and two D10B image-preview warnings).
- Runtime dependency audits (`npm audit --omit=dev`): backend 0, frontend 0.
- Full dependency audits: backend 0; frontend retains five high-severity development-only findings in the ESLint `braces → micromatch → fast-glob → @next/eslint-plugin-next → eslint-config-next` chain. The available forced fix is a breaking ESLint configuration downgrade and was not applied.

## Unresolved decisions

1. Owner-email changes need an explicit Auth email-change and re-verification policy; direct field editing remains blocked.
2. No approved modern Vietnam geography master exists. Current location is therefore explicit free text while historical names/IDs remain read-only.
3. V1 image approval meanings are not proven. Imported assets use `legacy_effective`, not `approved`.
4. Decide the retention period for rejected/cancelled private objects. Metadata and hash provenance are retained; cancellation attempts immediate Storage cleanup.
5. Confirm whether Markdown authoring is sufficient or a WYSIWYG editor/preview is required.
6. Screenshot-specific order, wording, density and image-control placement require owner review because the image files were unavailable to this execution environment.

## Release recommendation

**NO-GO for combined D10 + D10B UAT deployment today.** The local implementation is ready for code review, but the additive migration must be explicitly reviewed/approved and applied to isolated UAT before this code can run there. Owner screenshot/UX acceptance also remains open.

No V1 access, linked Supabase change, push, deployment, production import or customer-record mutation was performed.
