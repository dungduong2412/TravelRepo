# VNO V1 Phase C evidence — 2026-10-12

Status: **read-only discovery and aggregate reconciliation complete; accepted
source snapshot blocked by current SSH outage**.

## Safety state

- V1 was queried only through SSH and read-only SQL/select or container metadata
  commands. No V1 files, rows, containers, images, services or configuration
  were changed.
- The private key stayed at its original local path and was not printed, copied,
  uploaded or added to the repository.
- No customer row content, password, token, bank detail or binary content was
  printed to task logs.
- V2 received no customer-data load. No commit, push, deploy or cutover occurred.
- Port 3000 was not used or changed.

## Tenant ownership evidence

The verified tenant ID is `B7688A1C-23F9-637D-C2FB-3A16EB1BEFD2` (`PARTNER` in
`SaasTenants`). It is the only registered tenant with the VNO workload:

| Evidence | Value |
|---|---:|
| Identity users | 433 |
| Restaurants | 148 |
| Referral partners | 270 |
| Transactions | 102 |
| Categories | 18 |
| Merchant update requests | 38 |
| Merchant image links | 432 |

For that exact tenant provider key, ABP settings contain the branding values
`Vietnam Number One`, `VN Number One`, and `VNO`. This combination of registry,
branding and cross-database workload is the tenant-selection control; no other
tenant records were included.

## Complete direct-tenant counts

The six-database inventory contains 135 tables. Ninety-six have a literal
`TenantId`; 25 of those contain VNO rows.

| Database | Direct-tenant tables | Populated | VNO rows |
|---|---:|---:|---:|
| Emos_Administration | 8 | 4 | 7,475 |
| Emos_Cms | 33 | 4 | 24 |
| Emos_Identity | 15 | 6 | 1,825 |
| Emos_MdmService | 39 | 11 | 1,740 |
| Emos_Saas | 1 | 0 | 0 |
| Emos_Aeretha | 0 | 0 | 0 |
| **Total** | **96** | **25** | **11,064** |

Populated direct tables include administration audit/actions, language texts and
permission grants; CMS blob containers/blobs/users; identity roles, security
logs, sessions, user-role links, users and user types; and the MDM tenant blob
container/blobs, numbering configuration, merchants, partners, categories,
links, transactions, update requests and web-push templates.

Explicitly scoped tables without a literal `TenantId` add 632 rows:

| Table | Scope | Rows |
|---|---|---:|
| SaasTenants | exact tenant registry ID | 1 |
| AbpSettings | ABP tenant provider key | 15 |
| OpenIddictAuthorizations | tenant-user subject | 34 |
| OpenIddictTokens | tenant-user subject; archive only | 4 |
| MerchantImages | tenant restaurant | 432 |
| RestaurantUserMap | tenant restaurant | 146 |
| GdprRequests / GdprInfo / AbpLinkUsers | verified relations | 0 |
| DomainVerificationAttempts / CmsBlogFeatures | verified parents | 0 |

The controlled scope therefore contains 11,696 rows across 107 selected table
extracts before shared/global configuration decisions. All 146 merchant-user
links resolve to VNO identity users; there are no missing-user, cross-tenant, or
global orphan links. All 432 merchant-image rows resolve to restaurants.

The machine-readable field accountability matrix at `V1_V2_FIELD_MATRIX.csv`
covers all 1,416 columns in all 135 inventoried tables exactly once: 114 are
direct mappings, 47 are lossless transformations, 998 are controlled-archive
fields, and 257 remain explicitly unresolved. No field is classified as
excluded. The unresolved set is confined to shared/non-literal tenant scope and
global migration-metadata candidates; those rows are not authorized for export.

## Financial reconciliation

All values are SQL `numeric(18,4)` aggregates over the 102 VNO transactions.

| Measure | Source total |
|---|---:|
| Document total | 377,705,162.0000 |
| Document discount amount | 24,077,880.8000 |
| Commission amount | 27,466,958.1000 |
| Earliest document date | 2025-04-12 11:50:23.7807922 |
| Latest document date | 2026-04-21 10:06:34.5069108 |

One transaction points to a restaurant ID that does not exist anywhere in the
source restaurant table. Its document total is 1,000,000.0000 and commission is
100,000.0000. Its middleman relationship is valid. This row must be preserved
with a nullable merchant relation or archive reference; it must not be dropped.

## Status evidence

Observed transaction statuses are `0: 2`, `1: 37`, `2: 2`, `3: 61`.
Read-only .NET metadata inspection of the deployed V1 MDM assemblies proves that
`RestaurantComTrack.Status` uses `RestaurantStatus` with:

| Numeric | Application enum |
|---:|---|
| 0 | OPEN |
| 1 | CONFIRMED |
| 2 | CANCELED |
| 3 | PAID |

This is application-code evidence, not an inference from dates or numeric order.
Nevertheless, `PAID` does not independently prove settlement by an external
bank/payment rail. The original numeric value and enum label must both be
preserved; V2 payment settlement should remain unverified until business or
payment evidence confirms it.

Other observed values are update request `0: 12`, `1: 26`; restaurant `0: 148`;
and partner `0: 270`. Their original numeric values remain preserved pending
equally strong type/workflow evidence.

## Image and blob provenance

`MerchantImages.ImageId` and `RestaurantMiddleman.Image` resolve against
`AbpBlobs.Name` as canonical GUID text, not `MediaAssets.Id` or `AbpBlobs.Id`.

| Source/provenance | Rows | Bytes | Resolution |
|---|---:|---:|---|
| Merchant image links | 432 | 290,301,435 | all tenant-owned, none missing |
| Partner avatar links | 76 | 45,243,172 | all tenant-owned, none missing |
| Referenced MDM blobs (union) | 508 | 335,544,607 | exact name match |
| Unreferenced tenant MDM blobs | 103 | 80,314,767 | archive; provenance unresolved |
| All tenant MDM blobs | 611 | 415,859,374 | content non-null |
| CMS `brand-assets` blobs | 7 | 470,179 | tenant-owned; no descriptor match |
| **All tenant blobs** | **618** | **416,329,553** | preserve all |

There are no declared SQL Server foreign keys between merchant image identifiers
and blob names, so the explicit name-based provenance mapping and content hashes
are required migration controls.

## Controlled extraction state

`migration/v1/extract_v1_tenant.py` performs tenant-scoped extraction through an
SSH tunnel, keeps the SQL password in memory, writes only outside Git with 0700
directories/0600 files, preserves exact SQL representations, and verifies table
hashes, row counts, blob sizes and blob SHA-256 before completion.

Two local staging attempts are not accepted:

- `v1-extract-20261012T170000` is marked `invalid` after post-run verification
  found an empty MDM blob-metadata file.
- `v1-extract-20261012T171000` and `v1-extract-20261012T172000` remain
  `incomplete`; the hardened self-check rejected them for the same condition.

The writer was changed to avoid a long-lived metadata pathname during the blob
stream. The subsequent bounded retest ended with a transport EOF, and SSH port
2233 then timed out. No snapshot is accepted until connectivity returns and a
fresh run passes both built-in and independent verification.

## Remaining blockers

1. Restore V1 SSH reachability and complete one verified private snapshot.
2. Classify or retain the 103 unreferenced MDM blobs and seven descriptor-less
   CMS brand assets.
3. Preserve the single orphaned transaction without inventing a merchant.
4. Resolve the 257 explicitly blocked fields in shared/non-`TenantId` and global
   migration-metadata tables. The matrix is complete, but tenant ownership and
   archive-versus-exclusion decisions for this set are not. Nothing is silently
   excluded.
5. Define the Supabase Auth migration/reset process; legacy password hashes and
   OpenIddict tokens must not be replayed into Supabase Auth.
6. Obtain business/payment evidence before equating application `PAID` with
   externally settled commission.
7. Apply the reviewed V2 RLS/grant remediation only after Admin acceptance.
