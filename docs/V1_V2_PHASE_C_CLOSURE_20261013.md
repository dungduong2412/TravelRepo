# VNO V1 → V2 Phase C closure report — 2026-10-13

## Decision

**Overall: NO-GO for migration acceptance, V2 data load, deployment, or
cutover.** The controlled extractor and tenant filter are technically ready for
a new private source snapshot, but structural/application parity is not yet
complete. This report authorizes no extraction run and no V2 mutation.

## Safety and scope

- V1 was accessed only through read-only SQL and container-status inspection.
- No V1 service, configuration, file, container, or row was modified.
- V2 was introspected only. No migration or customer data was applied.
- No secrets, private-key material, passwords, tokens, customer rows, or binary
  contents were printed or copied into the repository.
- No commit, push, deploy, cutover, or port-3000 action occurred.

## Final field coverage

The generated field matrix covers all 1,416 columns in all 135 inventoried V1
tables exactly once.

| Classification | Fields | Closure evidence |
|---|---:|---|
| Direct | 114 | Dedicated live V2 columns verified |
| Transformed losslessly | 45 | Stable-ID, role, Auth, relationship, JSON, or Storage transformation; original value also archived |
| Controlled legacy archive | 1,048 | Tenant/provider/relationship scoped and retained in restricted archive |
| Explicitly excluded | 188 | Shared ABP definitions, migration history, empty SaaS billing infrastructure, OpenIddict implementation/secret metadata, or separate Aeretha service |
| Unresolved blocker | 21 | 14 OpenIddict application-contract fields and 7 OpenIddict scope-contract fields |
| **Total** | **1,416** | No unclassified fields |

Of the original 257 unresolved fields, 48 are now justified archive fields, 188
are explicit exclusions, and 21 remain blocked. The 21 blockers are not customer
rows: five global OpenIddict applications and nine global scopes exist, while V2
currently implements only password login and role checks. VNO ownership and the
required client/scope authorization semantics cannot be inferred safely.

Twenty-two fields are blocked (`verification_status=blocked`): the 21
OpenIddict contract fields plus `AbpUsers.Email`, whose Auth transformation must
be validated against the accepted snapshot. Three timestamp transformations
remain unverified because V1 `datetime2` has no timezone and V2 uses
`timestamptz`; the original values remain losslessly archived.

Important closure evidence:

- VNO roles are exactly `admin`, `BUS`, and `CTV`, mapping to V2 `admin`,
  `merchant`, and `collaborator`.
- 417 users have exactly one role; no user has multiple roles.
- The remaining 16 users are deleted and have no role.
- All 433 VNO users have email values. Three duplicate normalized-email groups
  exist only when deleted users are included; active/non-deleted users have zero
  duplicate email or username groups.
- All 18 category names are present and unique. `IsActive` and `IsShow` are NULL
  for all 18 rows, so NULL can be preserved without inventing a legacy value.
- Twenty-one VNO feature values were isolated by the exact tenant provider key.
  Restaurant, audit logging, and setting management are enabled; legacy CMS,
  file-management, multi-branch, forms, and text/language features are disabled.

The complete per-field evidence is in `V1_V2_FIELD_MATRIX.csv`.

## Relationship and index coverage

The schema-object matrix accounts for every inventory record: 58 foreign-key
records and 339 index-column records.

| Classification | Records |
|---|---:|
| Verified V2 equivalent | 26 |
| Preserved archive metadata | 315 |
| Explicitly excluded non-VNO infrastructure | 47 |
| Unresolved operational/configuration gap | 9 |
| **Total** | **397** |

The nine pending records are:

- Four V1 identity lookup indexes on email/normalized email/username. The V2
  backend queries `user_profiles` by email and role, but no equivalent email
  index exists.
- One `MediaAssets.Id` primary-key capability. V2 currently has only a non-unique
  index on `legacy_media_asset_id`.
- Four OpenIddict application/scope primary/name/client indexes, blocked by the
  unresolved Auth client/scope contract.

Core merchant-image, merchant-category, merchant-user, role-membership,
transaction identity, merchant identity, collaborator identity, category
identity, update-request identity, and relationship lookup capabilities have
verified V2 equivalents. Non-operational archived tables retain original key
values in `legacy_source_records.source_payload` and their definitions in the
versioned schema-object matrix.

## Shared infrastructure versus VNO functionality

Read-only source aggregates distinguish the following:

- Shared ABP definition catalogs: feature definitions, permissions, settings,
  localization, language and template definitions. VNO has zero role permission
  grants; these catalogs are not customer-data exports.
- Tenant feature state: 21 `AbpFeatureValues` rows match the exact VNO provider
  key and must be archived.
- SaaS billing: payment plans, payment requests, gateway plans and products all
  contain zero rows. The VNO tenant has no edition assignment. These are shared
  platform infrastructure, not VNO domain data.
- Aeretha: two global donor rows exist in a separate service/database with no
  tenant key and no V2/VNO application references; explicitly excluded.
- Event inbox, GDPR requests/info, linked users and domain-verification attempts:
  zero VNO rows. Their structures are accounted for; no customer record is lost.
- CMS blog features: 12 global rows, zero related to a VNO blog. VNO CMS feature
  toggles are disabled.
- Numbering is VNO functionality: 34 VNO numbering configurations, six detail
  rows and three referenced definitions support Restaurant,
  RestaurantMiddleman and RestaurantComTrack numbering. V2 currently lacks this
  runtime capability.
- Audit logging is VNO functionality: `AuditLogging.Enable=True` and the prior
  tenant inventory contains audit history. V2 currently lacks equivalent domain
  mutation auditing.

## Business capability parity

| Capability | Structural data target | Current application behavior | Assessment |
|---|---|---|---|
| Merchants | Present | CRUD/approval endpoints respond; profile update DTO does not accept most profile fields; several reads/writes are unguarded | Partial / unsafe |
| Collaborators | Present | CRUD, approval, QR and login exist; public list exposes all rows through the service-role backend | Partial / unsafe |
| Categories | Present | Public read and admin CRUD respond | Partial: RLS disabled and merchant-category link table is unused |
| Merchant-category relationships | Present | No backend query or update uses `merchant_category_links`; UI stores one text category | Missing V1 many-to-many capability |
| Commission rates | Present on merchant | Editable/displayed as merchant metadata | Partial |
| Commission transactions | Table present | No module/controller/UI; `/transactions` and `/commissions` return 404 | Missing |
| Merchant update requests | Table present | No module/controller/UI; endpoint returns 404 | Missing |
| Authentication | Supabase Auth + profiles present | UAT login model works for seeded users; legacy password reset/import workflow is not implemented; duplicate password copies remain in domain tables | Not migration-ready |
| Media | Private buckets and `media_assets` present | Buckets contain zero objects; UI converts images to base64 fields; no Storage upload/provenance service; `/media` returns 404 | Missing |
| Number generation | Proposed archive/config tables only | No V2 runtime service | Missing |
| Audit logging | Proposed audit table only | No V2 mutation instrumentation | Missing |

Backend and frontend TypeScript checks pass. Frontend lint completes with
warnings only. Live aggregate endpoint checks return HTTP 200 for categories,
merchants and collaborators, and HTTP 404 for transactions, commissions, media
and merchant update requests. The successful merchant/collaborator calls without
credentials also prove an authorization gap, not parity.

Live V2 contains UAT seed data only: 15 Auth users, 14 user profiles, 14
merchants, 14 collaborators and eight categories. Migration/relationship/media
tables and both private Storage buckets contain zero rows/objects.

## Required V2 changes

No proposal was applied.

1. Review and apply `supabase/proposals/vno_phase_c_structural_parity.sql` after
   approval. It adds original transaction relationship IDs, stable media-source
   uniqueness, identity lookup indexes, controlled numbering tables and an
   append-only audit destination with restrictive grants/RLS.
2. Review and apply `supabase/proposals/vno_v1_rls_grants_remediation.sql` after
   Admin acceptance. Current critical findings are RLS disabled on `categories`
   and `organization_profile`; migration/financial/domain tables are also
   discoverable through grants despite deny-all RLS.
3. Add authenticated/authorized backend modules for transactions, commissions,
   media/Storage, merchant update requests and merchant-category relationships.
4. Instrument every privileged mutation into `audit_events` and implement the
   three legacy numbering workflows.
5. Remove public merchant/collaborator data exposure. Guard list/detail/update
   routes and return only explicit DTO fields.
6. Replace password mirroring/synchronization with controlled Supabase Auth
   creation plus mandatory reset. Never replay V1 password hashes or tokens.
7. Identify the VNO-owned OpenIddict applications/scopes and either reproduce
   their authorization contract or approve their explicit exclusion. Rotate or
   regenerate all client secrets and key material; never migrate them.
8. Approve an explicit timezone interpretation for legacy `datetime2` values.

The latest Supabase security advisors also report unrestricted profile insert,
an update policy without `WITH CHECK`, mutable function search paths, leaked
password protection disabled, and broad GraphQL visibility. These must be
closed before production exposure.

## SSH connectivity diagnosis

The earlier timeout is no longer reproducible:

- TCP 2233: reachable in approximately 10 ms.
- TCP 80/443: reachable.
- TCP 22: timeout, consistent with SSH being intentionally exposed only on 2233.
- ICMP echo: filtered.
- Traceroute reaches `171.244.41.205` at hop 10.
- SSH authentication on 2233 succeeds and `sql-server-db` reports `running`.

Client-side evidence rules out a persistent local route, key, username or SSH
daemon failure. It cannot distinguish a temporary upstream firewall/NAT event,
host load, or transient port-forward/service interruption. No server setting was
changed.

## Revalidated source controls

Tenant ownership was revalidated from the exact provider key:

- Tenant UUID: `B7688A1C-23F9-637D-C2FB-3A16EB1BEFD2`
- Branding: `Vietnam Number One`, `VN Number One`, `VNO`
- Merchants: 148
- Collaborators: 270
- Transactions: 102
- Category links: 272
- Merchant update requests: 38

Financial reconciliation is unchanged:

- Document total: `377,705,162.0000`
- Document discount: `24,077,880.8000`
- Commission amount: `27,466,958.1000`
- Document range: 2025-04-12 11:50:23.7807922 through
  2026-04-21 10:06:34.5069108
- Orphans: one missing restaurant relationship, zero missing collaborator
  relationships. The original restaurant ID must be retained in
  `legacy_restaurant_id`; `merchant_id` remains nullable.

Media reconciliation is unchanged:

- 432/432 merchant images resolve, 290,301,435 bytes.
- 76/76 collaborator images resolve, 45,243,172 bytes.
- 611 tenant MDM blobs total 415,859,374 bytes: 508 referenced and 103
  unreferenced (80,314,767 bytes).
- Seven CMS `brand-assets` blobs total 470,179 bytes; none has a descriptor
  match.
- Total retained media: 618 blobs, 416,329,553 bytes.

## Controlled-export readiness

The tenant predicate, aggregate controls, extractor permission model, binary
hash/length verification and blob-reuse checks are ready. Source SSH and SQL are
currently reachable, and the extractor compiles. The three earlier staging
directories remain invalid/incomplete and are not migration inputs.

**Conditional GO for a new private read-only extraction attempt only:** first
run the bounded 100-blob validation, then create a new snapshot using verified
blob reuse. Acceptance requires every table count, source hash, binary hash,
byte count, file mode, financial total and orphan control to pass.

**NO-GO for accepting that snapshot as load-ready, loading V2, deployment or
cutover** until the 21 OpenIddict field blockers, nine relationship/index gaps,
required migrations, application capability gaps and security findings above
are closed and manually accepted.

## Sources receipt

- Local authoritative inventory:
  `vno_v1_schema_20261011_152737.txt` (1,416 columns, 58 FK records, 339 index-column records).
- Live V1 read-only SQL on 2026-10-13:
  `00b_tenant_brand_evidence.sql`, `06_validation_aggregates.sql`,
  `09_partner_media_coverage.sql`, `12_cms_blob_provenance.sql`, and
  `13_phase_c_closure_counts.sql`.
- Live V2 read-only Supabase introspection on project
  `hsezyogfxgnkpweoqqny`: tables, constraints, indexes, RLS policies, grants,
  buckets, row counts and security/performance advisors.
- V2 repository behavior: NestJS modules/controllers/services and Next.js pages,
  plus successful backend/frontend typechecks and bounded HTTP aggregate checks.
- Supabase current changelog reviewed 2026-10-13; the upcoming TLS cipher change
  and PostgreSQL 17.11 notes do not alter this parity decision.
