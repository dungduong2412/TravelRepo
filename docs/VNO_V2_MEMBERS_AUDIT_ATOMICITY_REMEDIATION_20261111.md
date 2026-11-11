# VNO V2 — Members audit-atomicity remediation, revision 3 (2026-11-11)

**Status: IMPLEMENTED AND VERIFIED LOCALLY ONLY. Not pushed, no migration applied, nothing deployed.** The live environment (Railway `vno-v2-uat` / Supabase `hsezyogfxgnkpweoqqny`) still runs release `a384f48` (API `77d16db1-7620-4ce6-a0af-9cc55a5a3675`, Web `b3d59b0c-7712-45e2-b38e-d3246328243a`); both rollback references are intact. The only contact with the live system was **GET-only reads** (§5, §6). **This is not "FULL SYNC".**

Workflow: Claude fixes → **Codex independently verifies** → Owner approves migration/deploy → Claude deploys → Codex verifies Production. This revision answers Codex's **NO-GO for `ecefe2c`** (two Medium findings, one Low finding in the replay verification). The transactional core accepted in the previous review is **unchanged** (§0, item 5).

| | |
|---|---|
| Production baseline (deployed) | `a384f48d072d903afdd97c52946f39b764444cb6` |
| Rejected candidates | `ecefe2c58a6ab2419a982b42aa38d2f17b7a5a19` (revision 2, NO-GO) · `757af5edacc0051cf41298efb6c94325b64c1d9f` (revision 1, NO-GO) |
| **Candidate — runtime code** | `e353f9e316cd237a2eca04f0863d53193fdb634e` (`e353f9e`) — 2 source files + 2 test scripts. **Migration, rollback script and privilege checker are byte-identical to `ecefe2c`** (`git diff ecefe2c HEAD -- supabase migration/v2/rollback migration/v2/check-member-function-privileges.sql` is empty) |
| Candidate — HEAD for review | **the commit that contains this document** (its SHA is in the hand-off message; `git log -1 --format=%H -- docs/VNO_V2_MEMBERS_AUDIT_ATOMICITY_REMEDIATION_20261111.md`). It adds only the extended read-only preflight tooling and documents on top of `e353f9e`: **no runtime change** (`git diff e353f9e HEAD -- backend supabase` is empty) |
| Schema change | **Yes — additive, ONE function (unchanged since `ecefe2c`), no table / column / index / constraint / data change.** Needs the owner's separate approval. |

## 0. Reviewer decision → what was done

| # | Required change (Rev3 brief) | Done | Where verified |
|---|---|---|---|
| 1 | Verify `actor_auth_user_id` of the original creation audit: a legitimate Merchant user of the application's Merchant; keep valid cross-actor replay inside one Merchant; reject forged roles and other Merchants' actors; consider historical role / Merchant changes | Replay verification is now **two pure stages** around one read-only profile lookup (§2.1): exactly one coherent creation event, **and** its actor is a Merchant profile bound to **this** Merchant that already existed when the event was written. The *requester* is not an input, so another user of the same Merchant may replay. Today's profile is used as a **necessary** consistency condition only — never as proof of creation-time authorization (§2.2) | FI-5c (14 forged shapes), FI-17 (cross-actor), FI-18 (historical changes); unit `selectCreationAudit` / `checkCreationActor`; mutants M1–M8, A1–A8, T18, T19 |
| 2 | Replay contract: verified ⇒ `201 idempotent_replay`; existing e-mail without a provable audit ⇒ generic `409 MEMBER_EMAIL_UNAVAILABLE`; lookup failure ⇒ `500 MEMBER_LOOKUP_FAILED`; log suspected anomalies with identifiers only | Implemented exactly so. `500 MEMBER_AUDIT_MISSING` is **retired**; every unprovable replay is byte-identical to any other conflict (asserted) and produces one `MEMBER_REPLAY_REFUSED reason=… application=… merchant=… requester=…` log line (ids only; asserted free of name / phone / e-mail) | FI-5, FI-5b, FI-5c, FI-5d, FI-6, FI-19, **FI-21 (regression, finding 2)**; mutants T11, T12 |
| 3 | Remove the unordered `.limit(20)`; deterministic, sufficiently selective audit query | The query is keyed by `(action, entity_type, entity_id)` (the shape of the existing index `audit_events_entity_idx`), ordered by `id`, and asks for **two** rows: the question is "is there exactly one?", so a second row is itself the answer and the verdict cannot depend on which rows a larger cut would return (§2.3) | FI-5d (insertion order never matters), FI-20 (40 unrelated events on the same application cannot hide the real one); mutants T13–T17 |
| 4 | Negative tests: wrong Merchant actor, forged Merchant role, Admin / Partner actor, null actor, multiple matching audits, external-origin records, cross-actor same-Merchant replay | All seven have controls, plus: actor without a profile, non-API `source`, profile newer than the event, moved / re-roled / deleted / re-created creator, failed profile lookup | §4.2 |
| 5 | Preserve the proven atomic-create transaction and fail-closed behaviour; do **not** restore automatic reconciliation | Function, grants, rollback and privilege checker are unchanged byte for byte; no write path other than `create_merchant_member_application` exists; reconciliation not restored | `git diff` above; FI-1 … FI-4, FI-9, FI-10, FI-12 … FI-15 unchanged and green; the integration suite asserts the API never writes an audit event for an application it did not create |
| 6 | Rerun the complete unit / integration / fault-injection / privilege / concurrency / rollback suites; regression tests proving **both Medium findings** are resolved | Rerun on a clean export of the code commit (§4.1). **Regression tests:** unit `REGRESSION (finding 1)` and integration FI-5c; integration **FI-21** (finding 2). The integration controls were also run against the rejected `ecefe2c` source, where they **fail**; the unit regression embeds the `ecefe2c` matcher verbatim and shows it accepting every forged shape (§4.5) | §4 |
| 7 | New exact SHA, documentation, explicit request for Codex GO / NO-GO | This document and the hand-off message | §9 |
| R | Release constraints: no push / migration / deploy / Production data change; keep the 3 duplicate groups and `COL-05C60E056C3D4B5B`; 30 remaining audit sites stay out; no QR / Payment changes; hosted catalog preflight before migration approval; never expose credentials | Nothing pushed, applied or deployed; data re-read GET-only (§5); 30 sites untouched (§8.1); `frontend/` and QR / Payment untouched; **hosted catalog preflight: UNRESOLVED BLOCKER** (needs the database password — §6); no credential requested or held | §5, §6, §8 |

## 1. The review findings and their root causes

**Finding 1 (Medium).** `hasMatchingCreationAudit` (revision 2) accepted an event when `action`, `entity_type`, `entity_id`, `actor_role = 'merchant'` and `details.merchant_id` matched. It never looked at `actor_auth_user_id`, `source` or the actor's profile. Every one of those five fields is *claimed text*: an event with a **null actor**, an **Admin or Partner user wearing the role `merchant`**, or a user of **another Merchant** passed. It also accepted "one good event among several". *Reproduced:* the unit test `REGRESSION (finding 1)` keeps the `ecefe2c` matcher verbatim and shows it returning `true` for each forged shape.

**Finding 2 (Medium).** An existing row with no verifiable creation audit answered `500 MEMBER_AUDIT_MISSING`. That is a distinct, cacheable-looking server error for what is a *conflict*; it told a caller something the generic 409 deliberately does not, and it turned an Admin-created row identical to a Merchant's submission (the contract before revision 2) into a 5xx.

**Low.** `.limit(20)` without an `ORDER BY` on the audit lookup: if more than twenty events matched, which twenty came back was arbitrary, and the valid one could be cut away.

## 2. Design (the part that changed)

### 2.1 Replay verification — `merchant-members.ts`, `merchants.service.ts`
An idempotent replay is "the same Merchant, still pending, same normalised details, and the e-mail is held by exactly one row". It is answered with success **only** after both stages pass:

| Stage | Input | Passes when | Refusal reasons (logged) |
|---|---|---|---|
| 1 `selectCreationAudit(events, application, merchant)` | the audit rows read for this application (re-filtered inside the function, so it does not rely on the query alone) | **exactly one** event with action `collaborator.member_application_created`, entity `collaborator`, entity id = this application; its `actor_role` is `merchant`; `details.merchant_id` is the requesting Merchant; `source` is `v2-admin-api` (the value every API-side audit writer stamps); `actor_auth_user_id` is a UUID; `occurred_at` is a valid time | `NO_CREATION_AUDIT` · `MULTIPLE_CREATION_AUDITS` · `AUDIT_ROLE_NOT_MERCHANT` · `AUDIT_MERCHANT_MISMATCH` · `AUDIT_SOURCE_UNEXPECTED` · `AUDIT_ACTOR_MISSING` · `AUDIT_TIME_INVALID` |
| — | one read-only `select user_id, role, merchant_id, created_at from user_profiles where user_id = <event actor>` | — | a failing lookup ⇒ `500 MEMBER_LOOKUP_FAILED` |
| 2 `checkCreationActor(event, profile, merchant)` | that profile row | the profile exists and is the actor's; `role = 'merchant'`; `merchant_id` is **this** Merchant; `created_at` is **not later than** the event's `occurred_at` | `ACTOR_PROFILE_MISSING` · `ACTOR_PROFILE_MISMATCH` · `ACTOR_NOT_A_MERCHANT_USER` · `ACTOR_BOUND_TO_OTHER_MERCHANT` · `ACTOR_PROFILE_POSTDATES_AUDIT` |

Also logged (no audit lookup at all): `EMAIL_HELD_BY_MULTIPLE_ROWS` — the caller's identical pending submission exists **and** another row holds the same e-mail (the duplicate-e-mail anomaly already present in production data).

The requester is deliberately **not** a parameter of either stage (asserted in the unit tests): what is verified is the *creator's* binding to the Merchant, so a colleague of the same Merchant can replay the creator's submission, and a user of another Merchant never gets that far (the row is not theirs, so they receive the ordinary conflict, without a log line).

### 2.2 What the actor check does — and does not — prove
There is no history table for profiles in the database (`user_profiles` has a current `merchant_id` / `role`, `created_at`, `updated_at`; nothing records who was bound to which Merchant *when*). Therefore **no profile-based check can prove authorization at a past instant**, and this design does not pretend otherwise:

* **The creation-time evidence is the event itself.** It is written in the same transaction as the application row, after that transaction has checked the actor's profile, Merchant and Merchant state, and by nothing else in the product (the same shape is written by the previous API after its own check, which is why events from a rolling-deploy window are accepted too).
* **Today's profile is a necessary condition, never a sufficient one.** It refuses a claim ("a Merchant user of M created this") that the user directory contradicts. The `created_at ≤ occurred_at` condition adds the one historical fact that *is* recorded: a profile that did not exist yet when the event was written cannot be the user who wrote it (a deleted-and-recreated profile, or a forged actor that joined later).
* **Conservative on change, never guessing.** If the creator has since been moved to another Merchant, made an Admin / Partner, deleted or re-created, the replay is refused (generic 409 + log line) and a human decides. Status alone (`inactive`) is *not* creation-time evidence and neither proves nor disproves anything, so a deactivated-but-still-bound creator does not block the replay.

| What happened to the creator after the application was created | Replay by a colleague of the same Merchant | Reason logged |
|---|---|---|
| nothing | `201 idempotent_replay` | — |
| deactivated, still bound to the Merchant | `201 idempotent_replay` | — |
| moved to another Merchant | `409` | `ACTOR_BOUND_TO_OTHER_MERCHANT` |
| became an Admin / Partner | `409` | `ACTOR_NOT_A_MERCHANT_USER` |
| profile deleted | `409` | `ACTOR_PROFILE_MISSING` |
| profile deleted and re-created | `409` | `ACTOR_PROFILE_POSTDATES_AUDIT` |
| moved away and back (binding is as at creation again) | `201 idempotent_replay` | — |

**Residual, stated plainly.** A forged event that names a user who *today* belongs to the same Merchant, whose profile pre-dates the forged event's timestamp, is indistinguishable from a real one by any check on these tables. Forging it needs `service_role` write access to `audit_events` — the same trust level as the API itself — so it is outside what this control defends. What it defends against is the *internally inconsistent* and *foreign* shapes the review listed, and accidents (a code path writing the wrong actor).

### 2.3 The audit query
```
audit_events: select id, occurred_at, actor_auth_user_id, actor_role, action, entity_type, entity_id, source, details
  where action = 'collaborator.member_application_created' and entity_type = 'collaborator' and entity_id = <application>
  order by id asc limit 2
```
* *Selective:* `(entity_type, entity_id, …)` is the existing index `audit_events_entity_idx`; the result is the events of **this application only** (normally one row).
* *Deterministic:* two rows are requested because the only question is "exactly one?". With two or more rows the answer is "no" whichever two come back; with one row it is that row. `ORDER BY id` additionally makes the log and any investigation reproducible. The previous `limit(20)` could cut away the valid event; this cannot (mutants T14 — unordered — is *equivalent by design* and T13 / T15 / T16 / T17 are caught).
* *Several events for one application is an integrity anomaly* and is refused whatever they say (valid + valid, valid + forged, forged + valid, 25 events). A forged extra event can therefore make a genuine replay fail closed (a 409, never a success) — accepted, because the alternative is to guess which event is "the real one".

### 2.4 The contract after revision 3
| Situation | Answer |
|---|---|
| New e-mail | `rpc('create_merchant_member_application')`; `CREATED` ⇒ `201`, `idempotent_replay:false` (unchanged) |
| Same submission again, creation audit **verified** (both stages) | **`201`, `idempotent_replay:true`**, same id; the API writes nothing |
| E-mail held by anything else, or by the caller's own identical submission that **cannot be proven** | **generic `409 MEMBER_EMAIL_UNAVAILABLE`** (only `code` + `message`; byte-identical to every other conflict); one log line `MEMBER_REPLAY_REFUSED reason=… application=<id> merchant=<id> requester=<id> [auditEvent=<id> auditActor=<id>]`; nothing written |
| An audit or profile lookup fails | `500 MEMBER_LOOKUP_FAILED` (Vietnamese message, no internals) — never read as "verified" |
| Function missing / not executable / unexpected answer | `500 MEMBER_CREATE_FAILED`, nothing persisted (unchanged) |
| Replay when the function is missing | still works (it only reads) |

### 2.5 Consequences worth knowing
1. **Rolling deploy.** The previous API can still create a row and write its audit a moment later. A replay in that window gets the generic 409 (and a log line that is then a false positive); once the creator's own event exists the next replay succeeds. No grace period, no guessing.
2. **Admin-created pending row identical to a Merchant's submission** (same Merchant, same details): generic 409 — as it was before revision 2 (FI-5b).
3. **A creator who has been moved / removed:** replays of that creator's applications by colleagues are refused until a human decides (§2.2). This is rare and the failure is a 409, not a wrong success.
4. **Monitoring.** The old token `MEMBER_AUDIT_MISSING` is gone; search for `MEMBER_REPLAY_REFUSED`. `migration/v2/analyze-member-audit-gaps.mjs` (GET-only) still lists applications that have no creation event.
5. A row left by the previous API's partial write stays refused **until a human decides** (nothing repairs it). Production has none (§5).

## 3. Migration impact and rollback assessment (unchanged from revision 2)

**Impact.** One `CREATE OR REPLACE FUNCTION` and its grants in one short transaction. No table, column, index, constraint, policy, trigger or row is created, altered or removed; no table lock; milliseconds.

| Database | API | Result |
|---|---|---|
| without the function | `a384f48` (old) | works as today |
| with the function | `a384f48` (old) | works as today — the old code never calls it |
| with the function | candidate | atomic path |
| without the function | candidate | **create fails closed** (500 `MEMBER_CREATE_FAILED`, nothing written); replays of audited applications still work (FI-12) |

**Order:** catalog preflight → migration → `--members` check → API. **Rollback:** re-stage the API to `a384f48` **first**, then `migration/v2/rollback/20261111000001_vno_merchant_member_atomic_create_rollback.sql` (drops the one function; touches no data). Application-only rollback is sufficient by itself and leaves the function harmlessly in place. The real rollback script is executed in FI-12 (row / audit counts unchanged; create fails closed; re-apply restores; applying twice is harmless).

**Proposed apply runbook (owner's host terminal — NOT executed):**
1. `node migration/v2/preflight-members-catalog.mjs` (procedure document) ⇒ **all gates PASS** (57 on the rehearsal); keep the two digest lines.
2. Apply the single file (it carries its own `begin … commit`): `psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261111000001_vno_merchant_member_atomic_create.sql`. **Never `supabase db push`.**
3. Register: `insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261111000001','vno_merchant_member_atomic_create', array['…applied by owner, sha256 …'])`.
4. `node migration/v2/check-function-privileges.mjs --members` ⇒ expect **11 passed, 0 failed** (read-only).
5. Write-free smoke test **inside `begin read only; … rollback;`**: `select public.create_merchant_member_application(gen_random_uuid(), gen_random_uuid(), 'X','n','p','e@x.vn');` ⇒ `{"outcome":"NOT_ALLOWED"}` (an unknown actor is refused before any write).
6. Preflight again: only the expected differences (§5 of the procedure document).

**Residual risk.** The function body has run against a faithful rehearsal (Postgres 17 + PostgREST v14.5, every repo migration) but never on the hosted database; the hosted catalog preflight exists to close that gap and is the open blocker (§6). The API's new **reads** (`user_profiles.created_at`, `audit_events.occurred_at / id / source`) are now also covered by the preflight gates. The first real Merchant creation will be the first hosted execution of the insert path; it fails closed.

## 4. Local test evidence

Everything below ran on a **clean `git archive` export of the code commit** `e353f9e` with a **freshly rebuilt** rehearsal stack (disposable Postgres 17 + PostgREST v14.5, loopback only; the integration test refuses any non-loopback target). Logs: `migration/v2/evidence/members-audit-atomicity-20261111-rev3/` (uncommitted, like earlier evidence).

### 4.1 Results
| Check | Result |
|---|---|
| `tsc --noEmit`, `npm run build` (the Dockerfile step), `eslint` on the two changed source files | clean |
| Unit `test:merchant-members` | **38 / 38 PASS** (revision 2: 34) |
| **Integration `test:rehearsal-merchant-members`** | **42 / 42 PASS**, 3 consecutive runs on the export (revision 2: 36) |
| Other backend scripts | `d6-contracts` 28 · `invitation-guards` 3 · `merchant-profile-update` 10 · `merchant-qr-flow` 23 · `partner-single-step` 29 · `approve-unclaimed` 7 · `main-media` 13 · `public-catalog` 14 · `anonymous-privacy` 3 · `auth-email-hook` 15 · `media-lifecycle` PASS |
| `test:rehearsal-global-network` (same database) | 9 / 9 PASS |
| `check-function-privileges.mjs --rehearsal --members` | **11 passed, 0 failed** (§4.3) |
| Known failures that are **not** caused by this change | `test:d13a-contracts` and `test:email-delivery` (37 passed, 2 failed) fail identically on the deployed baseline `a384f48` (re-verified in this revision, §4.5); unchanged, not hidden |
| `frontend/` | not touched (`MEMBER_AUDIT_MISSING` was never referenced there) |

### 4.2 The adversarial controls
| Scenario (Rev3 brief item 4, plus the earlier eight) | Controls | Proves |
|---|---|---|
| **Wrong Merchant actor** | FI-5c (actor = a user of Merchant B, role `merchant`, details name Merchant A) · FI-18 (creator moved to B) · unit | `409`, `ACTOR_BOUND_TO_OTHER_MERCHANT`, nothing written; moved back ⇒ `201` again |
| **Forged Merchant role** | FI-5c: role `admin` / `collaborator` on the event ⇒ `AUDIT_ROLE_NOT_MERCHANT`; an Admin user / a Partner user *wearing* the role `merchant` ⇒ `ACTOR_NOT_A_MERCHANT_USER` | refused each time |
| **Admin / Partner actor** | FI-5c (above) · FI-18 (creator made an Admin) · FI-6 (a forged *late* write by an Admin actor never unlocks a replay) | refused |
| **Null actor** | FI-5c (`actor_auth_user_id` null) ⇒ `AUDIT_ACTOR_MISSING`; an actor that exists in Auth but has no profile ⇒ `ACTOR_PROFILE_MISSING` | refused |
| **Multiple matching audits** | **FI-5d**: valid + valid · valid + forged · forged + valid · 25 events with the valid one in the middle ⇒ `MULTIPLE_CREATION_AUDITS`, insertion order irrelevant; with only the valid event left the replay succeeds | refused; verdict follows the evidence |
| **External-origin records** | FI-5, FI-5b, FI-5c: API-shaped code `COL`+7 hex, pending, same Merchant, same details, but: no event · an Admin `collaborator.created` event · the removed reconciliation action · another Merchant in the details · no Merchant in the details · a **non-API `source`** · a profile that **post-dates** the event · *another application's* valid event ⇒ all refused; the neighbour with its own valid event succeeds | refused, nothing written |
| **Cross-actor same-Merchant replay** | **FI-17**: Merchant A's user A replays user A2's creation and vice versa ⇒ `201 idempotent_replay`, no event written; a user of Merchant B gets the ordinary conflict *without* a log line | accepted / ordinary conflict |
| **Historical changes** | **FI-18**: moved · made Admin · profile deleted · profile re-created later ⇒ refused with the specific reason; deactivated-but-bound ⇒ accepted; restoring the binding / original creation time ⇒ accepted again | §2.2 |
| **Lookup failures** | FI-16 (audit `SELECT` revoked) · **FI-19** (the actor-profile lookup returns a database error, injected below the service) · FI-21 | `500 MEMBER_LOOKUP_FAILED`, Vietnamese message, no internals, nothing written, never a success; recovers |
| **Query selectivity / determinism** | **FI-20**: 40 unrelated events on the same application, written before or after the creation event ⇒ replay still succeeds | the old `limit(20)` class of defect cannot recur |
| **Regression, finding 1** | unit `REGRESSION (finding 1)` (old matcher accepts 7 forged shapes, new check refuses each with its reason) · FI-5c | fails on `ecefe2c` (§4.5) |
| **Regression, finding 2** | **FI-21** (verified ⇒ 201; unprovable ⇒ the generic 409, never a 500, never `MEMBER_AUDIT_MISSING`; failed lookup ⇒ 500 `MEMBER_LOOKUP_FAILED`) | fails on `ecefe2c` (§4.5) |
| **Audit insertion failure and atomic rollback** | FI-1 · FI-1b · FI-2 · FI-14 | unchanged and green |
| **Concurrent identical creation requests** | section-3 control (8 parallel) · FI-2 · **FI-3 (3 API instances × 15 calls: exactly +1 row, +1 event)** · FI-4 · race controls · **FI-13 (lock contract)** | unchanged and green |
| **Idempotent replay with a valid audit** | section-3 replay · FI-8 (rows **and** events identical before / after) · race control (b) | unchanged and green |
| **An attempted late audit write** | FI-6: refused while no event exists (nothing written) · the create function cannot back-fill (`EMAIL_HELD`) · only the creator's own late write unlocks the next replay · **a forged late write does not** | *Interpretation, stated so Codex can correct it:* "late audit write" = an audit event arriving after the row is committed, whether from the creator or from the system trying to repair it |
| **Function unavailable** | FI-15 (EXECUTE revoked) · FI-12 (function dropped by the real rollback script) | create ⇒ generic 500 `MEMBER_CREATE_FAILED`, nothing written; replays of audited applications still work |
| **Migration rollback and re-application** | FI-12 | unchanged and green; applying twice is harmless |

Also kept: FI-9 (the function's own guards, each half of "active and verified"), FI-10 (anon / authenticated get `42501`; catalog ACL), FI-11 (invariants after everything), plus the retired Partner route (410), validation, limits, authorization, privacy, isolation. Fault injection is a trigger / privilege change / client wrapper that exists only while a control runs. Counts are scoped to the run's own random Merchants.

### 4.3 Privilege checker (recalculated for revision 3)
The function, its grants and the checker are unchanged, so the recalculation gives the same figures; they were **re-derived, not carried over**: `migration/v2/check-member-function-privileges.sql` + `check-function-privileges.mjs --members` = 9 assertions + 1 "no other `*merchant_member*` function" assertion + 1 informational owner row = **11 rows; `SUMMARY 11 passed, 0 failed`** on the fresh export. Seven negative controls each fail the right assertion and the restored state is 11 / 11 (`02-privilege-checker-negative-controls.log`).

### 4.4 Planted regressions (mutation testing)
Each regression is planted alone — SQL in the disposable rehearsal database (restored by re-applying the migration), TypeScript in a scratch copy — the integration suite is run, the original restored. A mutant that does not compile or that Postgres rejects counts as *bad*, not as caught. Rerun in full for this revision (the SQL set also covers the new coupling between the function's audit row and the verifier: S19 null actor, S20 other source).

| Group | Planted regressions | Result |
|---|---|---|
| **SQL, the unchanged function** (S1–S18) | audit insert removed · audit failure swallowed · advisory lock removed / per-call key · e-mail re-check removed · actor / Merchant guard removed · *Merchant-verified* half dropped · `EXECUTE` to `anon` · `SECURITY DEFINER` · `search_path` unpinned · insert not `STRICT` · name in the audit details · role `admin` / no `merchant_id` / `entity_id` = code in the audit row · e-mail not normalised · application created `active` / `verified` | all caught (as in revision 2; S7 stays caught by FI-9's per-half controls) |
| **SQL, new coupling with the verifier** (S19, S20) | audit row written with a **NULL actor** · with **another `source`** — the function would then write events its own API refuses | caught: the "audit row" control · the first replay control |
| **Replay path in the service** (T1, T5–T9, T11–T13, T15, T16, T18, T19) | replay answered without checking the audit · "provenance by code shape" (`COL`+7 hex skips verification) · audit-lookup error read as success · **actor-profile lookup error read as success** · the API back-fills the missing audit · refused replay not logged · create reports success when the function fails · refusal answers the retired `500 MEMBER_AUDIT_MISSING` / an actor refusal answers 500 · query asks for ONE row · query without the `entity_id` / `action` filter · profile looked up by the *requester* · actor stage skipped | all caught: race control (c) · FI-16 · **FI-19** · FI-5 · FI-1 · **FI-5c** · **FI-5d** · section-3 replay · **FI-20** |
| **Verdict-equivalent by design** (T14, T17) | query not ordered · `limit(20)` unordered (the rejected candidate's query) | **not caught, and not a gap:** with the *exactly-one* rule the verdict cannot depend on which rows a larger or unordered cut returns (two or more rows ⇒ refused whichever come back). They are recorded to show that the Low finding's defect class is removed by the rule, not by tuning |
| **The two pure functions** (T20, M1–M8, A1–A8) | several events tolerated · stage 1 ignores `details.merchant_id` / `actor_role` / `source` / actor id / event time / re-filter by `entity_id` / re-filter by `action` / accepts the removed reconciliation action · stage 2 accepts a missing profile / ignores role / ignores the Merchant binding / ignores the profile's creation time / skips the profile-vs-actor comparison / accepts an unreadable creation time / flips the time comparison / additionally demands `active` | **all caught by the unit tests.** With the unit tests switched off, the **integration suite alone** catches 12 of these 17 (T20, M1–M4, A1–A4, A6–A8: FI-5c, FI-5d, FI-18, the replay controls). The other five are second layers behind a filter that the service already applies — M6 / M7 / M8 (the query filters by entity and action) and A5 (the lookup filters by actor) — or unreachable through the database (M5: `occurred_at` is `timestamptz NOT NULL`, so an unparseable event time cannot be produced) |
| **Two-layer** (B1–B4) | `entity_id` ignored in **both** the query and stage 1 · `action` ignored in both (any event of the application counts) · profile looked up by the requester **and** not compared with the actor · single-event rule **and** row limit removed | **all caught by the integration suite alone** (replay controls · FI-5c · FI-5d) |

**57 planted regressions: 55 caught, 2 verdict-equivalent by design (T14, T17), 0 missed, 0 bad mutants.** (53 in the main matrix — SQL S1–S20, TypeScript T / M / A — plus the four two-layer mutants.) Log: `06-mutation-matrix.log`.

### 4.5 Reproduction on the earlier sources
The **new integration suite** (42 controls) was run with `VNO_CONTINUE_ON_FAIL=1` against the application code of two earlier commits (the database already has the function; neither earlier code path can be hurt by that).

| Control of the new suite | `ecefe2c` (rejected) | `a384f48` (deployed) |
|---|---|---|
| Result | **32 PASS, 10 FAIL** | **24 PASS, 18 FAIL** |
| Replay of an application with no creation audit (FI-5, FI-5b, FI-6, race control (c), FI-21) | `500 MEMBER_AUDIT_MISSING` — **finding 2** | answered `201 idempotent_replay` with no check (the original defect) |
| Forged / foreign creation events (FI-5c) | **accepted** as `201 idempotent_replay` — null actor, Admin / Partner user wearing the role `merchant`, an actor of another Merchant, an actor with no profile, a non-API source, a profile newer than the event — **finding 1** | accepted |
| Several creation events (FI-5d) | **accepted** (first / any matching one wins) | accepted |
| Moved / re-roled / deleted / re-created creator (FI-18) | **accepted** — today's profile never consulted | accepted |
| Actor-profile lookup fails (FI-19) | no such lookup: replay succeeds | no such lookup |
| Audit failure leaves the row (FI-1, FI-1b, FI-2, FI-3), lock not honoured (FI-13), no function-unavailable behaviour (FI-12, FI-15, FI-16) | pass (the atomic create is intact) | fail — the original defect and the *design* difference that the candidate fails closed |
| FI-11 (invariants) | fails by cascade: FI-5d's surplus events were never cleaned up because that control failed first | fails by cascade |

The side-by-side probe makes finding 1 and finding 2 concrete: the **same 35 requests** (the applications and planted events of the new suite) were sent to both builds and only the HTTP answer recorded. **`ecefe2c`: 17 × `201 idempotent_replay` (every forged / multiple / moved-creator case) and 18 × `500 MEMBER_AUDIT_MISSING`; candidate: 35 × `409`, none accepted** (`07d-finding1-and-2-probe-ecefe2c-vs-candidate.log`). Logs: `07a` (`ecefe2c`), `07b` (`a384f48`).

**The two failures that are not caused by this change** (`test:d13a-contracts` — `QR payload remains collaborator code only`; `test:email-delivery` — 37 passed, 2 failed: the signup-confirmation and password-recovery hook messages) were re-run on an export of `a384f48` and of the candidate, both with `frontend/lib` present: **identical on both** (`07c`).

## 5. Existing production data — read-only (GET-only), unchanged
Re-run at **2026-11-11T16:35Z** with `analyze-member-audit-gaps.mjs` (GET-only by construction, pinned to the live host, reads no name / phone / bank field, hashes e-mails in memory). Evidence: `…-rev3/hosted-data-analysis/summary.json` (identifiers and counts only; contains no `@`).

| Question | Result |
|---|---|
| `collaborators` rows | **384** (unchanged since the first analysis); 4 carry a `merchant_system_id` |
| Any application created through the Members API? | **No.** 0 rows with the code shape; **0** `collaborator.member_application_created` events; no reconciliation events exist or ever did |
| Applications needing repair | **0** |
| Orphan audit events / entities with > 1 creation event | 0 / 0 |
| Duplicate e-mails (case-insensitive) | **3 groups of 2 rows** — preserved, untouched |
| `COL-05C60E056C3D4B5B` | **present and unchanged** (pending, unverified, tagged to a Merchant, no login, no audit event; same e-mail as an active Partner). Still awaiting an owner decision; **nothing was changed; no unique index is introduced in this revision** |
| New for revision 3 — Merchant profiles (the actor check reads `user_profiles.created_at`) | **156** Merchant profiles; **none** has a null / unreadable / future `created_at` (earliest 2026-09-13, latest 2026-11-08), **all** are bound to a Merchant (154 active, 2 pending): the actor check cannot refuse a legitimate creator for lack of data |

## 6. Production database preflight

**Prepared and extended.** `migration/v2/preflight-members-catalog.sql` + `.mjs` check, against the **hosted** catalog: columns and types, bounded-`varchar` lengths, NOT NULL columns without a default, constraints (CHECK / UNIQUE / FK), indexes, triggers, RLS and policies, privileges and role attributes, existing functions (name clash, advisory-lock namespace), event triggers, default privileges, extensions, the migration history, plus aggregates and before / after digests. **Revision 3 adds three gates** for what the API now *reads* (`audit_events.id` bigint, `audit_events.occurred_at` timestamptz, `user_profiles.created_at` timestamptz) and one informational row (an index leading with `(entity_type, entity_id)` — the access path of the replay lookup). Read-only session, no credentials in output or evidence, no row data. Procedure, interpretation table, expected values and tool hashes: `docs/VNO_V2_MEMBERS_HOSTED_CATALOG_PREFLIGHT_PROCEDURE_20261111.md`. **I did not ask for, and do not hold, any database credential.**

**Tested locally:** **57 gates PASS** on a faithful pre-apply state (the three new gates raise the count from 54); **14 negative controls each trip exactly the intended gate(s)** — unique e-mail index, CHECK on `action`, BEFORE INSERT trigger, an unwritten NOT NULL column, a too-short `varchar`, a revoked privilege, a leftover reconcile function, an already-applied function (3 related gates), wrong migration history (3 related gates), a lock-prefix clash, a missing column, and — new — `user_profiles.created_at` renamed, `audit_events.occurred_at` renamed, `user_profiles.created_at` of the wrong type; with the entity index dropped the new INFO row says `NONE` and no gate fails; restored state 57 / 57 (`04-catalog-preflight-rehearsal.log`). *Incidental proof the gates bite:* a first run on a database polluted by the mutation testing (broken mutants had really inserted two rows with the same code) failed `no duplicate collaborators_code`; on a freshly rebuilt database the same run is 57 / 57.

**Hosted result — partially resolved, with an explicit blocker.**
* **Resolved without a password** (GET-only `migration/v2/rest-schema-probe.mjs`, one OpenAPI request, no table read; evidence `…-rev3/hosted-rest-schema-probe/`): **36 PASS, 0 FAIL, 1 UNRESOLVED.** The four tables are exposed; every column the function writes **or the API reads** exists with the right type family and enough room (including the new `user_profiles.created_at`, `audit_events.occurred_at`, `audit_events.id`); `collaborators` has no NOT NULL column without a default that the function omits; `create_merchant_member_application` is **not** callable yet; no other `*merchant_member*` function is.
* **UNRESOLVED:** `audit_events.id` (bigint NOT NULL, no default visible over REST — what an identity column looks like).
* **BLOCKER:** constraints, indexes, triggers, RLS / policies, privileges, role attributes, event triggers and the migration history are **not visible over REST**. They stay unresolved until the owner (or a delegate holding the VNO database credentials) runs the catalog preflight at a host terminal. **The schema change must not be applied before that, and approval of the migration should not be requested as final until it has run.**

## 7. Assessment for the following release (not part of this revision)

### 7.1 Database uniqueness constraint on the e-mail — acknowledged limitation preserved
* **What exists now:** the function serialises concurrent *calls of itself* per e-mail across instances (FI-13). It does **not** stop a writer that takes no lock — the previous API during a rolling deploy, Partner registration, Admin create. Practical exposure today is nil (no Members creation has ever been recorded). The "exactly one creation event" rule (§2.3) fails closed if such a race ever produced two applications' worth of confusion; it does not repair it.
* **A full `unique (lower(collaborators_email))` cannot be created today** — the 3 duplicate groups block it. A pending-only partial index would not cover the dangerous case (a pending row duplicating an **active** Partner's e-mail — exactly `COL-05C60E056C3D4B5B`). **Not introduced in this revision, as instructed.**
* **Recommendation: prepare for the following release** — owner decisions per duplicate group through the governed Admin flow, `create unique index concurrently` as its own controlled step, a `unique_violation` handler mapping to `EMAIL_HELD`.

### 7.2 Durable throttling
Per-Merchant limits are in process memory and the pending cap (50) is counted in the database but **not atomic with the insert**. Best option: count `created` audit events per Merchant **inside the create function under a per-Merchant advisory lock**. **Recommendation: design it with 7.1; keep the current values until real usage exists.**

## 8. Observations outside this scope (not changed)
1. **Audit call sites — 30 remain** (`audit.record(` had 31 at the deployed baseline `a384f48`; the Members create no longer is one): merchants 8, collaborators 9, invitations 5, media 3, user-profiles 2, partner-registration 1, auth 1, activation 1. They keep the "write, then audit in a second call" pattern and stay **outside this release**; a prioritised inventory is recommended. (Re-counted for this revision with `git grep -c 'audit\.record(' -- backend/src`: 31 at `a384f48`, 30 at the candidate; the number is unchanged by revision 3.)
2. The pending cap and the rate limits are not atomic with the insert (§7.2).
3. Pre-existing, not caused by this change: Partner registration and Admin create de-duplicate e-mail with no lock and no unique index (Admin create also stores it un-normalised); the Partner code is 28 bits of randomness with no uniqueness check; a Merchant can pre-claim any e-mail with a pending row (mitigated by the generic 409 and the rate limits).
4. The `23505` code-collision retry is unchanged and still not exercised by a test (the rehearsal schema has no unique index on the code).

## 9. Independent review

### 9.1 Hand-off brief for Codex
Review `HEAD` (runtime code `e353f9e`) against `ecefe2c` (rejected), `757af5e` (rejected) and `a384f48` (deployed):
`git diff ecefe2c HEAD -- backend supabase migration/v2` · `git diff a384f48 HEAD -- backend/src supabase`. Reproduce from a clean export (do not rely on this document):
```
git archive <HEAD> | tar -x -C /tmp/cand && cd /tmp/cand
(cd backend && npm ci && npm run build && npx tsc --noEmit && npx eslint src/modules/merchants)
bash migration/v2/rehearsal/start-rehearsal-stack.sh                                   # disposable Postgres 17 + PostgREST v14.5, loopback only
(cd backend && npm run test:merchant-members)                                          # unit: 38
(cd backend && npm run test:rehearsal-merchant-members)                                # integration: 42
PATH=/opt/homebrew/opt/libpq/bin:$PATH node migration/v2/check-function-privileges.mjs --rehearsal --members     # 11 passed, 0 failed
PATH=/opt/homebrew/opt/libpq/bin:$PATH node migration/v2/preflight-members-catalog.mjs --rehearsal                # 57 gates, 0 failed (pre-apply state)
```
**Where I would push hardest**
1. *Is the actor check sufficient for "historical role / Merchant changes"?* §2.2 argues that no profile-based check can prove a past instant, that the event is the creation-time evidence, and that today's profile is used as a necessary condition only; that conservative refusals (moved / re-roled / deleted / re-created creator) are acceptable; and that a deactivated-but-bound creator is accepted. Challenge each of those three choices, and the `created_at ≤ occurred_at` condition.
2. *"Exactly one" creation event.* Refusing several events means a forged extra event can turn a genuine replay into a 409 (fail closed). Is that the right side to err on?
3. *409 for every unprovable replay.* The caller can no longer distinguish "cannot be proven" from any other conflict; the signal moved to a log line. Is a log line enough for monitoring, and is the rolling-deploy false positive (§2.5-1) acceptable?
4. *Hosted vs rehearsal:* everything §6 lists as unresolved, and the three new reads.
5. *Could the new tests pass vacuously?* Mutation matrix (§4.4), the old-matcher regression in the unit test, the client wrapper used for the profile-lookup failure (FI-19).
6. *Interpretation of "an attempted late audit write"* (§4.2).

### 9.2 Earlier reviews (superseded where noted)
Codex's NO-GO for `757af5e` (reconciliation complexity) is resolved in `ecefe2c`; Codex's NO-GO for `ecefe2c` is this revision. The earlier supplemental review by a fresh-context Claude agent on `4496840` found a false "audit missing" reconciliation event (gone with the function), an in-flight 2xx without an audit trail (gone), the lock-free-writer gap (kept, §7.1), an orphan audit event when an insert yields no row (fixed, `STRICT`, FI-14), weak function-level validation (fixed) and cap / limiter placement (documented). It was a supplement, not a substitute for Codex.

## 10. Proposed release (for the owner's decision — NOT authorised, NOT executed)
1. Codex review with no open High / Medium finding.
2. **The hosted catalog preflight is run (§6) and every gate is PASS.**
3. Owner approves **(a)** the schema change and **(b)** push + deploy of the candidate HEAD.
4. Owner applies the migration per §3; `--members` = 11 / 11; read-only smoke test; preflight digests.
5. Claude pins **API only** (the Web is unchanged), verifies SUCCESS, `/health` 200, exact `meta.commitHash`; runs the **write-safe** hosted checks only.
6. *Only if the owner confirms it for this release:* the controlled Production business test the owner has previously authorized — **one** Merchant-member creation, with an owner-designated Merchant and e-mail alias. Expected: `201`, exactly **one** `collaborators` row and **one** creation event whose actor is that Merchant's user; a repeat returns `201 idempotent_replay:true` with no second row or event; a repeat by a *second* user of the same Merchant (if the owner supplies one) likewise. No deletion afterwards (an Admin rejects the application through the governed flow).
7. Codex verifies Production. Rollback: re-stage the API to `a384f48` (`77d16db1…`); the function may stay.

## 11. Recommendation — three separate decisions (none is an approval)

### 11.1 This remediation (one function + API) — **GO, conditional**
*Why:* the defect is reproduced on the deployed code and removed by a transaction; replay now requires evidence that is both present and coherent with the user directory, and degrades to the ordinary conflict — not a wrong success — whenever it is not; 42 integration controls (fault injection, three-instance races, a lock contract, replay verification with forged / foreign / moved actors, an unavailable function, a rollback drill) pass three times on a clean export; the planted-regression matrix is in §4.4; the change is additive and reversible without data loss; *production has never recorded a Members creation* (§5), so nobody is affected while it is scheduled.
*Conditions (all must hold):* (1) Codex's independent review has no open High / Medium finding; (2) the **hosted catalog preflight is run and every gate is PASS** — currently an open blocker; (3) the owner approves the schema change and the push + deploy; (4) after applying: `--members` = **11 / 11** and the read-only smoke test returns `NOT_ALLOWED` — before the API is deployed.
*Residuals the owner accepts by approving:* (a) lock-free writers can still create a duplicate e-mail until the unique index of 11.2 exists; (b) the first real creation is the first hosted execution of the insert path; (c) the rolling-deploy false positive and the conservative refusal after a creator's profile changed (§2.5); (d) the forged-event residual of §2.2 (needs `service_role` write access); (e) the guards listed in §8.
*Urgency:* low to moderate — a latent defect in a feature nobody has used; it is not an incident.

### 11.2 Database uniqueness constraint — **NO-GO to apply now; GO to prepare**
### 11.3 Durable throttling — **GO to design and bundle with 11.2; not needed for 11.1**

### Decisions the owner will need to make
1. Approve (or not) the schema change and release of §10 — after Codex's review **and** the hosted catalog preflight.
2. Who runs the hosted catalog preflight (§6) and when.
3. What to do with `COL-05C60E056C3D4B5B` and the three duplicate-e-mail groups (needed for 11.2, not for 11.1).
4. Whether to include the controlled single Merchant-member creation of §10-6 in this release.
5. Whether to commission the inventory of the 30 remaining write-then-audit call sites.
