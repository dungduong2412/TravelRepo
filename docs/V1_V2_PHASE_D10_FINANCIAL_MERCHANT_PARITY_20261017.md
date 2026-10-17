# VNO Phase D10 — Financial & Merchant Functional Parity

Date: 2026-10-17

Status: **LOCAL RELEASE CANDIDATE VERIFIED; OWNER REVIEW REQUIRED**

Database migration applied: **No**

Git push/deployment: **No**

## 1. Evidence and scope

This implementation was reconciled against:

- `docs/V1_V2_FIELD_MATRIX.csv`
- the accepted D1 `snapshot-3` schemas for `Restaurant`, `RestaurantComTrack`, `MerchantUpdateRequests`, and `MerchantImages`
- the D2 import mappings in `migration/v2/import-sealed-snapshot.mjs`
- the D6–D9 application and authorization contracts
- the current Supabase migration set through `20261016140546`

The three screenshot files referenced in the request were not present in the accessible attachment or workspace paths. The implementation follows the described V1 fields and the existing V2 visual language; screenshot-specific spacing or column-order differences remain subject to owner review.

## 2. Financial field coverage

| V1 `RestaurantComTrack` | V2 destination | Previous application gap | D10 operational support |
|---|---|---|---|
| `Id` | `referral_transactions.legacy_transaction_id` | Detail provenance omitted | Returned by report API/detail drawer |
| `DocNbr` | `document_number` | Present but fallback could hide absence | Original value shown; missing value is explicit |
| `DocInx` | `document_index` | Not projected | Returned and shown contextually |
| `RestaurantId` | `legacy_restaurant_id` plus resolved `merchant_id` | Raw UUID displayed | Current Merchant name/code joined; legacy display name retained as fallback; null relationship preserved |
| `RestaurantDisplayName` | `legacy_restaurant_display_name` | Not projected | Returned and used as historical fallback |
| `MiddlemanId` | `legacy_middleman_id` plus resolved `collaborator_id` | Raw UUID displayed | Current Collaborator name/code joined; legacy display name retained as fallback |
| `MiddlemanDisplayName` | `legacy_middleman_display_name` | Not projected | Returned and used as historical fallback |
| `Status` | `legacy_status` | Literal `null` display; no filter | Kept separate from V2 state; numeric or explicit “not present in source”; filter supports numeric and null |
| V2 lifecycle | `lifecycle_status` | Basic display only | Separate filter, column and detail value |
| V2 payment | `payment_status` | Basic display only | Separate filter, totals breakdown and detail value |
| `DocDate` | `document_date` and approved `document_date_utc` | Basic display | Filter, sort, table and detail |
| `PostingDate` | `posting_date` / `posting_date_utc` | Omitted | Optional column and detail |
| `ConfirmDate` | `confirmed_at` / `confirmed_at_utc` | Omitted | Detail drawer |
| `CommissionDate` | `commission_date` / `commission_date_utc` | Omitted | Detail drawer |
| `DocTotal` | `document_total` | Row only | Exact row value plus complete-filter total |
| `DocDiscountPerc` | `document_discount_percent` | Missing from API/UI | Returned and displayed without derivation |
| `DocDiscountAmt` | `document_discount_amount` | Row only | Exact row value plus complete-filter total |
| `CommissionPer` | `commission_percent` | API-only | Returned and displayed without derivation |
| `CommissionAmt` | `commission_amount` | Row only | Exact row value plus complete-filter total |
| `Note` | `legacy_notes` | Omitted | Detail drawer |
| `CreatorName` | `legacy_creator_name` | Omitted | Searchable provenance field |
| `BranchId` | `legacy_branch_id` | Omitted | Returned by report contract for audit use |

Financial totals are accumulated as scaled four-decimal integers, not floating-point numbers. Summary queries iterate in bounded 1,000-row pages so totals cover the complete filtered dataset rather than only the visible page.

### Why the existing UAT transaction shows null source status

Phase D5 created the surviving UAT transaction as synthetic test data. Phase D7 explicitly recorded `Legacy status present: 0` before and after migration. Therefore its `legacy_status = null` is the preserved input state, not a failed V1 mapping. D10 displays it as “Không có trong nguồn” and never assigns a numeric meaning.

## 3. Merchant field coverage

| V1 `Restaurant` / association | V2 destination | D10 support | Classification |
|---|---|---|---|
| `Code` | `merchant_code` | Default list and detail; immutable through edit API | Active |
| `Name`, `Description`, contact/address fields | corresponding `merchant_*`, owner and address columns | List/detail plus governed edit | Active |
| `CommissionPerc` | `merchant_commission_type='percentage'`, `merchant_commission_value` | List/detail/edit; blank remains null | Active |
| `DiscountPerc` | `merchant_discount_type='percentage'`, `merchant_discount_value` | List/detail/edit; blank remains null | Active |
| `Priority` | `merchant_priority` | List/detail/filter/sort/edit | Active |
| `IsVerified` | `merchant_verified` | Visible and governed Admin edit | Active |
| `CreationTime` | `merchant_registered_date` | List/detail | Active/history |
| `VerifiedDate` | `merchant_verified_date` | List/detail; not rewritten automatically | History |
| `Status` | `legacy_status` | Displayed separately; no invented operational mapping | Audit/source |
| V2 operational state | `merchants_status` | Admin filter and governed edit | Active |
| `MinCommission` | `legacy_min_commission` | Detail only | Source/audit until business meaning is approved |
| `TaxCode` | `legacy_tax_code` | Detail only | Active reference; edit semantics not yet approved |
| `Rating`, `ShortName` | legacy columns | Detail only | Source/audit |
| `IsBanned`, `LastBannedDate` | legacy columns | Detail/read-only | Source/audit; no V2 blocking inference |
| `IsUpdateRequesting`, `LastUpdateRequestDate` | legacy columns | Detail/read-only | Source/audit |
| `MerchantUpdateRequests.*` | `merchant_update_requests` plus lossless `payload` | Admin history section | Active history/read-only |
| Category links | `merchant_category_links` → `categories` | Detail section | Active association |
| `MerchantImages` | `media_assets` | Detail metadata section; private signed retrieval remains under D9 controls | Active association |
| country/province/district/ward IDs and text | dedicated legacy columns plus current address fields | Current address is editable; original geography remains preserved | Mixed active/audit |
| `ExtraProperties`, `GeoPosition`, owner/source IDs | dedicated legacy columns and archive | Not surfaced by default | Audit/archive |

The import runner was corrected so numeric V1 `Restaurant.Status` is retained only in `legacy_status`. It no longer writes `String(Status)` into the V2 operational `merchants_status`; matched V2 records preserve their governed state, while newly imported records remain operationally unmapped until reviewed.

## 4. Schema decision

**No additive schema migration is required for correctness.** All requested fields already exist in the accepted V2 schema. No SQL migration was created or applied.

Existing D6 indexes cover Merchant- and Collaborator-scoped transaction date access. Additional global status/search indexes should be considered only after production-volume `EXPLAIN (ANALYZE, BUFFERS)` evidence; adding speculative indexes is not required for the current 102-row source set or the tested 1,008-row workload.

## 5. API contract changes

Existing D6 endpoints remain unchanged.

### `GET /transactions/report` — Admin only

### `GET /transactions/me/report` — scoped Merchant/Collaborator/Admin

Query parameters:

- `page`, `page_size` (maximum 100)
- `search`
- `merchant_id`, `collaborator_id`
- `legacy_status` (integer or literal `null`)
- `lifecycle_status`, `payment_status`
- `from`, `to`
- `orphan_only`
- allowlisted `sort` and `direction`

Response contains `items`, pagination metadata and exact complete-filter summary totals/status counts. Embedded Merchant and Collaborator projections expose names/codes while retaining IDs and legacy display names.

### `GET /merchants/admin-directory` — Admin only

Supports bounded pagination, search, V2 operational status, verification and allowlisted sorting. Password fields are never projected.

### `GET /merchants/:id/operational-detail` — Admin only

Returns the password-free Merchant record with update-request history, media metadata and category relationships.

Existing `PATCH /merchants/:id/admin` now accepts exact non-negative decimal strings with up to four decimal places, avoiding unnecessary client-side numeric coercion. The Merchant-owned update endpoint remains restricted to non-commercial profile fields.

## 6. Proposed UI layout

### Admin Financials

- Four summary cards: filtered transaction count, document total, discount total and commission total.
- Accessible filter panel for search, parties, source/V2 statuses, date interval and orphans.
- Compact default columns: document, date, Merchant, Collaborator, source status, totals/rates.
- Optional operational date/status columns.
- Keyboard-accessible rows and a detail drawer for complete provenance.
- Server-side sorting and pagination; summary totals always cover the complete filter.

### Merchant Management

- Search/filter/sort toolbar and paginated default table.
- Default columns emphasize identity, original code, commercial terms, priority, dates and operational/verification state.
- Detail drawer separates operational fields, update-request history, media, and source-only context.
- Governed Admin edit drawer; historical/source identifiers and requests remain read-only.
- Blank commission/discount values remain null and are labeled “Not set.”

## 7. Acceptance evidence

| Suite | Result |
|---|---:|
| D10 financial/Merchant functional suite | **14/14 PASS** |
| Scale case | **1,008 rows PASS** |
| Exact totals | `1605.3234` document / `60.1311` discount / `30.0162` commission — **PASS** |
| Existing authorization suite | **35/35 PASS** |
| Existing D6 functional suite | **22/22 PASS** |
| D6 contract suite | **20/20 PASS** |
| D9 media lifecycle suite | **7/7 PASS** |
| Backend typecheck/lint/build | **PASS** |
| Frontend typecheck/build | **PASS** |
| Runtime dependency audits | **0 vulnerabilities** |

The full backend dependency audit is clean. The full frontend audit retains five
high-severity findings only in the development lint dependency chain
(`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch`
→ `braces`); none are present in the production dependency audit. The lint run
completed with zero errors and 14 pre-existing warnings outside the D10 files.

D10 specifically verifies pagination, complete-filter totals beyond the 1,000-row Data API response cap, joined names/codes, null source status, exact discount/commission values, orphan preservation, Merchant/Collaborator ownership scopes, Admin-only directory/detail/edit denial, and operational-detail contracts.

## 8. Remaining semantic uncertainty

1. Numeric V1 transaction status meanings remain unapproved. Values are preserved as integers and are not mapped to settlement/payment semantics.
2. Numeric V1 Merchant status meanings remain unapproved. Values stay in `legacy_status` and do not activate/block V2 accounts automatically.
3. `MinCommission` is preserved but lacks an approved operational rule, so it remains read-only.
4. Tax-code and legacy geography edit semantics are not approved; current values remain visible/preserved but are not broadly editable.
5. The exact screenshot-specific presentation could not be checked because the referenced screenshot files were unavailable to the execution environment.

## 9. Exact next-step plan

1. Owner reviews the local UI, column defaults and detail drawers.
2. Owner confirms whether `MinCommission`, tax code, rating and legacy geography need active editing or remain source/audit fields.
3. Run the same test suites against an isolated deployment candidate.
4. Review the prepared D10 release commit; no migration is needed.
5. Separately approve push and Railway UAT staging/deployment.
6. Run deployed three-role acceptance and compare snapshot financial totals before any production import.

**STOP:** no migration, push, deployment, V1 access, production import or cutover was performed.
