# VNO V2 — Global Partner network correction (2026-11-09)

**Business rule (owner decision).** Every ACTIVE Partner may refer customers to every ACTIVE Merchant. There is **no** mandatory Partner-to-Merchant assignment. Release `5af1d86` (2026-11-08) wrongly treated the assignment as a prerequisite; this release removes that restriction without touching the Merchant Profile fixes from the same release.

**Status: Technical UAT PASS for the Global Partner network (deployed to UAT at `4763394`, UAT only). Business UAT is OPEN** until real-device QR testing and owner sign-off — see §9 and §10. Source, tests and migration were first verified locally (unit, PostgREST integration, rehearsal database), then migrated, deployed and verified on UAT by hosted acceptance A–I and the regression set. Production is untouched.

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
  * **Commission** must be explicitly configured (`percentage`, 0 ≤ value ≤ 1). Absent, or any type other than `percentage` (e.g. a legacy "points" rate) → `422 COMMISSION_POLICY_MISSING`; a stored `percentage` value outside 0..1 → `422 COMMISSION_POLICY_NOT_REVIEWED`. The second case can only be a historical row: the D13A database guard (`merchant_details_fractional_rates_trg`) refuses to store such a value, so it cannot be seeded on UAT and is proven by `test:merchant-qr-flow` and the rehearsal database instead (the hosted spec proves the guard itself: a 150% write is refused with HTTP 400). **0 is allowed only when the policy itself says 0**; it is never defaulted.
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
| G inactive Partner / unauthorised actions denied | `G`; policy-missing answers, approved zero commission, out-of-range commission refused by the database, legacy type → explicit answer: `P` |
| H Merchant Profile fixes + audit controls intact; no assignment UI | `H` + spec `100-merchant-profile` M1–M7 |
| I regression: authorization, QR, commission arithmetic, idempotency, reporting | `I` + specs 00, 10-adjacent, 20, 30, 40, 95, 98, 99 |

Partner3 is only scanned (a scan row is written, as acceptance A/B/D require); it is never modified, assigned or given a transaction. Transactions are recorded for a **synthetic** unassigned Partner.

## 8. Open items / for awareness
1. **Partner "Members" page** (`/collaborator/dashboard/members`, API `/collaborators/members`) is a separate legacy team feature keyed on the historical `merchant_system_id` ("Collaborator is not assigned to a merchant team"). It is not part of QR, discount or transactions. **Decision (owner, 2026-11-09 evening): retire it from active navigation, preserving the historical association data** — implemented as its own change, see §10.2.
2. **QR authenticity:** the Partner QR contract is a code/URL (no cryptographic signature). "Authentic" therefore means: well-formed VNO payload, existing Partner, verified + active. Signing the QR would be a contract change; not done.
3. Most real Merchants have **no commercial policy**: of 16 active+verified Merchants on UAT, 14 have neither discount nor commission configured and 2 have both. Those 14 can scan Partners (walk-ins count) but get the explicit `COMMISSION_POLICY_MISSING` answer on payment until an Admin configures their commission. This is by design (nothing is invented) but is the main thing that will surprise testers.
4. Walk-in history before this release lives in `audit_events` (32 synthetic rows); not carried over.
5. Still open from earlier releases: real iPhone-in-Zalo QR validation; Partner3 activation-link click; `POST /transactions/:id/confirm|cancel|reverse` return 500 for a malformed id.

## 9. Deployment status and hosted evidence
**UAT only. Production untouched.** Deployed commit **`4763394c643c1f50674ee020bff98fd3b36e3611`** (pushed to `origin/codex/vno-phase-d4-security`, 2026-11-09).

### 9.1 Migration `20261109000001` (applied by the owner from the authorised host terminal; the agent sandbox cannot reach the database and did not try to bypass that)
* Applied with `migration/v2/apply-global-partner-network.mjs` (non-dry-run) at 2026-11-09T07:45–07:46Z (14:45 Vietnam time); project ref guard `hsezyogfxgnkpweoqqny`. Applied file sha256 `bfa3b88245a1d515904b592a1a4eaa11819d4c5710c4de121db6cc15474d6dd6` = the committed file at `4763394` (compared byte for byte).
* Backup taken before DDL: schema, current function definitions, financial tables, row counts + checksums (`migration/v2/evidence/global-network-apply-2026-11-09T07-45-14/`; kept local and **not committed** because `data-financial-before.sql` holds financial rows).
* `apply-evidence.json`: **17 / 17 postchecks passed, 0 failed**. The script writes this file only after the history registration has been read back, so `20261109000001` is registered in `supabase_migrations.schema_migrations`.
* Release gates, as evidenced: (1) registered ✔ · (2) 17/17 ✔ · (3) `partner_scan_events` RLS on, no `anon`/`authenticated` privilege (the migration text revokes **all** from `public, anon, authenticated`, grants only `service_role`); exactly one `create_real_transaction` (5 arguments), not executable by `anon`/`authenticated`, executable by `service_role`, no leftover 4-argument overload, no "not assigned" text in either function ✔ · (4) data intact — `referral_transactions` 154, `transaction_events` 93, `audit_events` 448, `collaborators` 381, `merchant_details` 173 unchanged; transactions checksum `4c8684ed…` and Partner-assignment checksum `07c90f54…` identical before/after ✔ · (5) migration file hash matches the committed file ✔.
* Limits of this evidence: the agent read the host run's evidence files and the migration text; it did not query the database itself. `create_uat_simulation_transaction` privileges were not asserted by a postcheck (`create or replace` keeps its existing grants).

### 9.2 Deployment (Railway project `vno-v2-uat`, environment `uat`; migration → API → Web)
| Service | Deployment | Status | `meta.commitHash` read back |
|---|---|---|---|
| API (`4fc48af8-…`) | `50fce891-7d9c-4677-9415-9ab473b130d2` | SUCCESS | `4763394c643c1f50674ee020bff98fd3b36e3611` |
| Web (`f23dacf5-…`) | `53f989a1-9fbf-4898-b6b6-01c1ea8aa4a5` | SUCCESS | `4763394c643c1f50674ee020bff98fd3b36e3611` |

Both re-read after all tests: unchanged. **Rollback:** application → re-stage both services to `5af1d86` (API `ee0a8062-8763-4171-99b6-cf1b8c8744c6`, Web `29fc4986-7585-4675-812e-c0a7f8f5e02b`); database → the rollback script in §4 (it refuses while any transaction references a scan; the 4-argument calls of `5af1d86` keep working against the new function, so the application can be rolled back first without touching the database).

### 9.3 Hosted results on the deployed `4763394`
| Run | Result |
|---|---|
| `tests/101-global-partner-network.spec.ts` (scenarios A–I) | **9 / 9 PASS** (final run). |
| `tests/100-merchant-profile.spec.ts` (Merchant Profile fixes, audit controls, M1–M7) | **7 / 7 PASS** |
| Regression `00-unauth, 20-regression, 30-operational, 40-experience, 95-onboarding-identity, 98-partner-single-step, 99-merchant-qr-scan` | **82 / 82 PASS**, 0 failed, 0 skipped |

* **First 101 run: 8 of 9 — step P failed, and the cause was the test, not the product.** P tried to *store* a 150% commission to reach `COMMISSION_POLICY_NOT_REVIEWED`; the pre-existing D13A database guard refused the write (HTTP 400) — correct behaviour. The spec was corrected (it now asserts that refusal, that the policy stays 0%, and that a legacy non-percentage commission type gets `COMMISSION_POLICY_MISSING`) and the **whole spec was re-run from scratch**; no application code changed between the two runs. `NOT_REVIEWED` for historical rows remains proven by `test:merchant-qr-flow` and the rehearsal database, not hosted.
* Acceptance map (§7): A Partner3 resolved at an unassigned Merchant (name + code, that Merchant's 5%, one walk-in, Partner3 row identical before/after) · B same Partner at a second active Merchant (own scan row, 3%) · C each Merchant its own discount; no policy → "Không có ưu đãi áp dụng"; legacy points never guessed · D five parallel detections of one scan = one walk-in, ledger / events / audit unchanged, invalid code not counted · E the payment step has one input (the invoice amount); discount 62,500 / final 1,187,500 / commission 125,000 on 1,250,000 shown from the server · F one confirmation → transaction for an **unassigned** Partner, linked to its scan, audited, idempotent replay, commission once · P commission missing → scan counts, 422 `COMMISSION_POLICY_MISSING` on preview and create, UI explains, nothing recorded; approved 0% → commission 0.0000; 150% cannot be stored · G inactive / unknown Partner refused; Partner, Admin, anonymous, outsider and unapproved Merchant denied; foreign scan → `SCAN_EVENT_MISMATCH` · H no assignment column / panel / form field; `/c/<code>` is global; no association audit row added · I reports scoped (Merchant own, Admin all = sum, Partner / anonymous none).
* **Partner3 `COL-986A45914FA0BF7E`:** only scanned (walk-in rows only). Row identical before/after in A and H; `merchant_system_id` still NULL; no transaction. The temporary second Merchant of each 101 run was removed (`removed: true`, no notes, for both runs `…143751` and `…144122`). Spec 101 recorded one confirmed transaction per run, only for the synthetic unassigned Partner `COL-87B72D3690FD0D1A` at the fixture Merchant (`VNO261109-A723C71975` from the first run, `VNO261109-38E9660298` from the second; 125,000 commission each). **These two synthetic transactions remain on UAT** — spec 101 does not reverse them (financial rows are append-only); an Admin can reverse them through the governed reversal if the fixture totals should be restored. Spec 99 reversed its own confirmed transactions (Q16).
* **Not run:** `10-onboarding.spec.ts` (consumes one-time unclaimed identities; its O03/O09 edits are type-checked only); the email / auth specs 50–90 and 96 (out of scope, no change to that code).

### 9.4 Status
* **Technical UAT PASS** — hosted acceptance A–I for the global Partner network on UAT at `4763394`, with the regression set green and nothing assigned, auto-assigned or modified.
* **Business UAT is OPEN.** This is an automated end-to-end verification. It is **not** a sign-off by the owner and **not** a real-device (iPhone-in-Zalo) check; both are required before Business UAT can close. Production is untouched and not part of this release.
* Failing tests that are unrelated and unchanged (§6): `test:d13a-contracts` (stale QR-payload assertion) and `test:email-delivery` (2 hook checks).
* Open: see §8 — in particular the 14 of 16 active Merchants without a commission policy (they can scan but payment answers `COMMISSION_POLICY_MISSING` until an Admin configures them) and the legacy Partner "Members" page.

## 10. Owner decisions after the technical PASS (2026-11-09, evening) and their status
**State: Technical UAT PASS · Business UAT OPEN (real-device QR testing + owner sign-off). Production untouched.**

### 10.1 Decisions that change nothing in the system (recorded so they are not undone by accident)
* **Commission rates for the 14 Merchants without a policy are NOT configured automatically.** They keep answering `COMMISSION_POLICY_MISSING` on payment until an authorised Admin sets a rate. Scanning and walk-in counting work for all of them.
* **The two synthetic transactions of spec 101 and their audit / ledger records are preserved** (`VNO261109-A723C71975`, `VNO261109-38E9660298`, synthetic Partner `COL-87B72D3690FD0D1A`) until an authorised reversal is performed through the governed Admin reversal. Nothing was or will be deleted.
* **Known, unrelated failures stay documented (§6):** `test:d13a-contracts` (stale QR-payload assertion) and `test:email-delivery` (2 hook checks), plus the archived `migration/v2/test-*.mjs` phase scripts that still assert the retired `association` field. Not fixed here; not hidden.
* **No further deploy for the evidence commit.** `ac7cc76` (docs + the corrected spec) is on `origin`; UAT keeps running `4763394`.

### 10.2 Retire the legacy Partner Members page from active navigation (separate change — NOT deployed)
* Removed the "Giới thiệu" entry from the Partner dashboard menu (`frontend/app/collaborator/dashboard/layout.tsx`). On mobile the bottom bar (first five entries) now shows all five remaining entries.
* `/collaborator/dashboard/members` now answers a **307 redirect** to `/collaborator/dashboard` (`redirects()` in `frontend/next.config.mjs`), so old links and bookmarks do not land on a screen that fails with "not assigned to a merchant team". The page file was removed (it could still create team members through `POST /collaborators/members` if someone typed the URL). Reverting the commit restores it.
* **Preserved:** `collaborators.merchant_system_id`, every historical association audit row, and the backend routes `GET/POST /collaborators/members` (spec 95 PC3 probes them as closed to a profile-less session). The Merchant "Members" page is a different feature and was not touched.
* **Verified locally only:** `tsc` clean, eslint 0 errors, `next build` passes, and on a locally started production build the old route returns `307 → /collaborator/dashboard`. Not deployed and not run on hosted UAT — it needs its own authorised deploy and a hosted check (Partner menu has no "Giới thiệu"; old URL lands on the dashboard).
* Follow-up for a later, separately scoped change: retire the `/collaborators/members` API routes (and the probe in spec 95) once the owner confirms nothing else uses them.

### 10.3 Read-only security check of `create_uat_simulation_transaction` (pending — to be run from the host terminal)
The migration postchecks asserted the privileges of `create_real_transaction` but not those of `create_uat_simulation_transaction` (rewritten by `create or replace`, which keeps the existing ACL; D13 granted EXECUTE to `service_role` only). Because the agent sandbox cannot reach the database, a read-only check was prepared for the owner to run:

    cd migration/v2 && PATH=/opt/homebrew/opt/libpq/bin:$PATH node check-function-privileges.mjs

* **Read-only by construction:** the session is opened with `default_transaction_read_only=on`, the SQL runs inside `begin read only … rollback`, and it only queries catalog functions. It writes one small evidence file (ACL metadata, no row data, no credentials) under `migration/v2/evidence/`, which stays uncommitted.
* **Checks (21):** for both transaction functions — exactly one overload, an explicit ACL (a NULL ACL would mean EXECUTE for PUBLIC), PUBLIC / `anon` / `authenticated` cannot execute, `service_role` can, no other grantee holds EXECUTE; owner / SECURITY INVOKER / `search_path` shown for review; `partner_scan_events` has RLS on and no table privilege for PUBLIC / `anon` / `authenticated`, `service_role` can select / insert / update / delete.
* **Validated on the disposable rehearsal database:** 21 / 21 PASS on the migrated schema; negative controls each detected — EXECUTE granted to `anon` (2 FAIL), to PUBLIC (4 FAIL), a table SELECT granted to `authenticated` (1 FAIL); restored → 21 / 21 again; a write attempted through the same session options is refused (`cannot execute CREATE TABLE in a read-only transaction`).
* **Result on UAT: NOT YET RUN.** §9.1 keeps its limit statement until the output is recorded here. A FAIL must be reviewed, never "fixed" automatically.

### 10.4 Review: does the legacy Members API still allow unintended team-member creation? (findings only — nothing removed in this release)
**Short answer: yes, at API level, for a small set of callers; there is no UI path for Partners any more, and no privilege escalation or financial effect.**

| Route | Who can call it | What it does |
|---|---|---|
| `POST /collaborators/members` | an **active Partner** whose own historical `merchant_system_id` is set (Admin, Merchant, anonymous, outsider, and Partners that were never assigned are refused: 403 / 401 / 400 "not assigned to a merchant team") | inserts one `collaborators` row |
| `POST /merchants/members` | any **active Merchant** (its Members page is still in the UI, unchanged) | inserts one `collaborators` row tagged with that Merchant |
| `GET /collaborators/members`, `GET /merchants/members` | same callers | list the Partners that share the caller's historical `merchant_system_id` (name, phone, e-mail, avatar) |

What a created member is: a `pending`, `verified = false` Partner application with no password, no Auth user and no `user_profiles` row. The DTO is `.strict()` (name, phone, e-mail, bank fields only) and the server overrides status, verified, password, code and registration date, so there is no mass assignment. **It cannot become an active Partner by itself:** approval refuses a record without a linked, matching Auth identity (`OWNER_NOT_CLAIMED`), and a profile can only be linked by Admin routes or an Admin-approved invitation.

Findings (none are exploitable for money or role escalation):
1. **Still reachable by direct API call.** On hosted UAT the paired fixture Partner answers `GET /collaborators/members` with 200, i.e. it carries a historical assignment, so assigned Partners can still POST. The number of such Partners on UAT was not counted (see the read-only query below).
2. **The historical assignment propagates.** Both routes stamp the new row with the creator's `merchant_system_id` — the opposite of the global-network rule, although nothing consults that column for QR, discounts or transactions.
3. **Third-party personal data is stored without that person's involvement** (name, phone, e-mail, bank name / account number) and the pending row shows up in the Admin pending list.
4. **No rate limit, no idempotency, no e-mail uniqueness on `collaborators`**: repeated POSTs create duplicate pending rows. `assertIdentityAvailable` only checks existing accounts, so the squatting risk is low but duplicates are possible.
5. **No automated test covers creation** — spec 95 PC3 only probes `GET` for a profile-less session, and the hosted spec 102 (N4) deliberately sends no POST.
6. The Merchant side (`POST /merchants/members`) is the more reachable one: its page is still in the UI.

Recommendation for a separately scoped change (needs an owner decision, not done here): answer `POST /collaborators/members` with a clear "feature retired" error (and decide the same for `POST /merchants/members`), add a regression test for it, and optionally review existing pending member rows with Admin. Keep `GET` and the data for history. Optional read-only counts for the owner (psql, host terminal):

    select count(*) filter (where collaborators_status = 'active'  and merchant_system_id is not null) as active_assigned_partners,
           count(*) filter (where collaborators_status = 'pending' and merchant_system_id is not null) as pending_assigned_rows
      from public.collaborators;
    select actor_role, count(*) from public.audit_events where action = 'collaborator.member_application_created' group by 1;

### 10.5 Deployment plan for the Members retirement (Web only) — gated
Gate: the 21 read-only privilege checks of §10.3 must pass (21 / 21) on UAT first; any FAIL stops the release and is reported as the exact gap. Then: deploy the **Web service only** pinned to a pushed SHA (API stays at `4763394`; no migration), read back the Web commit hash and re-read the API's, then run `tests/102-partner-members-retired.spec.ts` (N1–N4) plus `99`, `100`, `00`, `20`, `95`. Baseline on the not-yet-deployed Web (`4763394`): N3 and N4 PASS, N1 FAIL (3 Members links found) and N2 FAIL (old URL answers 200) — the expected negative controls. Production is untouched; synthetic transactions and Merchant commission policies are not touched.
