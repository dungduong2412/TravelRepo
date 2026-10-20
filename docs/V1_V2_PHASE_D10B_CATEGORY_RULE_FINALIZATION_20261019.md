# VNO D10B — Merchant Category Rule Finalization

Date: 2026-10-19 (Asia/Ho_Chi_Minh)

Status: **LOCAL CANDIDATE VERIFIED; EXPLICIT MIGRATION APPROVAL REQUIRED**

Target migration: `supabase/migrations/20261018021253_vno_phase_d10b_media_approval.sql`

Superseded SHA-256: `4a16e3a8cd3d9a936fe449db112c9d5db2c26dc184c60866d6257a6c2ba79139`

Revised SHA-256: `6cb9a6e3f65db0fd991d9ee01e9efdca10e2509c0c4ef9893b69347bf0c47d8f`

Linked UAT migration executed: **No**

Git commit/push, Railway staging/deployment, V1 access or production import: **No**

## Accepted rule

New V2 assignments and category changes allow **zero to three distinct categories per merchant**. Existing or subsequently imported V1 associations are preserved even when their historical count exceeds three. The maximum is a V2 acceptance rule and is not represented as a V1 database constraint.

## Revised SQL diff

Compared with the previously reviewed migration, the exact SQL changes are 131 insertions and five deletions:

1. Add `merchant_category_links.association_source`.
2. Classify rows already present when the migration runs as `legacy_preserved`; no link is deleted, truncated or remapped.
3. Default future rows to `v2` and constrain provenance to `legacy_preserved`, `v1_import` or `v2`.
4. Add security-invoker trigger function `enforce_merchant_category_limit()` and trigger `merchant_category_links_limit_trg`.
5. Permit a `v1_import` cardinality exemption only for controlled inserts backed by stable V1 merchant/category identities and compatible tenant provenance.
6. Treat `legacy_preserved` associations as immutable through direct row mutation. A governed category change replaces them with zero to three `v2` links in one transaction.
7. Serialize V2 relationship writes with a per-merchant transaction advisory lock, preventing two concurrent direct inserts from racing to a fourth category.
8. Reject a fourth direct V2 association at the table trigger even when the application API is bypassed.
9. Update `set_merchant_categories` to reject arrays longer than three, reject duplicates, validate referenced categories before deleting anything, replace links transactionally, and write both previous and resulting IDs to the audit event.
10. Restrict the trigger function from `public`, `anon` and `authenticated`; retain service-role-only backend operation.

The complete revised file is 574 lines and remains enclosed in a single `begin` / `commit` transaction.

## Application and importer changes

| Layer | Change |
|---|---|
| Backend DTO | `category_ids` now accepts 0–3 UUIDs and rejects duplicate IDs. |
| Backend service | Category-only PATCH requests no longer attempt an empty merchant-row update; the response is refreshed after category replacement. Omitting `category_ids` leaves all associations untouched. |
| Merchant UI | Shows selection count, disables additional unchecked choices at three, and preserves a historical over-limit selection unless the user deliberately changes it. Unchanged category IDs are omitted from the PATCH. |
| Admin UI | Uses the same count/disable behavior. Unrelated profile edits omit `category_ids` when the association set is unchanged, so a legacy merchant above the limit is not blocked. |
| V1 importer | Writes `association_source = 'v1_import'`; no historical association is discarded to meet the V2 limit. |
| Audit | Successful governed changes retain authorization and record previous and resulting category IDs. |

## Changed files for this rule

- `supabase/migrations/20261018021253_vno_phase_d10b_media_approval.sql`
- `backend/src/modules/merchants/merchants.dto.ts`
- `backend/src/modules/merchants/merchants.service.ts`
- matching generated merchant files under `backend/dist/modules/merchants/`
- `frontend/app/merchant/dashboard/profile/page.tsx`
- `frontend/app/admin/merchants/page.tsx`
- `migration/v2/import-sealed-snapshot.mjs`
- `backend/scripts/test-d6-contracts.ts`
- `migration/v2/test-d10b-category-limit.mjs`
- this report

Other modified D10B media files and pre-existing reports in the working tree are unchanged in scope by this category-rule finalization.

## Category acceptance evidence

Disposable-local category suite: **11/11 PASS**.

| Control | Evidence |
|---|---|
| Zero categories | HTTP 200; zero stored links |
| One category | HTTP 200; one stored link |
| Two categories | HTTP 200; two stored links |
| Three categories | HTTP 200; three stored links |
| Four through API | HTTP 400; prior three links unchanged |
| Duplicate IDs through API | HTTP 400; prior three links unchanged |
| Direct fourth database association | HTTP 400; stored count remained three |
| Concurrent third/fourth direct writes | One HTTP 201 and one HTTP 400; stored count remained three |
| Validated V1 import with four links | HTTP 201; all four stored as `v1_import` |
| Unrelated edit on four-link legacy merchant | HTTP 200; all four links unchanged |
| Audit trail | Successful governed changes produced audit events |

A separate pre-migration simulation seeded four historical links with no category provenance, ran the exact revised migration, and returned `4:4`: all four associations remained, and all four became `legacy_preserved`.

## Migration and schema verification

- Exact migration apply on disposable local Supabase: PASS.
- Exact migration rerun: PASS.
- Normalized schema before/after rerun: identical SHA-256 `8b28ca69faa011373d2dbbf95058cd769ca13f19d42072169aa24b3d671562e3`.
- The only raw `pg_dump` difference was PostgreSQL 18's randomly generated `\\restrict`/`\\unrestrict` token; normalized schema definitions were identical.
- `supabase db lint --local`: no schema errors.
- Local migration history contains `20261018021253` exactly once.
- RLS/grant posture remains service-role-only for `merchant_category_links`; no client table grant or policy was added.

## Regression evidence

| Suite | Result |
|---|---:|
| D10B media approval workflow | 22/22 PASS |
| D10B category rule | 11/11 PASS |
| D10 financial/merchant workflow | 14/14 PASS |
| D6 functional workflow | 22/22 PASS |
| Authorization controls | 35/35 PASS |
| Backend contract assertions | 28/28 PASS |
| D9 media lifecycle/cleanup | 8/8 PASS |
| Backend typecheck, lint, production build | PASS |
| Frontend typecheck and production build | PASS |
| Frontend lint | PASS with 15 warnings and zero errors; warnings are the already documented image/navigation findings |
| Backend runtime/full dependency audit | 0 vulnerabilities |
| Frontend runtime dependency audit | 0 vulnerabilities |
| Frontend full dependency audit | Five high development-only findings remain in the documented ESLint dependency chain; forced fix is breaking and was not applied |

The D10 financial suite reconciled 1,008 synthetic rows exactly: document total `1605.3234`, discount amount `60.1311`, and commission amount `30.0162`. Null source status and the orphan transaction remained preserved. Category tests did not alter financial rows.

## Safety and behavior conclusions

- Existing V1 associations are not altered merely because their count exceeds three.
- An unrelated merchant PATCH omitting `category_ids` does not invoke category replacement.
- Once an over-limit historical merchant deliberately changes categories, the complete requested replacement must contain zero to three distinct IDs.
- Invalid arrays are rejected before merchant profile persistence by the API validator, and independently by the transactional database RPC.
- Direct V2 relationship writes are capped by a concurrency-safe table trigger.
- Duplicate direct rows remain rejected by the existing composite primary key.
- V1 import exemption is explicit, provenance-bearing and tied to stable legacy identities; it is not available to browser clients.

## Recommendation

**GO for explicit approval to apply the revised migration to isolated Supabase UAT.** The previous checksum is superseded and must not be approved or used. Execution must use only the revised file with SHA-256:

`6cb9a6e3f65db0fd991d9ee01e9efdca10e2509c0c4ef9893b69347bf0c47d8f`

Before execution, repeat the existing linked-project, checksum, migration-history backup and dry-run gates. Stop if the dry run proposes any migration other than `20261018021253`. Application push and Railway deployment remain separate approval gates.
