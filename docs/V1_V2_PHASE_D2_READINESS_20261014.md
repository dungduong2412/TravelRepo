# VNO V1 → V2 Migration — Phase D2 Import Readiness

Date: 2026-10-14 (Asia/Ho_Chi_Minh)
Scope: sealed `snapshot-3`, V2/UAT project `hsezyogfxgnkpweoqqny`, and an isolated local Supabase rehearsal
Decision: **NO-GO for production V2 import**; the isolated import rehearsal passed, but the application changes remain uncommitted/undeployed and leaked-password protection is not enabled.

## Safety boundary

- V1 was not contacted or modified.
- Only `/Users/dungduongdinhquoc/Documents/VNO/phase-d1-20261013/snapshot-3/` was read.
- The sealed snapshot was not modified.
- No V1 records, Auth users, or media were imported into hosted V2/UAT.
- Port 3000 was not used. The isolated API/backend used ports 56321 and 3101.
- No commit, push, deployment, DNS change, or cutover occurred.

## 1. Sealed snapshot integrity

An independent verification recomputed the acceptance digest, snapshot manifest digest, and every entry in `files.sha256` before any row was read.

| Control | Verified result |
|---|---:|
| Acceptance status | PASS |
| Tenant | `b7688a1c-23f9-637d-c2fb-3a16eb1befd2` |
| Manifest SHA-256 | `da291214739f71cd2c5d02a356f5ea73cbb66cc36914de150d74a0b97b7abfa8` |
| Table exports | 109 |
| Relational/archive rows | 11,726 |
| Manifest-tracked files | 730 |
| Media | 618 files / 416,329,553 bytes |
| Media types | 570 JPEG / 45 PNG / 3 WebP |
| Permission check | private directories and files only |

## 2. OpenID and schema blocker closure

The 21 former blockers comprise 14 `OpenIddictApplications` contract fields and seven `OpenIddictScopes` contract fields. Repository and runtime inspection found no V2 OpenID Connect client, consent, redirect, or scope contract: V2 uses Supabase Auth password sessions and application role checks. The sealed tenant snapshot contains 34 authorizations and four tokens, but does not contain the five global applications or nine global scopes because their ownership is not tenant-verifiable.

Closure:

- The 14 application fields (`ApplicationType`, `ClientId`, `ClientType`, `ClientUri`, `ConsentType`, `DisplayName`, `DisplayNames`, `LogoUri`, `Permissions`, `PostLogoutRedirectUris`, `Properties`, `RedirectUris`, `Requirements`, `Settings`) are explicitly excluded global legacy configuration.
- The seven scope fields (`Description`, `Descriptions`, `DisplayName`, `DisplayNames`, `Name`, `Properties`, `Resources`) are explicitly excluded global legacy configuration.
- The 34 tenant authorization rows and four token rows remain archive evidence only. Reusable token payloads, reference IDs, password hashes, and security stamps are redacted from the V2 archive load; their original row hashes remain available for reconciliation in the sealed snapshot.
- No OpenID client secrets, tokens, or cryptographic material will be replayed.

Final field coverage is therefore:

| Classification | Fields |
|---|---:|
| Direct | 114 |
| Transformed losslessly | 45 |
| Controlled legacy archive | 1,048 |
| Explicitly excluded | 209 |
| Unresolved | **0** |
| **Total** | **1,416** |

The nine former relationship/index gaps are also closed:

- Four legacy identity lookup records collapse to verified V2 Auth/email equivalents: Supabase Auth identity lookup, unique case-insensitive `user_profiles.email`, and `(role, user_id)` lookup.
- `MediaAssets.Id` capability is enforced by a unique partial source-asset index and a unique `(legacy_blob_database, legacy_blob_id)` index.
- The four OpenID application/scope indexes are explicitly excluded with the inactive-contract fields above.

## 3. Applied and proposed changes

Applied to hosted V2/UAT after a clean local rehearsal:

1. `vno_phase_d2_import_readiness` (hosted migration version `20261013235336`)
   - original transaction parent IDs and UTC companion timestamps;
   - stable identity/media uniqueness;
   - restart checkpoints and conflict quarantine;
   - numbering/audit persistence;
   - restrictive RLS and grants;
   - private Storage bucket enforcement.
2. `vno_phase_d2_fk_indexes` (hosted migration version `20261013235501`)
   - covering indexes for all new migration/audit foreign keys.

Hosted post-apply checks show 14 merchants, 14 collaborators, zero transactions, and zero media assets: no production data was imported. Both Storage buckets remain private.

Implemented in the workspace but **not committed or deployed**:

- restartable sealed-snapshot importer and exact reconciliation logic;
- deterministic V2 duplicate matcher;
- isolated rehearsal bootstrap and authorization suite;
- transaction, commission, and signed-media backend interfaces;
- Supabase-only password verification (the former failed-login password synchronization path was removed);
- merchant/collaborator ownership checks and Admin-only collection/mutation endpoints;
- password fields removed from API responses and new domain-row password persistence disabled.

## 4. Auth migration design

For each active, non-deleted V1 user:

1. Match exact legacy UUID first, then case-insensitive email.
2. Reuse an existing Auth user only when the email, V2 role, and merchant/collaborator association agree.
3. Otherwise create the Supabase Auth account with the legacy UUID when available, a non-disclosed random bootstrap password, and role/legacy identity in `app_metadata`.
4. Create `legacy_identity_map` and require password reset before normal onboarding.
5. Never import ASP.NET Identity password hashes, security stamps, OpenID tokens, or refresh tokens.
6. Do not send recovery/invite mail during import or rehearsal. Send password-reset onboarding only after SMTP, templates, rate limits, and support procedures are approved.
7. Archive the 16 deleted/no-role users only; do not create active Auth accounts for them.

This follows Supabase's supported Admin Auth migration model: preserve UUIDs where appropriate, keep authorization in `app_metadata`, and use reset onboarding when the legacy hash is not a supported portable hash. See [Supabase Auth migration guidance](https://supabase.com/docs/guides/platform/migrating-to-supabase/auth0).

## 5. Existing V2 reconciliation

Live V2 was compared without exposing customer values. Results:

| Entity | Existing V2 | V1 source | Auto-matched | Conflicts | New V1 additions |
|---|---:|---:|---:|---:|---:|
| Merchants | 14 | 148 | 0 | 0 | 148 |
| Collaborators | 14 | 270 | 0 | 0 | 270 |
| Auth users | 15 | 433 | 0 | 0 | 433 (417 active; 16 archive-only) |

Match precedence is legacy UUID, exact business code, case-insensitive email, then normalized phone. Name similarity is never an automatic match. The 28 existing V2 merchant/collaborator rows remain untouched. Of eight existing V2 categories, four matched V1 names deterministically and four remain V2-only.

## 6. Timezone interpretation

Source evidence is explicit: the tenant-scoped `AbpSettings` row sets `Abp.Timing.TimeZone` to `SE Asia Standard Time`. Microsoft-to-IANA mapping in [Unicode CLDR `windowsZones.xml`](https://github.com/unicode-org/cldr/blob/main/common/supplemental/windowsZones.xml) maps that zone to `Asia/Bangkok`, which is UTC+07:00 and has no daylight-saving transition for these dates.

Rules implemented:

- Preserve every original SQL Server `datetime2` string in its legacy field/archive payload.
- Interpret operational timestamps as `Asia/Bangkok` local wall time and persist UTC `timestamptz` companions.
- Preserve `0001-01-01T00:00:00` as the archived legacy sentinel but map the operational posting timestamp to `NULL`; no fictitious date or offset is invented.

## 7. Media strategy and rehearsal

Object keys are deterministic: provenance + source database + source blob UUID + signature-derived extension. Merchant assets use `merchant-media`; collaborator assets use `partner-media`; CMS and required unreferenced assets remain in private legacy prefixes. The metadata row stores source IDs, owner relationship, MIME, size, SHA-256, bucket, and object path.

The importer verifies each file immediately before upload and uses a stable source identity. A restart writes the same object and metadata identity and revalidates the same checksum.

Isolated rehearsal results:

| Invariant | Result |
|---|---:|
| Legacy merchants | 148 |
| Legacy collaborators | 270 |
| Categories / links | 18 / 272 |
| Transactions | 102 |
| Update requests | 38 |
| Archive rows | 11,726 |
| Active Auth identities / identity maps | 417 / 417 |
| Media metadata / Storage objects | 618 / 618 |
| Metadata bytes / Storage bytes | 416,329,553 / 416,329,553 |
| Missing Storage objects | 0 |
| Duplicate source blobs | 0 |
| Document total | 377,705,162.0000 |
| Discount total | 24,077,880.8000 |
| Commission total | 27,466,958.1000 |
| Missing merchant parent | 1, original ID preserved |
| Missing collaborator parent | 0 |
| Broken category links | 0 |
| Domain password values imported | 0 |

A second full run used the same deterministic batch ID and reproduced the same counts, totals, 618 objects, and archive cardinality without duplicates.

## 8. RLS and authorization results

All tested controls passed:

- anonymous catalogue read: allowed;
- anonymous merchant/collaborator/private-financial reads: denied;
- Admin, Merchant, and Collaborator Supabase Auth login: passed;
- own-profile read and cross-profile isolation: passed;
- profile role escalation: denied;
- direct financial Data API access for all authenticated roles: denied;
- Admin transaction/commission/media routes: allowed;
- Merchant admin-list routes: denied; own transaction/commission routes: allowed;
- anonymous merchant and collaborator collection reads: denied;
- public verified-merchant response contains no password field;
- organization-profile mutation requires Admin;
- Merchant can update its own row; Collaborator cannot update a foreign merchant.

The post-migration advisor has no unindexed-foreign-key finding. Its RLS-with-no-policy notices are intentional fail-closed controls for service-role-only tables. Public GraphQL visibility is limited to `categories`, `organization_profile`, and own-profile access under RLS.

## 9. Remaining blockers and decision

Remaining blockers before a production V2 import:

1. Enable Supabase leaked-password protection; the hosted Auth advisor still reports it disabled.
2. Review and accept the uncommitted application/import changes, then authorize a controlled commit/deployment separately.
3. Configure and approve SMTP/password-reset onboarding, including templates, rate limits, support handling, and a dry run with non-customer addresses.
4. Take and verify a hosted V2 rollback/backup point immediately before import, and freeze concurrent onboarding/writes for the import window.
5. Run the same role/API smoke suite against the deployed V2 application before loading customer records.

**Production V2 import: NO-GO.**

The sealed data and importer are technically rehearsal-ready, and the structural/data invariants passed. Production import remains blocked by the undeployed application changes and the unresolved hosted Auth security/onboarding controls. No production import or cutover should begin until those five items are closed and explicitly approved.
