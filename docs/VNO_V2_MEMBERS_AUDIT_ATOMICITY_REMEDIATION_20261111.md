# VNO V2 — Members audit-atomicity remediation, revision 2 (2026-11-11)

**Status: IMPLEMENTED AND VERIFIED LOCALLY ONLY. Not pushed, no migration applied, nothing deployed.** The live environment (Railway `vno-v2-uat` / Supabase `hsezyogfxgnkpweoqqny`) still runs release `a384f48` (API `77d16db1-7620-4ce6-a0af-9cc55a5a3675`, Web `b3d59b0c-7712-45e2-b38e-d3246328243a`); both rollback references are intact. The only contact with the live system was **GET-only reads** (§5, §6). **This is not "FULL SYNC".**

Workflow: Claude fixes → **Codex independently verifies** → Owner approves migration/deploy → Claude deploys → Codex verifies Production. This revision answers Codex's **NO-GO for `757af5e`** ("keep the transactional creation; remove the automatic reconciliation complexity").

| | |
|---|---|
| Production baseline (deployed) | `a384f48d072d903afdd97c52946f39b764444cb6` |
| Previous candidate (NO-GO) | `757af5edacc0051cf41298efb6c94325b64c1d9f` |
| **Candidate — runtime code** | `f58115481ef95bb6c7a73034db4729cd49ebc103` (`f581154`): 2 source files, 1 migration, rollback, privilege checker, tests |
| Candidate — tooling | `b0f6149e3c6b1bd75d568857b75f9f6392a35827` (`b0f6149`) read-only hosted catalog preflight + REST schema probe; later commits add output-only tweaks and this document (no runtime change — see the hand-off message for the exact HEAD) |
| Schema change | **Yes — additive, ONE function, no table / column / index / constraint / data change.** Needs the owner's separate approval. |

## 0. Reviewer decision → what was done

| # | Required change | Done | Where verified |
|---|---|---|---|
| 1 | Remove `reconcile_merchant_member_audit` and its call path; remove tests that assume it | Function removed from the migration; the service makes **no** call other than `create_merchant_member_application`; `parseReconcileRpc`, `ensureCreationAudit`, `MEMBER_AUDIT_PENDING`, `MEMBER_AUDIT_FAILED` deleted; reconciliation controls deleted | `git grep` of `backend/src`, `supabase`, rollback, checker: no `reconcil*` / `IN_FLIGHT` / 30 s logic (the only hits are unrelated media / transactions code and older migrations) |
| 2 | Keep `create_merchant_member_application`, row + creation audit atomic | Unchanged core: one function = one transaction, `INSERT … RETURNING … INTO STRICT`, per-e-mail advisory lock | FI-1, FI-1b, FI-2, FI-14; mutants S1, S2, S11 |
| 3 | Replay succeeds only with a **verifiable matching** creation audit; otherwise fail closed, flag, never fabricate | `requireVerifiedCreationAudit`: a read-only lookup; success only if an event matches on **action, entity type, this application's id, merchant actor role and `details.merchant_id` = the requesting Merchant**; otherwise `500 MEMBER_AUDIT_MISSING`, one log line with ids only, **no write of any kind**; a failing lookup is `500 MEMBER_LOOKUP_FAILED` (never an assumed success) | FI-5, FI-5b, FI-5c, FI-6, FI-8, FI-16; unit `hasMatchingCreationAudit`; mutants T1–T7, T10 |
| 4 | Concurrent requests through the function: no multiple rows, no multiple creation events; keep the external-writer limitation | Proven with 1, 2 and 3 API instances; limitation kept and re-stated (§7.1) | section-3 parallel control, FI-2, FI-3 (exactly **+1 row, +1 event**), FI-4, race controls, FI-13 |
| 5 | Remove the 30-second heuristic and all eligibility / provenance logic | Gone. A row's age, state and **code shape grant nothing** | FI-5 (old and young rows both refused), FI-5c (API-shaped external records refused); mutant T5 |
| 6 | Update migration, rollback script, privilege checker, tests, docs; **recalculate** the privilege count | Done. Checker now covers one function plus "no other `*merchant_member*` function": **11 rows = 10 security assertions + 1 informational owner row, 11 / 11 PASS** (the old 20 is obsolete) | §3, §4.3 (7 negative controls) |
| 7 | Adversarial tests | All eight listed scenarios have controls | §4.2 |
| 8 | Correct the remaining audit call-site count to 30 | Counted: **31 at `a384f48`, 30 at the candidate** (the Members create is no longer a separate write-then-audit site); they stay outside this release | §8.1 |
| 9 | Preserve production data; no unique index | Nothing written anywhere; GET-only re-analysis at 2026-11-11T08:49Z: 384 rows, the 3 duplicate-e-mail groups (6 rows) and `COL-05C60E056C3D4B5B` all present, 0 creation events | §5 |
| P | Production database preflight | Read-only catalog queries + runner + precise procedure **prepared**; **hosted catalog result: UNRESOLVED BLOCKER** (needs the database password); a GET-only partial result exists | §6 and `docs/VNO_V2_MEMBERS_HOSTED_CATALOG_PREFLIGHT_PROCEDURE_20261111.md` |

## 1. Finding and root cause (unchanged)

`POST /merchants/members` at `a384f48` wrote in three separate steps, each its own transaction: (1) `INSERT` of the application row over REST — **committed**; (2) a re-read and, if another instance won a race, a `DELETE` of the just-inserted row; (3) `AuditService.record()` — a **second** REST `INSERT` into `audit_events`. If step 3 failed the application stayed committed without a creation audit event, the client got a 500, and its retry found the row and was answered `201 idempotent_replay: true` — **the event was never written** and the 2xx hid the gap.

**Reproduced on the deployed code** (not just reasoned): §4.5.

## 2. Design (simplified)

### 2.1 Database — migration `20261111000001_vno_merchant_member_atomic_create.sql`
**One** function, `public.create_merchant_member_application(actor, merchant, code, name, phone, email, bank_name, bank_acc) → jsonb`, `SECURITY INVOKER`, `search_path = pg_catalog, public`, `EXECUTE` for `service_role` only. In **one transaction** it: re-checks the caller is an *active Merchant profile bound to this Merchant* and the Merchant is *active + verified*; takes `pg_advisory_xact_lock` on the lower-cased e-mail (serialises concurrent **calls of this function**, across API instances); re-checks the e-mail under the lock; inserts the `collaborators` row (`… RETURNING … INTO STRICT`: an insert that yields no row aborts everything); inserts the `collaborator.member_application_created` audit event (`{merchant_id, auth_invitation_required: true}`, no personal data). Any failure of either insert aborts both. Returns `CREATED{member}` · `EMAIL_HELD` · `NOT_ALLOWED`.

There is deliberately **no function that writes an audit event for an application that already exists.**

### 2.2 Application — `merchants.service.ts`, `merchant-members.ts`
Validation, limits (10 / h, 40 / day), the pending cap (50), the identity check, masking and the answer shapes are **unchanged**.

| Situation | Behaviour |
|---|---|
| New e-mail | `rpc('create_merchant_member_application')`; `CREATED` ⇒ `201`, `idempotent_replay:false` |
| Lost a race / e-mail already held | function returns `EMAIL_HELD` (nothing inserted) ⇒ re-read ⇒ the generic 409, or a **verified** replay |
| Same submission again (same Merchant, still pending, same details) | read-only lookup of the creation audit: **match found ⇒ `201 idempotent_replay:true`**; **no match ⇒ `500 MEMBER_AUDIT_MISSING`** (Vietnamese message, only `code` + `message`), log line `MEMBER_AUDIT_MISSING: application <id> (merchant <id>, requested by <user id>) … manual investigation required`, **nothing written**; lookup error ⇒ `500 MEMBER_LOOKUP_FAILED` |
| Function missing / not executable / unexpected answer | `500 MEMBER_CREATE_FAILED`, nothing persisted, no database text returned |
| Replay when the function is missing | still works (it only reads) — an application-only rollback needs no database change |

A "matching" event means all of: `action = collaborator.member_application_created`, `entity_type = collaborator`, `entity_id` = this application, `actor_role = merchant`, `details.merchant_id` = the requesting Merchant (`hasMatchingCreationAudit`, pure and unit-tested; the query also filters on action / type / id).

### 2.3 Consequences worth knowing (deliberate, small)
1. **Rolling deploy.** The previous API can still create a row and write its audit a few milliseconds later. A replay in that window gets `MEMBER_AUDIT_MISSING` (and a log line that is then a false positive); the next replay succeeds once the creator's own event exists (FI-6). No grace period, no guessing.
2. **Admin-created pending row identical to a Merchant's submission** (same Merchant, same details): previously a generic 409 through the provenance filter, now `500 MEMBER_AUDIT_MISSING` — still fail-closed, nothing written (FI-5b). Extremely rare; the message sends the Merchant to the Admin.
3. A row left by the previous API's partial write stays refused **until a human decides** (nothing repairs it automatically). Production has none (§5); the read-only tool for finding any future ones is `migration/v2/analyze-member-audit-gaps.mjs` plus the log token `MEMBER_AUDIT_MISSING`.

## 3. Migration impact and rollback assessment

**Impact.** One `CREATE OR REPLACE FUNCTION` and its grants in one short transaction. No table, column, index, constraint, policy, trigger or row is created, altered or removed; no table lock; milliseconds. It touches exactly the columns the deployed code already writes.

| Database | API | Result |
|---|---|---|
| without the function | `a384f48` (old) | works as today |
| with the function | `a384f48` (old) | works as today — the old code never calls it |
| with the function | candidate | atomic path (§4) |
| without the function | candidate | **create fails closed** (500 `MEMBER_CREATE_FAILED`, nothing written); replays of audited applications still work (FI-12) |

**Order:** catalog preflight → migration → `--members` check → API. **Rollback:** re-stage the API to `a384f48` **first**, then `migration/v2/rollback/20261111000001_vno_merchant_member_atomic_create_rollback.sql` (drops the one function; touches no data; audit is append-only). Application-only rollback is sufficient by itself and leaves the function harmlessly in place. The real rollback script is executed in FI-12 (row / audit counts unchanged; create fails closed; re-apply restores; applying twice is harmless).

**Proposed apply runbook (owner's host terminal — NOT executed):**
1. `node migration/v2/preflight-members-catalog.mjs` (procedure document) ⇒ **all gates PASS**; keep the two digest lines.
2. Apply the single file (it carries its own `begin … commit`): `psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261111000001_vno_merchant_member_atomic_create.sql`. **Never `supabase db push`.**
3. Register: `insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261111000001','vno_merchant_member_atomic_create', array['…applied by owner, sha256 …'])`.
4. `node migration/v2/check-function-privileges.mjs --members` ⇒ expect **11 passed, 0 failed** (read-only).
5. Write-free smoke test **inside `begin read only; … rollback;`** (the session itself proves nothing can be written): `select public.create_merchant_member_application(gen_random_uuid(), gen_random_uuid(), 'X','n','p','e@x.vn');` ⇒ `{"outcome":"NOT_ALLOWED"}` (an unknown actor is refused before any write). Verified in exactly that form on the rehearsal database: the call returns `{"outcome": "NOT_ALLOWED"}`, a write attempted in the same session is refused (`cannot execute INSERT in a read-only transaction`), and the row counts are unchanged (`08-smoke-test.log`).
6. Preflight again: only the expected differences (§5 of the procedure document).

**Residual risk, stated plainly.** The function body has run against a faithful rehearsal (Postgres 17 + PostgREST v14.5, every repo migration) but never on the hosted database. The catalog preflight exists to close exactly that gap; its hosted run is the open blocker (§6). The first real Merchant creation will be the first hosted execution of the insert path; it fails closed (nothing persisted, 500) if anything differs.

## 4. Local test evidence

Everything below ran on a **clean `git archive` export of the candidate commit** with a **freshly rebuilt** rehearsal stack (disposable Postgres 17 + PostgREST v14.5, loopback only; the integration test refuses any non-loopback target). Logs: `migration/v2/evidence/members-audit-atomicity-20261111-rev2/` (uncommitted, like earlier evidence).

### 4.1 Results
| Check | Result |
|---|---|
| `tsc --noEmit`, `npm run build` (the Dockerfile step), `eslint` on the two changed source files | clean |
| Unit `test:merchant-members` | **34 / 34 PASS** (includes `hasMatchingCreationAudit`: 14 rejection cases + the accepted one) |
| **Integration `test:rehearsal-merchant-members`** | **36 / 36 PASS**, 3 consecutive runs on the export |
| Other backend scripts | `d6-contracts` 28 · `invitation-guards` 3 · `merchant-profile-update` 10 · `merchant-qr-flow` 23 · `partner-single-step` 29 · `approve-unclaimed` 7 · `main-media` 13 · `public-catalog` 14 · `anonymous-privacy` 3 · `auth-email-hook` 15 · `media-lifecycle` PASS |
| `test:rehearsal-global-network` (same database) | 9 / 9 PASS |
| `check-function-privileges.mjs --rehearsal --members` | **11 passed, 0 failed** (§4.3) |
| Known failures that are **not** caused by this change | `test:d13a-contracts` and `test:email-delivery` (37 passed, 2 failed) fail identically on the deployed baseline `a384f48`; unchanged, not hidden |
| `frontend/` | not touched |

### 4.2 The adversarial controls (reviewer item 7)
| Required scenario | Controls | Proves |
|---|---|---|
| **Audit insertion failure and atomic rollback** | FI-1 · FI-1b · FI-2 · FI-14 | a trigger makes the audit insert fail ⇒ 500, **no application row, no audit row**, no internals in the body; the retry after recovery creates exactly one row + one event (not a replay); 6 parallel requests under the fault all fail and persist nothing; an insert that yields **no row** (a hosted `BEFORE INSERT` trigger) aborts the whole call — no orphan audit event |
| **Concurrent identical creation requests** | section-3 control (8 parallel) · FI-2 (recovery phase) · **FI-3 (3 API instances × 15 calls: exactly +1 row, +1 audit event, 14 replays)** · FI-4 (different details) · the race controls · **FI-13 (lock contract)** | one row, one creation event; the database lock — not the in-process one — serialises; with another session holding the lock and an uncommitted competing row the call **waits** (≥ 0.8 s measured) and then answers the generic 409 |
| **Idempotent replay with a valid creation audit** | section-3 replay · **FI-8** (3 replays: counts of rows **and** audit events identical before / after) · race control (b) (a competing instance runs the real function) | `201 idempotent_replay:true`, same id, the API writes nothing |
| **Replay of a record with no creation audit** | **FI-5** (an old row *and* a just-created row) · race control (c) | `500 MEMBER_AUDIT_MISSING`, Vietnamese message, only `code` + `message`, no id / e-mail in the body; the log line carries ids only (asserted: no e-mail / phone / name); row unchanged; **zero** audit events written; refused every time |
| **External records using an API-shaped code** | **FI-5c** (7 variants + P / Q) · FI-5b | pending, same Merchant, same details, code `COL`+7 hex, but: no event · an Admin `collaborator.created` event · a creation event naming **another Merchant** · written by an **admin** actor · **without a Merchant** in its details · the **removed** reconciliation action · *another application's* valid event ⇒ **all refused**, nothing written (the neighbour with its own valid event succeeds). FI-5b: the Admin-path row (`COL-`+16 hex, own audit) is refused too |
| **An attempted late audit write** | **FI-6** | (a) replays refused while no matching event exists, nothing written; (b) calling the create function for the held e-mail answers `EMAIL_HELD` and writes **no** event — it cannot back-fill; (c) only the creator's own late write (simulating the previous API auditing after its insert) makes the *next* replay succeed, and the API adds **no** event of its own (exactly one in total). *Interpretation, stated so Codex can correct it:* "late audit write" = an audit event arriving after the row is committed, whether from the creator or from the system trying to repair it |
| **API behaviour when the function is unavailable** | **FI-15** (EXECUTE revoked from `service_role`) · **FI-12** (function dropped by the real rollback script) · **FI-16** (the audit lookup itself fails: SELECT revoked) | create ⇒ generic 500 `MEMBER_CREATE_FAILED`, nothing written, no `permission` / `42501` / `PGRST` text; replays of audited applications still work; a failing lookup ⇒ 500 `MEMBER_LOOKUP_FAILED`, **never** a success; everything recovers after the grant / re-apply |
| **Migration rollback and re-application** | **FI-12** | rollback script ⇒ function gone, row / audit counts untouched; re-apply ⇒ full function; **applying a second time is harmless** (still one function, API unaffected); waits for PostgREST's schema cache to really settle (`PGRST202`; 5 consecutive successes) |

Other controls kept from the first revision: FI-9 (the function's own guards: wrong actor / Merchant / state, **each half of "active and verified" tested separately**, blank arguments, e-mail normalised inside the function), FI-10 (anon / authenticated get SQLSTATE `42501`, ACL read from the catalog: `service_role` only, `SECURITY INVOKER`, `search_path` pinned), FI-11 (invariants after everything: every API-created application has exactly one creation event; the removed reconciliation action appears only where a control planted it; no event points at a missing application), plus the retired Partner route (410), validation, limits, authorization, privacy, isolation.

Fault injection is a trigger / privilege change that exists only while a control runs and is always removed (`finally`). Counts are scoped to the run's own random Merchants.

### 4.3 Privilege checker (recalculated)
`migration/v2/check-member-function-privileges.sql` + `check-function-privileges.mjs --members`: one function, so **9 assertions + 1 new assertion (no other `*merchant_member*` function) + 1 informational owner row = 11 rows; expected `SUMMARY 11 passed, 0 failed`.** Rehearsal: 11 / 11. **Seven negative controls each fail the right assertion** (grant to PUBLIC ⇒ 4 FAIL; grant to anon ⇒ 2; `SECURITY DEFINER` ⇒ 1; `search_path` reset ⇒ 1; a leftover `reconcile_merchant_member_audit` ⇒ 1; a second overload ⇒ 1; function absent ⇒ 9) and the restored state is 11 / 11 (`02-privilege-checker-negative-controls.log`).

### 4.4 Planted regressions (mutation testing)
Each regression is planted alone — SQL in the disposable rehearsal database (restored by re-applying the migration), TypeScript in a scratch copy — the integration suite is run, the original restored. A mutant that does not compile or that Postgres rejects counts as *bad*, not as caught.

| # | Planted regression | Caught by |
|---|---|---|
| S1 | audit insert removed from the function (row committed without audit) | "audit row" control (section 2) |
| S2 | audit failure swallowed (`exception when others then null`) | FI-1 |
| S3 | advisory lock removed | FI-3 |
| S4 | lock key differs per call (no mutual exclusion) | FI-13 |
| S5 | e-mail re-check under the lock removed | competing-row control |
| S6 | actor / Merchant guard removed | FI-9 |
| **S7** | "Merchant verified" half of the guard dropped | **FI-9 — this one was MISSED on the first run of this revision** (no test had an active-but-unverified Merchant); FI-9 now tests each half separately and S7 is caught |
| S8 / S9 / S10 | `EXECUTE` also granted to `anon` · `SECURITY DEFINER` · `search_path` unpinned | FI-10 (catalog assertions) |
| S11 | insert not `STRICT` (a swallowed insert leaves an orphan audit event) | FI-14 |
| S12 | personal data (name) written into the audit details | "audit row" control |
| S13 / S14 / S15 | audit written with actor role `admin` · details without `merchant_id` · `entity_id` = code instead of id | "audit row" control |
| S16 | e-mail not normalised inside the function | FI-9 |
| S17 / S18 | application created `active` · `verified` | first create control |
| T1 | replay answered with success without checking the audit | race control (c) |
| T2 / T3 | matcher ignores `details.merchant_id` · ignores `actor_role` | unit test **and**, with unit tests switched off, FI-5c |
| T4 | matcher ignores `entity_id` | unit test (see below) |
| T5 | code shape `COL`+7 hex skips verification (provenance by pattern) | race control (c) |
| T6 | audit-lookup error treated as success | FI-16 |
| T7 | the API back-fills the missing creation audit (fabricates an event) | race control (c) |
| T8 | refused replay no longer flagged in the log | FI-5 |
| T9 | create reports success when the function call fails | FI-1 |
| T10 | matcher accepts the removed reconciliation action | unit test (see below) |
| T4b | `entity_id` ignored in **both** the query filter and the matcher | integration suite alone |
| T10b | removed reconciliation action accepted in **both** the query filter and the matcher | integration suite alone (FI-5c) |
| T2b | `merchant_id` **and** `actor_role` ignored in the matcher | integration suite alone (FI-5c) |

**31 planted regressions, 31 caught, 0 missed** (the 28 above in one run — SQL S1–S18, TypeScript T1–T10 — plus the three two-layer mutants). T4 and T10 are *equivalent at the integration level on purpose*: the query itself already filters on `action` and `entity_id`, so the matcher is a second, independent layer; the unit tests pin the matcher and T4b / T10b prove the integration suite catches the failure when **both** layers are weakened. S8 / S9 are not exploitable behaviourally (the function is `SECURITY INVOKER` and those roles have no table privileges), which is why the control reads the catalog ACL and why the read-only `--members` check is the guarantee for the live database. Log: `06-mutation-matrix.log`.

### 4.5 Reproduction on the deployed code
The new integration suite was run against the **deployed application code** (`backend/src` of `a384f48`; the two files that differ from the candidate are the only source differences — `git diff --stat a384f48 f581154 -- backend/src`) on a database that already has the function (the old code never calls it), with `VNO_CONTINUE_ON_FAIL=1`: **23 PASS, 13 FAIL**. The failures that show the *defect*:

| Failing control on `a384f48` | What the deployed code does |
|---|---|
| FI-1 | audit write fails ⇒ **the request fails and the application row persists** |
| FI-1b | the retry is a replay, not a creation: the row has no audit event |
| FI-2 | 6 parallel requests under the fault: statuses `[201,201,201,201,500,201]` — five "successes" for a row with no audit trail |
| FI-5 · FI-5c · FI-6 · race control (c) | a replay of an application **with no creation audit** (old row, young row, API-shaped code, late audit) is answered `201 idempotent_replay` — no check, no flag |
| FI-5b | an Admin-created pending row is returned to the Merchant as an idempotent replay |
| FI-13 | the call does **not wait** for the lock holder (answered in ~39 ms) — no database-level serialisation |
| FI-11 | invariant broken: applications with no creation event |

FI-12, FI-15 and FI-16 also fail on the baseline, but that is a **design difference, not a defect**: they assert that the *candidate* fails closed without the function and verifies the audit before a replay; the deployed code does neither (and keeps working with or without the function — the desired rollback compatibility). Log: `07-baseline-a384f48-reproduction.log`.

## 5. Existing production data — read-only (GET-only), unchanged
Re-run at **2026-11-11T08:49Z** with the edited `analyze-member-audit-gaps.mjs` (GET-only by construction, pinned to the live host, reads no name / phone / bank field, hashes e-mails in memory). Evidence: `…-rev2/hosted-data-analysis/summary.json` (identifiers and counts only; contains no `@`).

| Question | Result |
|---|---|
| `collaborators` rows | 384 (same as the first analysis at 02:31Z); 4 carry a `merchant_system_id` |
| Any application created through the Members API? | **No.** 0 rows with the code shape; **0** `collaborator.member_application_created` events; no reconciliation events exist or ever did |
| Applications needing repair | **0** |
| Orphan audit events / entities with > 1 creation event | 0 / 0 |
| Pending rows per Merchant | max **1** (cap 50) |
| Duplicate e-mails (case-insensitive) | **3 groups of 2 rows** — preserved, untouched (`COL-F003CC3F02C48BC8`/`COL-4753E20CBA4FE801`, `COL-D600ABC8D5C2C528`/`COL-05C60E056C3D4B5B`, `COL-8C79BF554AA24BD5`/`COL-80BFCB2967EDD04C`) |
| `COL-05C60E056C3D4B5B` (id `a71ce95a-f99c-4195-b5a5-df90ab47171f`) | **present and unchanged**: pending, unverified, tagged to a Merchant, no login, registered 2026-10-31T16:30Z, same e-mail as the active Partner `COL-D600ABC8D5C2C528`, no audit event. Not a Members-API row (code shape `COL-`+16 hex). Still awaiting an owner decision; **nothing was changed; no unique index is introduced in this revision** |

## 6. Production database preflight (reviewer item P)

**Prepared.** `migration/v2/preflight-members-catalog.sql` + `.mjs` run on an authorized host connection to `hsezyogfxgnkpweoqqny` and check, against the **hosted** catalog: columns and types, bounded-`varchar` lengths, NOT NULL columns without a default, constraints (CHECK / UNIQUE / FK), indexes, triggers, RLS and policies, privileges and role attributes, existing functions (name clash, advisory-lock namespace), event triggers, default privileges, extensions, the migration history, plus aggregates and before / after digests. Read-only session, no credentials in output or evidence, no row data. The precise procedure — preconditions, command, interpretation table of every gate, expected values, re-run discipline, tool hashes — is `docs/VNO_V2_MEMBERS_HOSTED_CATALOG_PREFLIGHT_PROCEDURE_20261111.md`. **I did not ask for, and do not hold, any database credential.**

**Tested locally:** 54 gates PASS on a faithful pre-apply state; **11 negative controls each trip exactly the intended gate** (unique e-mail index, CHECK on `action`, BEFORE INSERT trigger, an unwritten NOT NULL column, a too-short `varchar`, a revoked privilege, a leftover reconcile function, an already-applied function, wrong migration history, a lock-prefix clash, a missing column); restored state 54 / 54 (`04-catalog-preflight-rehearsal.log`).

**Hosted result — partially resolved, with an explicit blocker.**
* **Resolved without a password** (GET-only `migration/v2/rest-schema-probe.mjs`, one OpenAPI request, no table read; evidence `…-rev2/hosted-rest-schema-probe/`): **33 PASS, 0 FAIL, 1 UNRESOLVED.** The four tables are exposed; every column the function writes or reads exists with the right type family and enough room; `collaborators` has no NOT NULL column without a default that the function omits; `create_merchant_member_application` is **not** callable yet; no other `*merchant_member*` function is.
* **UNRESOLVED:** `audit_events.id` (bigint NOT NULL, no default visible over REST — what an identity column looks like).
* **BLOCKER:** constraints, indexes, triggers, RLS / policies, privileges, role attributes, event triggers and the migration history are **not visible over REST**. They stay unresolved until the owner (or a delegate holding the VNO database credentials) runs the catalog preflight at a host terminal. Until then **the schema change must not be applied.**

## 7. Assessment for the following release (not part of this revision)

### 7.1 Database uniqueness constraint on the e-mail — acknowledged limitation preserved
* **What exists now:** the function serialises concurrent *calls of itself* per e-mail across instances (FI-13). It does **not** stop a writer that takes no lock — the previous API during a rolling deploy, Partner registration, Admin create. Reproduced in the first revision: a session inserting the same e-mail without the lock while the function runs yields two rows. This revision no longer self-heals such a duplicate (it never did after the convergence delete was removed). Practical exposure today is nil (no Members creation has ever been recorded).
* **A full `unique (lower(collaborators_email))` cannot be created today** — the 3 duplicate groups block it. A pending-only partial index could, but would not cover the dangerous case (a pending row duplicating an **active** Partner's e-mail — exactly `COL-05C60E056C3D4B5B`). **Not introduced in this revision, as instructed.**
* **Recommendation: prepare for the following release** — owner decisions per duplicate group through the governed Admin flow, `create unique index concurrently` as its own controlled step, a `unique_violation` handler mapping to `EMAIL_HELD`, optionally a uniqueness constraint on `collaborators_code`.

### 7.2 Durable throttling
Per-Merchant limits are in process memory (10 / h, 40 / day; reset on restart, multiplied by replicas — 1 today) and the pending cap (50) is counted in the database but **not atomic with the insert**. No usage data exists to size anything. Best option: count `created` audit events per Merchant **inside the create function under a per-Merchant advisory lock** — durable, atomic with the insert, no new table. **Recommendation: design it with 7.1 for the following release; keep the current values until real usage exists.**

## 8. Observations outside this scope (not changed)
1. **Audit call sites — 30 remain.** `audit.record(` has **31** call sites at the deployed baseline `a384f48`; the Members create was one of them and no longer is, leaving **30** at the candidate: merchants 8, collaborators 9, invitations 5, media 3, user-profiles 2, partner-registration 1, auth 1, activation 1. They keep the "write, then audit in a second call" pattern; the money-moving flows already audit inside database functions. They stay **outside this release**; a prioritised inventory is recommended.
2. The pending cap and the rate limits are not atomic with the insert (§7.2).
3. Pre-existing, not caused by this change: Partner registration and Admin create de-duplicate e-mail with no lock and no unique index (Admin create also stores it un-normalised); the Partner code is 28 bits of randomness with no uniqueness check; a Merchant can pre-claim any e-mail with a pending row (mitigated by the generic 409 and the rate limits); `toLowerCase()` runs before the ASCII e-mail regex, so `Kelvin@x.vn` (Kelvin sign) is accepted and stored as `kelvin@x.vn`.
4. The `23505` code-collision retry is unchanged and still not exercised by a test (the rehearsal schema has no unique index on the code).

## 9. Independent review

### 9.1 Hand-off brief for Codex
Review the code commit `f58115481ef95bb6c7a73034db4729cd49ebc103` (and the tooling commit `b0f6149`) against `a384f48` and against the rejected `757af5e`:
`git diff a384f48 f581154 -- backend/src supabase migration backend/scripts` · `git diff 757af5e f581154`. Do not rely on this document; this reproduces every claim from a clean export:
```
git archive <HEAD> | tar -x -C /tmp/cand && cd /tmp/cand
(cd backend && npm ci && npm run build && npx tsc --noEmit && npx eslint src/modules/merchants)
bash migration/v2/rehearsal/start-rehearsal-stack.sh                                   # disposable Postgres 17 + PostgREST v14.5, loopback only
(cd backend && npm run test:merchant-members)                                          # unit: 34
(cd backend && npm run test:rehearsal-merchant-members)                                # integration: 36
PATH=/opt/homebrew/opt/libpq/bin:$PATH node migration/v2/check-function-privileges.mjs --rehearsal --members     # 11 passed, 0 failed
```
**Where I would push hardest**
1. *Replay verification.* Is "action + entity type + application id + merchant actor + `details.merchant_id`" the right definition of a verifiable match? Anything that lets a row without a genuine creation event earn a 2xx, or refuses a genuine one?
2. *Fail-closed choices.* `500 MEMBER_AUDIT_MISSING` (not a 409) so monitoring sees it; the rolling-deploy false positive (§2.3-1); the Admin-created-identical-row case (§2.3-2).
3. *Hosted vs rehearsal.* Everything §6 lists as unresolved.
4. *What the lock does not cover* (§7.1), and whether the tests could pass vacuously (the trigger-based fault injection, the three-instance race, FI-13, FI-11, the mutation matrix).
5. *Interpretation of "an attempted late audit write"* (§4.2).

### 9.2 Earlier supplemental review (fresh-context Claude agent — superseded where noted)
The review of `4496840` found: (1) a Medium — reconciliation could write a false "audit missing" event for an Admin-created row — **gone with the function**; (3) `IN_FLIGHT` answered 2xx without an audit trail — **gone**; (2) the lock does not cover lock-free writers — **kept, documented (§7.1)**; (4) an insert yielding no row left an orphan audit event — **fixed, `STRICT`, FI-14**; (5) function-level validation weaker than its message — **fixed (blank checks include tab / CR / LF; the normalised e-mail is stored; FI-9)**; (6) cap / limiters outside the transaction — **documented (§7.2, §8)**; (7) weak tests — **fixed earlier; this revision adds the controls above**. It was a supplement, not a substitute for Codex.

## 10. Proposed release (for the owner's decision — NOT authorised, NOT executed)
1. Codex review with no open High / Medium finding.
2. **The hosted catalog preflight is run (§6) and every gate is PASS.**
3. Owner approves **(a)** the schema change and **(b)** push + deploy of the candidate HEAD.
4. Owner applies the migration per §3; `--members` = 11 / 11; read-only smoke test; preflight digests.
5. Claude pins **API only** (the Web is unchanged: `frontend/` is byte-identical to the deployed one), verifies SUCCESS, `/health` 200, exact `meta.commitHash`; runs the **write-safe** hosted checks only (spec `102`, `00-unauth`, the 52 approved safe cases).
6. *Only if the owner confirms it for this release:* the controlled Production business test the owner has previously authorized — **one** Merchant-member creation, with an owner-designated Merchant and e-mail alias. Expected: `201`, exactly **one** `collaborators` row and **one** creation event; a repeat returns `201 idempotent_replay:true` with no second row or event. No deletion afterwards (an Admin rejects the application through the governed flow). It is the first hosted execution of the insert path and fails closed.
7. Codex verifies Production. Rollback: re-stage the API to `a384f48` (`77d16db1…`); the function may stay.

## 11. Recommendation — three separate decisions (none is an approval)

### 11.1 This remediation (one function + API) — **GO, conditional**
*Why:* the defect is reproduced on the deployed code and removed by a transaction; the design is now the smallest that is correct (one function, no repair logic, a read-only verification on replay); 36 integration controls — fault injection, three-instance races, a lock contract, replay verification, an unavailable function, a rollback drill — pass three times on a clean export; the planted-regression matrix is in §4.4; the change is additive and reversible without data loss; *production has never recorded a Members creation* (§5), so there is nothing to repair and no user is affected while it is scheduled.
*Conditions (all must hold; any failure ⇒ NO-GO for that step):* (1) Codex's independent review has no open High / Medium finding; (2) the **hosted catalog preflight is run and every gate is PASS** — this is the one thing the rehearsal cannot prove and it is currently an open blocker; (3) the owner approves the schema change and the push + deploy; (4) after applying: `--members` = **11 / 11** and the read-only smoke test returns `NOT_ALLOWED` — before the API is deployed.
*Residuals the owner accepts by approving:* (a) lock-free writers can still create a duplicate e-mail until the unique index of 11.2 exists (acknowledged limitation, practical exposure nil today); (b) the first real creation is the first hosted execution of the insert path; (c) the rolling-deploy false positive and the Admin-identical-row refusal of §2.3; (d) the guards listed in §8.
*Urgency:* low to moderate — a latent defect in a feature nobody has used; it is not an incident.

### 11.2 Database uniqueness constraint — **NO-GO to apply now; GO to prepare**
Three duplicate-e-mail groups block a full unique index; owner decisions are needed first (§7.1). Not a prerequisite for 11.1.

### 11.3 Durable throttling — **GO to design and bundle with 11.2; not needed for 11.1**

### Decisions the owner will need to make
1. Approve (or not) the schema change and release of §10 — after Codex's review **and** the hosted catalog preflight.
2. Who runs the hosted catalog preflight (§6) and when.
3. What to do with the pending row `COL-05C60E056C3D4B5B` and the three duplicate-e-mail groups (leave / reject through the governed Admin flow) — needed for 11.2, not for 11.1.
4. Whether to include the controlled single Merchant-member creation of §10-6 in this release.
5. Whether to commission the inventory of the 30 remaining write-then-audit call sites.
