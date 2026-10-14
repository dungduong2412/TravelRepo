# VNO V1 → V2 Phase D1 verified source extraction — 2026-10-13

## Decision

**PASS for Phase D1 snapshot acceptance and manual review.** The accepted
artifact is a private, tenant-scoped V1 source snapshot. This decision does not
authorize a Supabase import, V2 migration execution, deployment, DNS change, or
cutover.

## Safety and scope

- Authoritative tenant: `B7688A1C-23F9-637D-C2FB-3A16EB1BEFD2`.
- Live revalidation found exactly one tenant registry row, 15 tenant settings,
  and all three expected VNO brand values.
- V1 access was read-only. No service, container, configuration, schema, or row
  was changed.
- No V2 database or Storage operation was performed.
- The destination is outside Git, protected by FileVault, mode `0700` at every
  directory and mode `0600`/`0400` for files.
- No password, key, token, customer row, binary body, or private source ID was
  printed to logs or copied into this report.

## Bounded media gate

The deterministic 100-blob sample passed before the full extraction began.

| Provenance | Files | Bytes |
|---|---:|---:|
| Merchant references | 40 | 38,062,799 |
| Partner references | 20 | 20,559,709 |
| Unreferenced MDM blobs | 33 | 60,456,132 |
| CMS blobs | 7 | 470,179 |
| **Total** | **100** | **119,548,819** |

For every sample file, SQL Server's source-side SHA-256 and byte length matched
the locally written bytes. File signatures identified 89 JPEG, 10 PNG, and one
WebP image. Original IDs, source names, sizes, signatures, MIME results, and
checksums are retained only in the private sample manifest.

## Accepted snapshot

| Control | Result |
|---|---:|
| Exported table files | 109 |
| Exported relational rows | 11,726 |
| Media files | 618 |
| Media bytes | 416,329,553 |
| Files covered by `files.sha256` | 730 |
| Snapshot manifest SHA-256 | `da291214739f71cd2c5d02a356f5ea73cbb66cc36914de150d74a0b97b7abfa8` |
| File manifest SHA-256 | `ff30aa7f9fdc4224eb2f5085689c7f1b997331c571258bad79f36436fd382118` |
| Media report SHA-256 | `adbd62e919df586166fcffb152b65ad7d41abd09a6e920aa210d60e5ae3c1ce9` |

The final source control window ran from `2026-10-13T10:24:26.952316Z` through
`2026-10-13T10:24:28.114352Z`. The snapshot manifest, flattened file manifest,
media checksum report, and acceptance manifest all passed independent SHA-256
verification after creation.

The six-database export is not a distributed SQL Server snapshot transaction.
Cross-database consistency is therefore established by the post-extraction
live control window, exact source-to-snapshot comparisons, relationship checks,
and unchanged Phase C controls rather than by a single transaction boundary.

Two earlier full-run directories remain marked `incomplete` and are not
migration inputs. The first exposed a local temporary-file finalization anomaly;
the second stopped on a transient SQL/TDS EOF. The accepted run used bounded
transport retry with short-lived, per-table SQL connections. Integrity, scope,
and checksum failures were never retryable.

## Row-count reconciliation

| Entity | Phase C baseline | Live source | Snapshot | Result |
|---|---:|---:|---:|---|
| Merchants | 148 | 148 | 148 | PASS |
| Collaborators | 270 | 270 | 270 | PASS |
| Transactions | 102 | 102 | 102 | PASS |
| Merchant-category links | 272 | 272 | 272 | PASS |
| Merchant update requests | 38 | 38 | 38 | PASS |
| Merchant image references | 432 | 432 | 432 | PASS |
| Numbering configurations | 34 | 34 | 34 | PASS |
| Numbering details | 6 | 6 | 6 | PASS |
| Referenced numbering definitions | 3 | 3 | 3 | PASS |
| Tenant feature values | 21 | 21 | 21 | PASS |

There were no differences attributable to production activity during the
accepted control window.

## Financial reconciliation

| Measure | Phase C baseline | Live source | Snapshot | Result |
|---|---:|---:|---:|---|
| Document total | 377,705,162.0000 | 377,705,162.0000 | 377,705,162.0000 | PASS |
| Discount total | 24,077,880.8000 | 24,077,880.8000 | 24,077,880.8000 | PASS |
| Commission total | 27,466,958.1000 | 27,466,958.1000 | 27,466,958.1000 | PASS |

The calculations use the exported transaction rows at exact decimal precision;
no floating-point conversion was used.

## Media reconciliation

| Provenance | Files | Bytes | Missing references |
|---|---:|---:|---:|
| Referenced MDM media | 508 | 335,544,607 | 0 |
| Unreferenced MDM media | 103 | 80,314,767 | n/a |
| All MDM media | 611 | 415,859,374 | 0 |
| CMS media | 7 | 470,179 | 0 |
| **Total** | **618** | **416,329,553** | **0** |

The complete-set signature scan identified 570 JPEG, 45 PNG, and three WebP
files. Every blob's actual byte length and SHA-256 matched its private metadata.
All 76 partner image references and all merchant image references resolve. The
103 unreferenced blobs are deliberately preserved.

## Orphan and relationship reconciliation

- The known transaction with no matching restaurant remains present exactly
  once. Its original restaurant relationship ID is retained; it was not
  invented, discarded, or reassigned.
- Transactions missing collaborators: 0.
- Merchant-category links missing merchants: 0.
- Merchant-category links missing categories: 0.
- Merchant update requests missing merchants: 0.
- Merchant image references missing blobs: 0.
- Partner image references missing blobs: 0.
- Numbering details missing configurations: 0.

## Private deliverables

- Accepted snapshot: `/Users/dungduongdinhquoc/Documents/VNO/phase-d1-20261013/snapshot-3`
- Bounded sample: `/Users/dungduongdinhquoc/Documents/VNO/phase-d1-20261013/sample-100`
- Snapshot table/blob manifest: `snapshot-3/manifest.json`
- Flattened file manifest: `snapshot-3/files.sha256`
- Media checksum and MIME report: `snapshot-3/media-checksums.csv`
- Sealed reconciliation: `snapshot-3/acceptance-manifest.json`
- Acceptance digest: `snapshot-3/acceptance-manifest.sha256`

The manifests containing source identifiers remain in the access-restricted
destination and are intentionally not copied into the repository.

## Remaining blockers before any V2 import

Phase D1 does not close the Phase C V2 blockers:

1. Resolve or explicitly exclude the 21 OpenIddict application/scope contract
   fields; regenerate secrets rather than copying legacy secret material.
2. Close the nine pending identity/media/OpenIddict relationship and index
   capabilities.
3. Review and approve the unapplied additive structural-parity and RLS/grant
   remediation proposals.
4. Implement and authorize transactions, commissions, merchant update requests,
   merchant-category relationships, Storage/media provenance, numbering, and
   mutation auditing in the V2 application.
5. Correct merchant/collaborator endpoint authorization and the outstanding RLS,
   grant, profile-policy, and function-security findings.
6. Implement controlled Supabase Auth account creation and mandatory password
   reset. Never import V1 password hashes or tokens.
7. Approve the legacy `datetime2` timezone interpretation.

## Acceptance boundary

Phase D1 is complete. The snapshot is accepted for review only and remains
**NO-GO for V2 import, deployment, or cutover** until the remaining blockers are
closed and a human explicitly authorizes the next phase.
