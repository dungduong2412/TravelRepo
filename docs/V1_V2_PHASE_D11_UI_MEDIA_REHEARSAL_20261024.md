# VNO V2 — Phase D11 UI, Media and Full Migration Rehearsal

Date: 2026-10-24 (Asia/Ho_Chi_Minh)
Deployed UAT baseline reviewed: `0f957e18bdc15c9eda89117450d91bafc8d95904`
Supabase UAT reviewed read-only: `hsezyogfxgnkpweoqqny`
Source: sealed `~/Documents/VNO/phase-d1-20261013/snapshot-3/` only
Shared-environment changes: **none**

## Executive result

- UI implementation and real-data rendering: **PASS locally**.
- UAT Storage diagnosis: **PASS**; both expected private buckets exist but contain zero objects.
- Full tenant-scoped snapshot reconciliation: **PASS**.
- All 618 media files: **PASS**, byte-for-byte SHA-256 verified.
- Import restartability: **PASS** after correcting exact-identity matching ahead of fuzzy duplicate detection.
- Authorization and media approval: **PASS**.
- D11 UAT release candidate: **NO-GO at this time** because the required production build/security gate found one critical frontend runtime advisory and five high-severity backend runtime findings. No advisory was suppressed and no dependency upgrade was mixed into D11.

## A. UI implementation

### Admin Merchant Details

The existing D10/D10B contracts remain in place. The detail interface is now divided into:

1. Business Information
2. Owner Information
3. Location
4. Pictures & Gallery
5. Commercial Settings
6. Verification & Administration
7. Legacy Data & Audit History

Frequently used information remains visible in compact responsive grids. Historical and technical fields are read-only and secondary. The image section resolves private media through the existing five-minute signed-URL API; it labels imported assets as `legacy_effective` without inventing historical approval.

### Admin Collaborator Management

Oversized cards were replaced with a searchable, status-filtered, paginated table (25 rows per page). It provides name/code, contact, source/V2 status, merchant-association count, registration date, avatar and a detail action. Deactivation and media decisions remain inside the detail flow. The detail view includes effective media, pending proposals, associations and approval history.

Numeric imported statuses are displayed as `Legacy status <value>` and have a dedicated `Legacy / unmapped` filter. They are not mapped to an invented active/inactive meaning.

### Visual evidence

Local-only screenshots confirmed that an imported merchant renders real details and four original images, and that an imported collaborator renders its original approved-effective avatar through a signed URL. The screenshots contain rehearsal customer data and are deliberately excluded from the release candidate.

The two owner-reference screenshots were not present in the available attachment set, so exact pixel comparison remains a manual acceptance item. The requested information architecture and scalable collaborator layout were implemented directly from the written acceptance criteria.

## B. Read-only UAT Storage investigation

| Check | Evidence | Result |
|---|---:|---|
| `merchant-media` | Private; JPEG/PNG/WebP/GIF allowlist; zero objects | PASS / empty |
| `partner-media` | Private; JPEG/PNG/WebP/GIF allowlist; zero objects | PASS / empty |
| `media_assets` | 0 rows | PASS / empty |
| `media_approval_requests` | 0 rows | PASS / empty |
| Merchant records | 15 | Read-only baseline |
| Collaborator records | 15 | Read-only baseline |
| Signed URL | Backend issues a 300-second URL for authorized media | PASS in isolated rehearsal |
| Upload state | Owner upload creates a private `pending` proposal | PASS in isolated rehearsal |

Diagnosis: missing UAT pictures are not caused by absent buckets or a failed renderer. UAT has no media metadata and no Storage objects, so the API has nothing to sign and the UI has nothing to display. In the isolated rehearsal, the same Storage → metadata → signed URL → UI path renders both merchant gallery images and a collaborator avatar.

Hardening proposal for a later, separately reviewed shared-environment change: align the bucket allowlist with the application (`image/jpeg`, `image/png`, `image/webp`) and set the bucket limit to 5 MiB. The API already enforces these values; UAT buckets currently also allow GIF and have no bucket-level size limit. No bucket setting was changed in D11.

## C. Sealed snapshot and isolated environment

The acceptance manifest verified successfully. The sealed manifest SHA-256 is:

`da291214739f71cd2c5d02a356f5ea73cbb66cc36914de150d74a0b97b7abfa8`

Every path in `files.sha256`, including all 618 blobs, passed before import.

The rehearsal used local Supabase endpoints only (`127.0.0.1`), not Railway UAT. The local volume already contained three D2 test personas, so total environment counts are 149 merchants, 271 collaborators and 420 Auth users. Tenant-scoped verification correctly isolates 148/270 and the 417 imported Auth mappings. This does not affect the sealed tenant reconciliation.

The preparation script was updated to include D10B migration `20261018021253_vno_phase_d10b_media_approval.sql`.

## D. Exact V1 snapshot reconciliation

| Invariant | Expected | Actual | Result |
|---|---:|---:|---|
| Merchants | 148 | 148 | PASS |
| Collaborators | 270 | 270 | PASS |
| Transactions | 102 | 102 | PASS |
| Merchant-category links | 272 | 272 | PASS |
| Scoped relational rows | 11,726 | 11,726 | PASS |
| Document total | 377,705,162.0000 | 377,705,162.0000 | PASS |
| Discount total | 24,077,880.8000 | 24,077,880.8000 | PASS |
| Commission total | 27,466,958.1000 | 27,466,958.1000 | PASS |
| Historical orphan transactions | 1 | 1 | PASS |
| Media files | 618 | 618 | PASS |
| Media bytes | 416,329,553 | 416,329,553 | PASS |
| SHA-256 verified | 618 | 618 | PASS |

Original transaction status distribution is preserved as raw values: `0=2`, `1=37`, `2=2`, `3=61`. No settlement or payment meaning was inferred. The orphan remains unassigned.

Media split:

- Merchant: 542 files / 371,086,381 bytes
- Collaborator: 76 files / 45,243,172 bytes
- All 618 imported files: `legacy_effective` + transfer `verified`
- Hash failures: 0

Auth mapping produced 417 rows using the password-reset onboarding strategy. `authentication_proven=false` is deliberately retained: identity mapping is not evidence that migrated identities can log in before hosted recovery is tested.

## E. Restartability and media acceptance

The first repeat run exposed a fuzzy-match ambiguity for a source record that already had an exact preserved legacy identity. The importer now selects an exact source-ID/tenant match before fuzzy duplicate analysis. Fuzzy collisions remain blockers; they are not auto-merged.

After the fix, the complete importer was rerun against the same local target:

- Same import batch identity
- No duplicate tenant rows or Storage objects
- Exact counts/totals unchanged
- 618/618 media hashes unchanged

End-to-end media results: owner uploads stay pending/private; cross-owner previews are denied; unauthorized direct Storage reads are denied; Admin approval publishes exactly the proposed image; rejection preserves the effective image; duplicate and concurrent decisions are rejected safely; removals and cancellations are audited; upload/metadata failures either clean up Storage or leave explicitly failed metadata for reconciliation.

## F. Test and build evidence

| Gate | Result |
|---|---|
| Frontend typecheck | PASS |
| Frontend lint | PASS with 18 warnings, 0 errors |
| Backend typecheck/lint/build | PASS |
| Authorization | PASS, 35/35 |
| D6 functional | PASS, 22/22 |
| D6 backend contracts | PASS, 28/28 |
| D10 functional | PASS, 14/14 |
| D10B category limits | PASS, 11/11 |
| D10B media approval | PASS, 22/22 |
| Media lifecycle | PASS, 8/8 |
| Final sealed-snapshot verifier | PASS |
| Frontend production build | **BLOCKED** after compile/static generation by Next security gate |
| Frontend runtime audit | **FAIL: 1 critical** (`next@16.4.0`) |
| Backend runtime audit | **FAIL: 5 high** (`body-parser@2.3.0`, `multer@2.4.0` through Nest/Express, `zod@3.25.76`) |

The critical Next advisories affect 16.4.0; the upstream patched release is 16.4.1. The repository uses App Router, and the runtime image pipeline is deployed, so this cannot be accepted as a dev-only finding. Backend findings are also runtime dependencies on network request/upload/validation paths. They require a separately reviewed minimal dependency patch and full regression run.

## G. Changed-file inventory

- `frontend/app/admin/merchants/page.tsx`
- `frontend/app/admin/collaborators/page.tsx`
- `migration/v2/prepare-rehearsal.sh`
- `migration/v2/import-sealed-snapshot.mjs`
- `migration/v2/test-d10-functional.mjs`
- `migration/v2/verify-d11-rehearsal.mjs` (new)
- Local-only merchant and collaborator screenshots were used for visual verification but are excluded from the release candidate because they contain rehearsal customer data.
- this report (new)

No schema migration, credential, generated build output, production data or shared-environment configuration is part of the D11 change set. Unrelated pre-existing untracked reports/evidence were left untouched.

## H. Defects and decisions

| Item | Status | Required action |
|---|---|---|
| UAT has no media objects | Explained, not an application defect | Use authorized synthetic media or a later approved import for shared UAT visual acceptance |
| Bucket policy is broader than API | Hardening gap | Later reviewed bucket config: remove GIF and set 5 MiB limit |
| Imported Auth not proven | Expected blocker | Test hosted recovery/SMTP for authorized accounts before customer onboarding |
| Owner screenshot pixel comparison | Manual acceptance | Reattach references or compare the included local captures |
| Runtime dependency advisories | Release blocker | Patch Next to a safe release and resolve backend runtime dependency findings; rerun all gates |

## Recommendation

**NO-GO for pushing/staging D11 today.** Functional parity, real-data migration, media integrity and authorization pass. The release remains blocked solely by newly disclosed runtime security findings and the resulting frontend production-build gate. After a reviewed security-only dependency patch produces clean runtime audits and a successful production build, D11 is otherwise ready for owner review and controlled UAT staging. Production import remains out of scope and is not authorized.
