# VNO V2 — Global Partner network correction (2026-11-09)

**Business rule (owner decision).** Every ACTIVE Partner may refer customers to every ACTIVE Merchant. There is **no** mandatory Partner-to-Merchant assignment. Release `5af1d86` (2026-11-08) wrongly treated the assignment as a prerequisite; this release removes that restriction without touching the Merchant Profile fixes from the same release.

**Status: see §9.** Source, tests and migration are complete and verified locally (unit, PostgREST integration, rehearsal database). The UAT migration, the deploy and the hosted acceptance run are tracked in §9 — nothing in this document is a hosted PASS unless §9 says so.

## 1. Root cause — the wrong rule lived in four layers
| Layer | Where | What it did |
|---|---|---|
| Database | `create_real_transaction` (D14) and `create_uat_simulation_transaction` (D13) | `raise exception 'Partner is not assigned to this Merchant' errcode 42501` → API 403 |
| API | `TransactionsService.previewRealTransaction` | `PARTNER_NOT_ASSIGNED` 403 before any price was shown |
| API | `QrService.discountFor` / `resolveForMerchant` | discount only "when the Partner belongs to this Merchant"; response carried `association` (`unassigned` → "Partner chưa được gán…") |
| UI | Merchant scan page, Merchant dashboard, Admin › Partners (drawer panel, list column, create-form field), public `/c/<code>` page | blocked "Tiếp tục thanh toán", showed "chưa được gán", offered assignment controls |

Because the rule was also in the database function, removing it needs a **controlled migration** (the previous release had none). Reproduced on the rehearsal database before changing anything: the old function refuses an unassigned Partner with `42501`.

## 2. What changed
**Domain behaviour**
* QR resolve: validates the code and that the Partner is active + verified; returns name, avatar, code, status, **this Merchant's own** customer discount (or `Không có ưu đãi áp dụng`), and `payment.available` (whether *this* Merchant can record a transaction). No `association` field exists any more; nothing says "not assigned".
* Transactions: any active verified Partner at any active verified Merchant. The Merchant sends only the original invoice amount (+ optionally the scan it came from); discount, final payable and commission come from the Merchant policy; one explicit confirmation; existing idempotency / ledger / audit unchanged.
* Commercial policy (`backend/src/modules/commercial/commercial-policy.ts`, mirrored in SQL):
  * **Commission** must be explicitly configured (`percentage`, 0 ≤ value ≤ 1). Absent → `422 COMMISSION_POLICY_MISSING`; out of range / legacy → `422 COMMISSION_POLICY_NOT_REVIEWED`. **0 is allowed only when the policy itself says 0**; it is never defaulted.
  * **Customer discount** is independent: NULL or 0 → no discount (the customer pays the full amount); a policy that is present must be a reviewed percentage fraction, otherwise `422 DISCOUNT_POLICY_NOT_REVIEWED` (legacy "points" are never guessed).
  * No offer/campaign model exists in the database, so the Merchant-level policy is the only source today; nothing is invented. If campaigns are introduced they plug into this one module.
* Walk-ins: every successfully resolved scan is one row in the new `partner_scan_events` table, unique per `(Merchant, scan key)`; a transaction stores `scan_event_id` and links to it. Scan-only activity writes that one row and nothing else.
* Admin: the Merchant-association panel (my previous release), the "Merchant associations" list column and the older "Merchant assignment (optional)" create-form field are removed. The public Partner page `/c/<code>` now says the code works at every active Merchant.

**Preserved on purpose:** `collaborators.merchant_system_id` and every historical audit row (`collaborator.merchant_association_changed`, scan rows in `audit_events`) — nothing deleted, no automatic assignment. The Admin API still *accepts* `merchant_system_id` (legacy, no longer consulted anywhere).

## 3. Scan data: audit table vs dedicated table (review and decision)
`audit_events` is governance data (who did what, append-only, reviewed by humans). Walk-in scans are high-volume operational analytics: they bloated the audit trail, were de-duplicated only by an **in-process lock** (not safe across API instances), could not carry a foreign key to the transaction, and the report had to scan `audit_events` by JSON path. Decision: a **dedicated table** now, since a migration is unavoidable anyway.
* `public.partner_scan_events` — `id`, `merchant_id` → merchant_details, `collaborator_id` → collaborators, `scan_key`, `key_kind` (`scan_id`|`window`), `source`, `actor_auth_user_id`, `scanned_at`; **unique (merchant_id, scan_key)** (the database, not a lock, guarantees "one scan session counts once"); RLS on, no anon/authenticated privilege; indexes on (merchant, time) and (Partner, time).
* `referral_transactions.scan_event_id` (nullable FK, partial index) — a transaction links to its scan; several transactions may reference one scan (a cancelled attempt then a corrected one).
* Existing scan rows in `audit_events` (32, all synthetic from my own test runs; none for Partner3) are **kept as history and not migrated**; the new report starts from the table. No scan is recorded in `audit_events` any more.
* Not done (proposal for a later window): retention/partitioning of `partner_scan_events` if volume ever warrants; the report reads ≤ 10 000 rows per query (reports `truncated: true`), a SQL aggregate would remove that cap.

## 4. Migration `supabase/migrations/20261109000001_vno_global_partner_network.sql`
Additive for data, replaces two functions:
1. create `partner_scan_events` (+ indexes, RLS, revoke) · 2. `alter table referral_transactions add column scan_event_id` · 3. `drop` the 4-argument `create_real_transaction` and create the 5-argument one (`p_scan_event_id uuid default null`; a 4-argument and a 5-argument overload together would be ambiguous for PostgREST named calls) · 4. `create or replace create_uat_simulation_transaction` — only the assignment check removed.

**Compatibility during rollout:** a caller that sends the four named arguments (the currently deployed API) keeps working against the new function. Order: migration → API → Web.
**Rehearsal (disposable Postgres 17 + PostgREST v14.5, `migration/v2/rehearsal/start-rehearsal-stack.sh`):** all repo migrations apply in order; 24 SQL assertions pass (migration/v2/rehearsal/global-network-assertions.sql) (global behaviour, policy errors, scan link rules, idempotency, privileges, single overload); the pre-existing transaction and Partner-assignment checksums are identical before/after; the rollback script refuses while transactions reference scans, then restores both functions exactly and the migration re-applies cleanly.
**Apply tool:** `migration/v2/apply-global-partner-network.mjs` (needs `SUPABASE_DB_PASSWORD`): prechecks → backup (schema, current function definitions, financial tables, counts/checksums) → apply in one transaction → register history → 17 postchecks → evidence; `--dry-run` runs the prechecks only. Validated end-to-end against the rehearsal database (17/17).
**Rollback:** `migration/v2/rollback/20261109000001_vno_global_partner_network_rollback.sql`, then `delete from supabase_migrations.schema_migrations where version = '20261109000001'`; application rollback = re-stage both services to `5af1d86`.

## 5. Tests run (local)
| Suite | Result |
|---|---|
| backend `tsc --noEmit`, eslint on touched modules | clean (1 pre-existing warning) |
| `test:merchant-qr-flow` (rewritten for the global model) | **23 controls PASS**; mutation-checked: re-introducing the assignment 403 or a defaulted commission makes it fail |
| `test:rehearsal-global-network` (**new**: real services → supabase-js → PostgREST v14.5 → migrated Postgres) | **9 controls PASS** — incl. 6 racing requests for one scan = 1 walk-in, the 5-argument function through named args, scan↔transaction link, cancelled transaction not "converted" |
| `test:merchant-profile-update` 10, `media-lifecycle` 18, `approve-unclaimed` 7, `main-media` 13, `public-catalog` 14, `anonymous-privacy` 3, `d6-contracts` 28, `invitation-guards` 3, `auth-email-hook` 15, `partner-single-step` | PASS |
| frontend `tsc`, eslint (0 errors), selftests (merchant-profile, qr 46 frames, partner-registration, auth-errors), `next build` | clean / PASS |
| e2e `tsc` (specs 10, 30, 99, 100 updated; **101 new**) | clean |

## 6. Failing tests that are NOT caused by this release (reported separately; identical on the unmodified tree)
* `test:d13a-contracts` — asserts `qr_payload_format: 'collaborator_code'`, but `collaborators.service.ts` emits `'url'` (stale QR-contract assertion; pre-existing since before 5af1d86).
* `test:email-delivery` — 37 passed, **2 failed**: the hook's signup-confirmation and recovery "exactly one bilingual message…" checks (pre-existing).
* `migration/v2/test-d13-integrated-api.mjs`, `test-d14-real-transactions.mjs`, `test-qr-compatibility.mjs`, `test-final-invitation-e2e.mjs` still assert the retired `association` field; they are archived phase scripts, not part of the regression set, and were left untouched.

## 7. Hosted acceptance map (spec `e2e-uat/tests/101-global-partner-network.spec.ts`, plus regression)
| Scenario | Step |
|---|---|
| A Partner3 scans at a Merchant without assignment | `A` |
| B the same Partner at a second active Merchant | `B` (temporary synthetic Merchant, removed afterwards) |
| C each Merchant resolves its own discount; "Không có ưu đãi áp dụng" | `C` (API + UI) |
| D scan with no invoice = one walk-in, no commission | `D` |
| E Merchant enters only the invoice amount | `E` (UI: the payment step has exactly one input) |
| F transaction succeeds without assignment; idempotent; audited; linked to its scan | `F` |
| G inactive Partner / unauthorised actions denied | `G`; policy-missing answers `P` |
| H Merchant Profile fixes + audit controls intact; no assignment UI | `H` + spec `100-merchant-profile` M1–M7 |
| I regression: authorization, QR, commission arithmetic, idempotency, reporting | `I` + specs 00, 10-adjacent, 20, 30, 40, 95, 98, 99 |

Partner3 is only scanned (a scan row is written, as acceptance A/B/D require); it is never modified, assigned or given a transaction. Transactions are recorded for a **synthetic** unassigned Partner.

## 8. Open items / for awareness
1. **Partner "Members" page** (`/collaborator/dashboard/members`, API `/collaborators/members`) is a separate legacy team feature keyed on the historical `merchant_system_id` ("Collaborator is not assigned to a merchant team"). It is not part of QR, discount or transactions and was left as is — please confirm whether it should be retired or re-modelled.
2. **QR authenticity:** the Partner QR contract is a code/URL (no cryptographic signature). "Authentic" therefore means: well-formed VNO payload, existing Partner, verified + active. Signing the QR would be a contract change; not done.
3. Most real Merchants have **no commercial policy**: of 16 active+verified Merchants on UAT, 14 have neither discount nor commission configured and 2 have both. Those 14 can scan Partners (walk-ins count) but get the explicit `COMMISSION_POLICY_MISSING` answer on payment until an Admin configures their commission. This is by design (nothing is invented) but is the main thing that will surprise testers.
4. Walk-in history before this release lives in `audit_events` (32 synthetic rows); not carried over.
5. Still open from earlier releases: real iPhone-in-Zalo QR validation; Partner3 activation-link click; `POST /transactions/:id/confirm|cancel|reverse` return 500 for a malformed id.

## 9. Deployment status and hosted evidence
_(filled in as the steps are executed — see the end of this file)_
