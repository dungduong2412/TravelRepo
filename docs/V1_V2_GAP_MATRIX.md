# VNO V1 → V2 gap matrix

Status: **parity not yet declared**. Live read-only evidence identifies the VNO
tenant and reconciles the core business, financial, identity and binary-media
aggregates. SSH recovered on 2026-10-13, but an accepted source snapshot and
application-capability parity are still outstanding. See
`V1_V2_PHASE_C_CLOSURE_20261013.md`.

## Classification rule covering the complete inventory

The supplied inventory contains 135 tables across all six databases. Every
column in a VNO-scoped source row is classified as `legacy_archive` into
`public.legacy_source_records.source_payload` unless a more specific mapping
below overrides it. This is the lossless fallback: direct/transformed fields are
also archived, so conversion cannot discard the original representation.

The generated [column matrix](V1_V2_FIELD_MATRIX.csv) accounts for all 1,416
inventory columns exactly once. Its [validation summary](V1_V2_FIELD_MATRIX_SUMMARY.json)
records 114 direct fields, 45 lossless transformations, 1,048 archive-only
fields, 188 explicit exclusions and 21 unresolved OpenIddict contract fields.
The generator is
`migration/v1/generate_field_matrix.py`; rerunning it fails on duplicate or
malformed inventory columns instead of silently producing an incomplete file.
The companion [schema-object matrix](V1_V2_SCHEMA_OBJECT_MATRIX.csv) accounts
for all 58 foreign-key records and 339 index-column records. Live V2
introspection verifies the core stable-ID and relationship equivalents recorded
there; all remaining objects stay blocked until index/constraint equivalence is
proven. No source relationship or performance constraint is silently treated as
parity.

Exclusions are limited to evidence-backed shared framework metadata, empty SaaS
billing infrastructure, migration history, cryptographic implementation
metadata and the separate Aeretha service. VNO provider/relationship-scoped
state remains archived. OpenIddict application/scope semantics remain blocked.

| V1 area | V2 destination | Classification | Verification |
|---|---|---|---|
| `Emos_MdmService.Restaurant` | `merchant_details` + archive | Direct/transformed losslessly | 148 rows; IDs unique |
| `RestaurantMiddleman` | `collaborators` + archive | Direct/transformed losslessly | 270 rows; IDs unique |
| `RestaurantComTrack` | `referral_transactions` + archive | Direct; numeric status preserved | 102 rows; one missing restaurant parent |
| `RestaurantCategory` | `categories` + archive | Transformed losslessly | 18 rows |
| `RestaurantCategoryMap` | `merchant_category_links` + archive | Direct relationship | 272 rows; composite keys unique |
| `RestaurantUserMap` | `merchant_user_links` + identity map + archive | Transformed losslessly | 146 rows; no missing/cross-tenant users |
| `MerchantUpdateRequests` | `merchant_update_requests.payload` + key/status columns | Archive plus direct keys | 38 rows |
| `MerchantImages`, MDM `MediaAssets`, MDM `AbpBlobs` | `media_assets`, Storage, archive | Transformed with hashes | 611 blobs; 508 referenced, 103 archive-only unresolved |
| CMS `CmsMediaDescriptors`, `FmFileDescriptors`, `AbpBlobs` | `media_assets`, Storage, archive | Relationship unresolved | Schema verified; data blocked |
| Identity `AbpUsers`, roles and user-role links | Supabase Auth, `user_profiles`, `legacy_identity_map`, archive | Transformed; password reset | Schema verified; data blocked |
| Other VNO tenant-scoped rows in all six databases | `legacy_source_records` | Controlled legacy archive | Inventory rule defined; data blocked |

## Field-level core mapping

The lists below account for every column in the core V1 business tables. Fields
not named as direct destinations are preserved in the source JSON archive.

### Restaurant → merchant_details

- Direct/stable identity: `Id → legacy_restaurant_id`, `TenantId → legacy_tenant_id`,
  `Code → merchant_code`, `Name → merchant_name`.
- Direct business data: `Email`, `Phone`, `ContactPhone`, `Description`,
  `CommissionPerc`, `DiscountPerc`, `Priority`, `CreationTime`, `VerifiedDate`,
  `IsVerified` map to their corresponding merchant columns.
- Legacy-preservation columns: `Status`, `IsBanned`, `MinCommission`, `TaxCode`,
  `GeoPosition`, `ExtraProperties`, `ShortName`, `Rating`, `OwnerId`,
  `IsUpdateRequesting`, `LastBannedDate`, `LastUpdateRequestDate`, `Province`,
  `District`, `Ward`, `Country`, `CountryId`, `ProvinceId`, `DistrictId`, `WardId`.
- `Address`, `OwnerName` map to the current address/owner fields and also remain
  archived. All nulls and the original source timestamp values are retained.

### RestaurantMiddleman → collaborators

- `Id`, `TenantId`, `Code`, `Name`, `Email`, `Phone`, `Rating`, `BankName`,
  `AccountName`, `AccountNumber`, `CreationTime`, `VerifiedDate`, `IsVerified`,
  `Status`, `IsBanned`, `LastBannedDate`, `Image`, and `ExtraProperties` all have
  direct or dedicated `legacy_*` destinations; the complete row is archived.

### RestaurantComTrack → referral_transactions

- IDs/relationships: `Id`, `TenantId`, `RestaurantId`, `MiddlemanId`, `BranchId`.
- Financials use exact `numeric(18,4)`: `DocTotal`, `DocDiscountAmt`,
  `DocDiscountPerc`, `CommissionPer`, `CommissionAmt`.
- Document/timing: `DocNbr`, `DocInx`, `DocDate`, `PostingDate`, `ConfirmDate`,
  `CommissionDate`, `CreationTime`, `LastModificationTime`.
- Original semantics: `Status` is always retained as `legacy_status`;
  `lifecycle_status` remains `unmapped` and `payment_status` remains `unverified`
  until evidence proves the meanings.
- Audit/display: `CreatorId`, `CreatorName`, `RestaurantDisplayName`,
  `MiddlemanDisplayName`, `LastModifierId`, `ConcurrencyStamp`, `Note`, and
  `ExtraProperties` have dedicated legacy columns or archive coverage.

### Categories, relationships and update requests

- `RestaurantCategory`: `Id`, `TenantId`, `Name`, `Icon`, `Order`, `IsActive`,
  `IsShow` map to `categories` where semantically safe; raw string flags remain
  archived.
- `RestaurantCategoryMap`: `ResId`, `ResCatId`, `TenantId` map to the junction.
- `RestaurantUserMap`: `ResId`, `UserId` map through stable identity tables.
- `MerchantUpdateRequests`: `Id`, `TenantId`, `MerchantId`, `Status`, and
  `CreationTime` have direct columns; `Address`, `Categories`, `CommissionPerc`,
  `ContactPhone`, `Country`, `CountryId`, `Description`, `DiscountPerc`,
  `District`, `DistrictId`, `Email`, `GeoPosition`, `Name`, `OwnerName`, `Phone`,
  `Province`, `ProvinceId`, `ShortName`, `TaxCode`, `Ward`, and `WardId` are
  preserved losslessly in `payload` and the source archive.

### Media and images

- `MerchantImages`: `Id`, `ImageId`, `ResId`, `IsHero`, `Order` map to explicit
  provenance/relationship columns in `media_assets`. Live aggregate evidence
  proves that all 432 VNO `ImageId` values match `AbpBlobs.Name` as canonical
  36-character GUID text; they do not match `MediaAssets.Id` or `AbpBlobs.Id`.
- MDM `MediaAssets`: `Id`, `TenantId`, `BlobContainerName`, `BlobName`,
  `FileName`, `ContentType`, `SizeInBytes`, `AssetType`, `Width`, `Height`,
  `DurationInSeconds`, `IsArchived`, `LastAccessedDate`, `Title`, `Caption`,
  `AltText`, and `Description` map directly; the whole row is archived.
- MDM/CMS `AbpBlobs`: `Id`, `TenantId`, `ContainerId`, `Name`, `Content`,
  `ConcurrencyStamp`, `ExtraProperties`. Content is streamed to a private bucket;
  source/destination sizes and SHA-256 must match before `verified` status.
- CMS descriptor fields (`Id`, `TenantId`, names, MIME types, sizes, entity or
  directory relationships, creation/modification/deletion and extra properties)
  remain archived and link through the new descriptor provenance columns.

## Current blockers

1. Finish and accept a new private source snapshot. SSH is reachable again, but
   earlier staging runs remain explicitly `invalid`/`incomplete`.
2. Classify the 103 tenant-owned but unreferenced MDM blobs (80,314,767 bytes).
   They remain mandatory archive content until provenance is established.
3. Decide the V2 relationship for the one transaction whose `RestaurantId` has
   no source restaurant anywhere. Its source row and exact financial values must
   be retained with a nullable relationship or controlled archive reference.
4. Preserve the seven tenant CMS `brand-assets` blobs even though no CMS media or
   file descriptor matches them.
5. Resolve the remaining 21 OpenIddict application/scope contract fields and
   nine relationship/index records; do not copy client secrets or key material.
6. Confirm with the business whether legacy application status `PAID` proves
   external commission settlement. Deployed binary metadata proves the numeric
   application enum, but not bank/payment-rail settlement.
7. Implement the missing V2 transaction, commission, media, merchant-update,
   numbering and audit capabilities documented in the Phase C closure report.

## RLS and grants review

- `categories` and `organization_profile` currently have RLS disabled and broad
  `anon`/`authenticated` table grants. These remain current error-level RLS
  advisor findings.
- The migration/financial/media bridge tables have RLS enabled with no policies,
  which intentionally denies Data API rows, but historical grants still make
  several table names visible through GraphQL introspection.
- `user_profiles` currently permits an unrestricted public insert policy and its
  update policy lacks an explicit `WITH CHECK` clause.
- The frontend uses Supabase directly only for Auth. Database reads/writes in the
  inspected application go through the backend service-role client, so the
  proposed grant reduction should preserve current application routes.
- The reviewed but unapplied remediation is
  `supabase/proposals/vno_v1_rls_grants_remediation.sql`. It retains anonymous
  read access only for categories and organization profile, restricts profile
  access to the authenticated owner, revokes migration/financial tables from
  client roles, and pins trigger-function search paths.
- Reference: [Supabase RLS advisor](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public)
  and [RLS performance guidance](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).
