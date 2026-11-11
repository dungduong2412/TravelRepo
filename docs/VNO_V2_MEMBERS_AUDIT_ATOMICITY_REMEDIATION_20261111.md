# VNO V2 — Members audit-atomicity remediation (2026-11-11)

**Status: IMPLEMENTED AND VERIFIED LOCALLY ONLY. Not pushed, not deployed, no schema change applied anywhere.** The live environment (Railway `vno-v2-uat` / Supabase `hsezyogfxgnkpweoqqny`) still runs the release `a384f48` (API `77d16db1-7620-4ce6-a0af-9cc55a5a3675`, Web `b3d59b0c-7712-45e2-b38e-d3246328243a`); both rollback references are intact. The only contact with the live system was **GET-only reads** (§6).

Workflow: Claude implements → **Codex independently reviews** → Owner approves → Claude deploys → Codex verifies. This document is the hand-off to the reviewer and the approval package for the owner.

| | |
|---|---|
| Baseline (deployed) | `a384f48d072d903afdd97c52946f39b764444cb6` |
| **Candidate (code)** | `44968407818b49f3bee5a350c06dcf82da0d2975` (`4496840`) — 2 source files, 1 migration, tests and read-only tools |
| **Candidate (HEAD)** | the commit that contains this document, on top of the code commit — documentation only, runtime-identical (verified by `git diff --stat <code> HEAD -- backend supabase frontend`). Its SHA is reported in the hand-off message. |
| Schema change | **Yes — additive, two functions, no table/data change.** Needs the owner's separate approval. |

## 1. Finding and root cause

`POST /merchants/members` (Merchant adds a pending Partner application) wrote in **three separate steps**, each its own database transaction (`merchants.service.ts` at `a384f48`):

1. `INSERT` of the application row over REST — **committed**;
2. a re-read of the e-mail and, if another instance had won a race, a `DELETE` of the just-inserted row ("convergence") — outside any transaction;
3. `AuditService.record()` — a **second** REST `INSERT` into `audit_events`.

If step 3 fails (audit outage, FK/constraint failure, dropped connection, process crash between 1 and 3), the application **stays committed without a creation audit event**, the client gets a 500, and the client's natural retry finds the row and is answered `201 idempotent_replay: true` — **the missing event is never written**. The gap becomes permanent and the 2xx hides it.

**Reproduced** (not just reasoned): the new test-suite, run against the *deployed* application code (`backend/src` byte-identical to `a384f48`, proven by `diff -r`), fails 12 controls (§4.2). Two examples: with the audit write failing, the request returns 500 **and the row persists**; with six parallel requests under the same fault the statuses were `[201,201,201,500,201,201]` — five "successes", every one a replay of a row that has no audit trail.

## 2. Implementation

### 2.1 Transactional core — migration `20261111000001_vno_merchant_member_atomic_create.sql`
Two functions, both `SECURITY INVOKER`, `search_path = pg_catalog, public`, `EXECUTE` for `service_role` only (same conventions as the D13/D14/global-network functions).

| Function | Does | Returns |
|---|---|---|
| `create_merchant_member_application(actor, merchant, code, name, phone, email, bank_name, bank_acc)` | In **one transaction**: re-checks the caller is an *active Merchant profile bound to this Merchant* and the Merchant is *active + verified*; takes `pg_advisory_xact_lock` on the lower-cased e-mail (serialises concurrent **calls of this function** for one e-mail, across API instances — see the limits in §7.1); re-checks the e-mail under the lock; inserts the `collaborators` row (`INSERT … RETURNING … INTO STRICT`, so an insert that yields no row aborts everything); inserts the `collaborator.member_application_created` audit event (identical shape to before: `{merchant_id, auth_invitation_required:true}`, no personal data). Any failure of either insert aborts both. | `jsonb`: `CREATED{member}` · `EMAIL_HELD` · `NOT_ALLOWED` |
| `reconcile_merchant_member_audit(actor, merchant, member)` | For an idempotent replay of an application **created by this API** (code shape `COL` + 7 hex) whose **original creation audit is missing**: writes ONE distinct `collaborator.member_application_audit_reconciled` event (`details`: merchant id, `reason:'creation_audit_missing'`, the application's registration time). Never a second `created` event; never repeats (existing created/reconciled event ⇒ `ALREADY_AUDITED`); **never touches a row created by another path** (Admin create, Partner registration, V1 import have their own audit trail ⇒ `NOT_ELIGIBLE`); rows within 30 s of now are `IN_FLIGHT` (the old API may still be about to write its own audit during a rolling deploy): nothing is written; only for this Merchant's own pending, unverified application. | `text`: `ALREADY_AUDITED` · `RECONCILED` · `IN_FLIGHT` · `NOT_ELIGIBLE` · `NOT_ALLOWED` |

### 2.2 Application — `merchants.service.ts`, `merchant-members.ts` (2 files)
Validation, rate limits (10/h, 40/day), the pending cap (50), identity check, masking and the answer shapes are **unchanged**. What changed:

| Situation | Before (`a384f48`) | Now |
|---|---|---|
| New e-mail | insert → re-read/maybe delete → separate audit | one `rpc('create_merchant_member_application')`; `CREATED` ⇒ 201 |
| Lost a race / e-mail already held | convergence deleted *our* row | function returns `EMAIL_HELD` (nothing inserted) ⇒ re-read ⇒ replay or the generic 409 |
| Replay of the same submission | 201 `idempotent_replay`, no audit check | `rpc('reconcile_merchant_member_audit')` first; **a replay answers 2xx only if an audit trail exists**: `ALREADY_AUDITED`/`RECONCILED` ⇒ 201; `IN_FLIGHT` ⇒ retryable **409** `MEMBER_AUDIT_PENDING`; `NOT_ELIGIBLE` (not this API's application) ⇒ the generic 409; anything else ⇒ 500 `MEMBER_AUDIT_FAILED` |
| Any failure / unexpected answer / missing function | mixed (`MEMBER_CREATE_FAILED`, or a raw 500 after a committed insert) | `MEMBER_CREATE_FAILED` 500 and **nothing persisted**; the database's text is never returned |

Removed: the post-insert convergence and its `DELETE`, and the now-unused `canonicalMember` helper. Added: strict parsers `parseCreateMemberRpc` / `parseReconcileRpc` (anything unexpected ⇒ fail closed).

## 3. Migration impact and rollback assessment

**Impact.** Two `CREATE OR REPLACE FUNCTION` statements in one short transaction. No table, column, index, constraint, policy, trigger or row is created, altered or removed; no table lock is taken; runtime is milliseconds. The columns the functions use are exactly those the deployed code already reads/writes (`user_profiles`, `merchant_details`, `collaborators`, `audit_events`).

**Compatibility matrix** (proven where marked):
| Database | API | Result |
|---|---|---|
| without functions | `a384f48` (old) | works as today |
| with functions | `a384f48` (old) | works as today — old code never calls them (**proven**: reproduction run, §4.2) |
| with functions | candidate | atomic path (**proven**, §4.1) |
| without functions | candidate | **fails closed**: create → 500 `MEMBER_CREATE_FAILED`, replay → 500 `MEMBER_AUDIT_FAILED`, nothing written, no internals leaked (**proven**, control FI-12) |
| mixed fleet during a rolling deploy | old + candidate | old instance keeps its old (non-atomic) behaviour for the overlap; the 30 s `IN_FLIGHT` grace prevents the new instance from reconciling a row the old one is still auditing |

**Order:** migration → verify → API. **Rollback:** re-stage the API to `a384f48` **first**, then run `migration/v2/rollback/20261111000001_vno_merchant_member_atomic_create_rollback.sql` (drops the two functions, touches no data; audit is append-only so any `…_audit_reconciled` events stay). Application-only rollback (API re-stage) is sufficient on its own and leaves the functions harmlessly in place. The real rollback script was executed in the rehearsal database in control FI-12: row/audit counts unchanged, the API failed closed, re-applying restored full function.

**Proposed apply runbook (owner's host terminal; same discipline as the previous migrations — NOT executed):**
1. Read-only prechecks: version `20261111000001` absent from `supabase_migrations.schema_migrations`; neither function exists; the columns listed in §2.1 exist; **and the hosted table facts the rehearsal cannot know** (recommended by the review, §9.2): `select tgrelid::regclass, tgname, pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in ('public.collaborators'::regclass,'public.audit_events'::regclass);` and `select tablename, indexdef from pg_indexes where schemaname='public' and tablename in ('collaborators','audit_events');` — anything unexpected (a `BEFORE INSERT` trigger that rewrites/suppresses rows, an extra `NOT NULL` column without default, a unique index on code/e-mail) is a **stop-and-review**, not an apply.
2. Before-snapshot: `migration/v2/catalog-fingerprint.sql` (read-only).
3. Apply the single file (it carries its own `begin … commit`): `psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261111000001_vno_merchant_member_atomic_create.sql`. **Never `supabase db push`.**
4. Register: `insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261111000001','vno_merchant_member_atomic_create', array['…applied by owner, sha256 …'])`.
5. `node migration/v2/check-function-privileges.mjs --members` ⇒ expect **20 / 20 PASS** (read-only).
6. Write-free smoke test of the installed functions, **inside `begin read only; … rollback;`** so the session itself proves nothing can be written: `select public.create_merchant_member_application(gen_random_uuid(), gen_random_uuid(), 'X','n','p','e@x.vn');` ⇒ `{"outcome":"NOT_ALLOWED"}` (an unknown actor is refused before any write); likewise `reconcile_merchant_member_audit(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())` ⇒ `NOT_ALLOWED`. (Verified in exactly that form on the rehearsal database.)
7. After-snapshot: fingerprint differs only by the two functions.

**Residual risk, stated plainly.** The function bodies have run against a faithful rehearsal (Postgres 17 + PostgREST v14.5, every repo migration) but have never run on the hosted database, and the repo's baseline is a reconstruction of it. The hosted `collaborators`/`audit_events` could carry a constraint or trigger the rehearsal lacks. Mitigations: the functions write exactly the columns the deployed code already writes; the prechecks and steps 5–6 prove installation and privileges without a write. **Production member-creation tests are not authorised**, so the first real Merchant creation will be the first hosted execution of the insert path; it fails closed (nothing persisted, 500) if anything differs. Production has never recorded a Members creation (§6), so no user is affected in the meantime.

## 4. Local test evidence

All on a rehearsal stack built from the candidate's own migrations (`migration/v2/rehearsal/start-rehearsal-stack.sh`: disposable Postgres 17 + PostgREST v14.5, loopback only; the test refuses any non-loopback target).

### 4.1 Candidate
On the exported candidate commit (`git archive 4496840`), rehearsal stack rebuilt from that export's own migrations:
| Check | Result |
|---|---|
| `npm run build` (the Dockerfile step), `tsc --noEmit`, `eslint src` | clean · 0 errors (1 pre-existing warning) · compiled output carries both RPC names and `MEMBER_AUDIT_PENDING`, and no `canonicalMember` |
| Unit `test:merchant-members` | **34 controls PASS** (33 → 34: two parser suites replace the removed `canonicalMember` case) |
| **Integration `test:rehearsal-merchant-members`** | **34 controls PASS**, 3 consecutive runs on the export (plus the 5 consecutive and the pristine runs after the matrix in the working tree). 18 original + 16 new. |
| Regression scripts | `d6-contracts` 28 · `invitation-guards` 3 · `merchant-profile-update` 10 · `merchant-qr-flow` 23 · `partner-single-step` 29 · `approve-unclaimed` 7 · `main-media` 13 · `public-catalog` 14 · `anonymous-privacy` 3 · `auth-email-hook` 15 · `media-lifecycle` — all PASS; plus the two known failures of §4.5 |
| `test:rehearsal-global-network` (same database) | 9 / 9 PASS |
| `check-function-privileges.mjs --rehearsal --members` | **20 / 20 PASS** |
| `frontend/` | byte-identical to the deployed release (no change, nothing to rebuild) |

Logs: `migration/v2/evidence/members-audit-atomicity-20261111/` (uncommitted).

### 4.2 Reproduction of the defect on the deployed code
The final suite (candidate's integration test) was run against the **deployed application code** — `backend/src` of `a384f48`, proven byte-identical with `diff -r` — on a database that already has the new functions (so only the application differs; the old code never calls them). `VNO_CONTINUE_ON_FAIL=1` lists every failing control: **22 PASS, 12 FAIL.**

| Failing control on `a384f48` | What the old code does |
|---|---|
| FI-1 | audit write fails → **500 and the application row persists** |
| FI-1b / FI-5 / FI-7 | the retry (or any replay) is answered `201 idempotent_replay` and **no audit event is ever written** |
| FI-2 | 6 parallel requests under the same fault: statuses `[201,201,201,500,201,201]` — five "successes", every one a replay of a row with no audit trail |
| FI-5b | an Admin-created pending row tagged to the Merchant is returned (id, code) to the Merchant as an "idempotent replay" |
| FI-6 | an unaudited, just-created row is replayed with a 2xx and no audit |
| FI-13 | the call does **not wait** for the lock holder (answered in ~25 ms) — it takes no database-level serialisation |
| FI-3 | two instances racing on one e-mail — outcome varies run to run (clean in one run, not in the next); the old convergence deletes rows outside a transaction |
| FI-11 | invariant broken: applications with no `created` event |
| race control (title: "competing row committed between our pre-check and our insert") | the old code's convergence/replay behaviour differs from the new contract |
| FI-12 | not a defect: it asserts the *candidate* fails closed without the functions; the old code does not use them and keeps working (which is the desired rollback compatibility) |

Logs: `03-reproduction-on-a384f48.log`.

### 4.3 Fault injection and concurrency — what each control proves
| Control | Scenario | Proves |
|---|---|---|
| FI-1 | a trigger makes the audit `INSERT` fail | 500, **no application row, no audit row**, no internals in the body |
| FI-1b | fault cleared, same payload retried | exactly one row, exactly one `created` event, `idempotent_replay:false` |
| FI-2 | 6 parallel identical requests while the audit write fails, then 6 after recovery | all fail and nothing persists; afterwards one row, one event, one non-replay |
| FI-3 | 2 API instances (separate in-process locks) × 10 parallel identical calls | one row, one event, nine replays, no error — the database lock, not the in-process one, serialises |
| FI-4 | the same, with *different* details for one e-mail | one winner; the rest replay the winner or get the generic 409; never a 500; one row, one event |
| FI-5 | pending application with no audit event (hand-seeded as the old code could leave it) | the replay writes **one** `…_audit_reconciled`, **zero** `created`, and three more replays add nothing |
| FI-5b | a pending row created by **another path** (Admin create, own `collaborator.created` audit) with identical data | generic 409; **no** created/reconciled event written for it (review finding #1) |
| FI-6 | an API-created row within 30 s with no audit, then the same row aged to 2 min (age set by the **database** clock) | first a retryable **409 `MEMBER_AUDIT_PENDING`**, zero audit writes; once old enough the replay reconciles exactly once |
| FI-7 | the reconciliation write fails | 500 `MEMBER_AUDIT_FAILED`, nothing written/changed; after recovery exactly one event |
| FI-8 | replay of an already-audited application | no audit write at all |
| FI-9 | calling the functions directly with a wrong actor / Merchant / state / blank arguments (spaces, tab/newline, empty) / another path's row | `NOT_ALLOWED` / `NOT_ELIGIBLE` / `22023`; nothing written |
| FI-10 | `anon` / `authenticated` call over PostgREST; ACL, security mode and `search_path` read from the catalog | 401/403 **with SQLSTATE `42501`** (a wrong JWT secret would be `PGRST301` and does not satisfy it), nothing written; ACL = `service_role` only, `SECURITY INVOKER`, `search_path` pinned |
| FI-13 | **lock contract**: another session holds the per-e-mail lock with an *uncommitted* competing row | the API call waits (≥ 0.8 s measured), then sees the committed row and answers the generic 409; exactly one row; no audit written by us. Deterministic (waits until the holder really owns the lock); an unlocked implementation answers in ~25 ms and creates a second row |
| FI-14 | a `BEFORE INSERT` trigger makes the insert yield no row (what a hosted trigger could do) | whole call aborts: 500, **no orphan audit event**, nothing written (review finding #4) |
| FI-12 | **rollback drill** with the real script | functions gone, no row touched, API fails closed (create and replay), re-apply restores. Waits for PostgREST's schema cache to really settle (`PGRST202` from both functions; 5 consecutive successes after re-apply) |
| FI-11 | invariants after everything | every API-created application has exactly one `created` event; no event references a missing application; nothing deleted |

Fault injection is a trigger that raises (or swallows the row) for one action/e-mail; it exists only while a control runs and is always removed (`finally`). Counts are scoped to the run's own random Merchants, so nothing else writing to the shared rehearsal database can disturb a control.

### 4.4 Planted regressions (mutation testing) — each must be caught
Each regression was planted in a scratch copy (TypeScript) or applied to the disposable rehearsal database (SQL, restored by re-applying the migration); the integration suite was run; the original was restored and re-verified (`diff -r` identical). A mutant that did not compile or that Postgres rejected is reported as *bad* and does not count. The harness itself needed three corrections along the way (two invalid mutants; a false "caught" caused by residue from earlier mutants, which led to run-scoped assertions; an orphan-event assertion that read the whole database) — all fixed, and **the whole matrix was re-run on a database that accumulates every earlier mutant's residue**, followed by pristine passes.

| # | Planted regression | Caught by |
|---|---|---|
| S1 | audit insert removed from the create function (row committed without audit) | first create's audit-row control |
| S2 | advisory lock removed | FI-3 (and FI-13, deterministically) |
| S3 | `EMAIL_HELD` check skipped (duplicates allowed) | competing-row control |
| S4 | create function's actor/Merchant guard skipped | FI-9 |
| S5 | reconciliation writes a second `created` event instead of a distinct one | competing-row control |
| S6 | reconciliation repeats (no existing-event check) | idempotent-replay control |
| S7 | in-flight window removed | FI-6 |
| S8 / S9 | create executable by `authenticated` / reconcile by `anon` (ACL only) | FI-10 ACL assertion |
| S10 | reconcile eligibility skipped entirely | FI-5b |
| S11 / S12 | `SECURITY DEFINER` / `search_path` unpinned | FI-10 catalog assertions |
| **S13** | reconciliation no longer limited to rows this API created (**the review's Medium finding**) | FI-5b |
| **S14** | insert no longer `STRICT` (orphan audit event) | FI-14 |
| T1 | service swallows a failed reconciliation (replay 2xx with no audit) | FI-7 |
| T2 | service no longer reconciles on replay | competing-row control |
| T3 | service treats a lost race (`EMAIL_HELD`) as a fresh create | competing-row control |
| T4 | service leaks the database error text | FI-1 |
| T5 | non-atomic design restored (insert, then a separate audit call) | first create's audit-row control |
| **T6** | service answers 2xx for an in-flight (unaudited) replay again | FI-6 |

**20 / 20 caught; 0 missed.** S8/S9 are *not exploitable* behaviourally (the functions are `SECURITY INVOKER` and those roles have no table privileges, so PostgREST refuses the call anyway) — which is why the control reads the catalog ACL, and why the read-only `--members` privilege check is the guarantee for the live database.

### 4.5 Known failures that are NOT caused by this change
`test:d13a-contracts` (stale QR-payload assertion) and `test:email-delivery` (37 passed, 2 failed — the hook's signup/recovery message checks) fail identically on the deployed baseline `a384f48` (documented since before). Unchanged, not hidden.

## 5. Read-only tooling added
* `migration/v2/check-member-function-privileges.sql` + `check-function-privileges.mjs --members`: 20 read-only checks (one overload, explicit ACL, PUBLIC/anon/authenticated cannot execute, `service_role` can, no other grantee, `SECURITY INVOKER`, `search_path` pinned). Validated 20/20 on the rehearsal database, **5 FAIL** under a negative control (stray grants + `SECURITY DEFINER`), 20/20 after restore. Before the migration every row is a FAIL ("function not found") — the expected "not applied yet" state.
* `migration/v2/analyze-member-audit-gaps.mjs`: the analysis of §6. GET-only by construction (its only network primitive is `get()`), pinned to the live project host, reads no name/phone/bank field, hashes e-mails in memory. Validated on a rehearsal database with planted anomalies (it found exactly the two gap rows, the orphan event and the duplicate pair); its evidence file contains no `@`.

## 6. Existing production data — read-only analysis (2026-11-11T02:31Z, GET-only)
Evidence: `migration/v2/evidence/members-audit-reconciliation-20261111/summary.json` (identifiers and counts only; kept uncommitted like other evidence).

| Question | Result |
|---|---|
| Rows in `collaborators` | 384 (status: `0` 312 · `active` 57 · null 10 · `pending` 3 · `blocked` 2); 377 linked to a login; 4 carry a `merchant_system_id` |
| **Any application created through the Members API?** | **No.** 0 rows with its code shape (`COL` + 7 hex); **0** `collaborator.member_application_created` events of any kind; 0 reconciliation events |
| Applications needing audit reconciliation | **0** Members-API applications. (The reconciliation path is therefore preventive; nothing in production needs repair.) |
| Orphan audit events / entities with >1 created event | 0 / 0 |
| Pending rows per Merchant | maximum **1**; none near the cap (40 / 50) |
| Creation history (rate-limit sizing) | none — no creation has ever been recorded |
| Duplicate e-mails (case-insensitive) | **3 groups of 2 rows** (6 of 384). None involve Members-API rows; none have two pending rows; one spans two Merchant links. Row identifiers are in the evidence file. |

**One row needs an owner decision (nothing was changed):** `COL-05C60E056C3D4B5B` (id `a71ce95a-f99c-4195-b5a5-df90ab47171f`) — pending, unverified, has a `merchant_system_id`, no login, registered 2026-10-31T16:30Z, **same e-mail as the active, login-holding Partner `COL-D600ABC8D5C2C528`**, and no audit event. Its code shape (`COL-` + 16 hex) is that of Partner registration / Admin create / the retired Partner route, not of the Members API, so it is not a Members-audit gap; it looks like a leftover of the 2026-10-31 release testing. Options for the owner: leave it; or have an authorised Admin reject/deactivate it through the governed Admin flow. No deletion is proposed.

## 7. Assessment for the following release

### 7.1 Database uniqueness constraint on the e-mail
* **What exists now:** the new function serialises concurrent *calls of itself* per e-mail across instances (proven by control FI-13). It does **not** serialise any writer that takes no lock — the previous API during a rolling deploy, Partner registration, Admin create — and it is a check, not a constraint. **Reproduced** by the independent review and by me: a session inserting the same e-mail without the lock while the function runs yields two rows. The old post-insert convergence (which deleted the loser's own row) is gone, so such a duplicate is not self-healed. Practical exposure today is nil (no Members creation has ever been recorded) but this is a real residual, and only a unique index closes it.
* **Can a unique index be created today?** A full `unique (lower(collaborators_email))` — **no**: 3 duplicate groups block it. A *partial* index `where collaborators_status = 'pending'` — **yes** (no group has two pending rows) but it would not stop the dangerous case (a pending row duplicating an **active** Partner's e-mail, exactly the production row in §6).
* **Needed before a full index:** an owner decision per duplicate group (non-destructive options: governed Admin deactivate/reject; no automatic merge), then `create unique index concurrently` (cannot run inside the migration's transaction ⇒ its own controlled step) and a `unique_violation` handler in the function mapping to `EMAIL_HELD`. NULL e-mails are unaffected by a unique index.
* **Recommendation: appropriate for the following release, conditional on resolving the 3 groups.** Not a prerequisite for this remediation. Interim partial index: optional, low value.

### 7.2 Durable throttling
* **What exists now:** per-Merchant sliding windows in process memory (10/h, 40/day) — reset by every restart/deploy and multiplied by the replica count (1 today) — plus a database-counted pending cap of 50 that is **not atomic with the insert** (concurrent creations for *different* e-mails can overshoot it by the concurrency, bounded by the rate limit).
* **Evidence of need:** none today — no Members creation has ever been recorded (§6). The exposure is a future abuse by a compromised *active, verified* Merchant account.
* **Best option:** count `created` audit events per Merchant in the last hour/day **inside `create_merchant_member_application`, under a per-Merchant advisory lock**, together with the pending-cap check. That is durable across restarts and replicas, atomic with the insert, needs no new table (the `(action, occurred_at)` index exists) and removes the cap overshoot. It changes semantics slightly (replays would no longer consume the quota). Alternatives (a counter table; an external store) add moving parts for no gain.
* **Recommendation: appropriate for the following release**, together with 7.1; keep the in-process limiter as a cheap first line. Low urgency.

## 8. Observations outside this scope (not changed)
1. The same "write, then audit in a second call" pattern exists at **31** call sites (`audit.record`: merchants 9, collaborators 9, invitations 5, media 3, user-profiles 2, partner-registration 1, auth 1, activation 1). The money-moving flows already write their audit inside database functions. A prioritised inventory is recommended; no change here by instruction.
2. The pending cap and the rate limits are not atomic with the insert (§7.2).
3. During the rolling deploy the old API instance keeps its non-atomic behaviour for the overlap; with zero recorded Members usage the practical exposure is nil.
4. Pre-existing, found by the review, not caused by this change: Partner registration and Admin create de-duplicate e-mail with no lock and no unique index (Admin create also stores it un-normalised); the Partner code is 28 bits of randomness with no uniqueness check, so a duplicate QR code is possible (a unique index on `collaborators_code` belongs with 7.1); a Merchant can pre-claim any e-mail with a pending row (mitigated by the generic 409 and the rate limits); `toLowerCase()` runs before the ASCII e-mail regex, so `Kelvin@x.vn` (Kelvin sign) is accepted and stored as `kelvin@x.vn`.
5. The `23505` code-collision retry in the service is unchanged and still not exercised by a test (the rehearsal schema has no unique index on the code).

## 9. Independent review
### 9.1 Hand-off brief for Codex (the designated independent reviewer)
**Review the code commit `44968407818b49f3bee5a350c06dcf82da0d2975` against `a384f48`:** `git diff a384f48 4496840 -- backend/src supabase migration backend/scripts`. Do not rely on this document's conclusions; the following reproduces every claim from a clean export.

```
git archive 4496840 | tar -x -C /tmp/cand && cd /tmp/cand
(cd backend && npm ci && npm run build && npx tsc --noEmit && npx eslint src)         # 0 errors, 1 existing warning
bash migration/v2/rehearsal/start-rehearsal-stack.sh                                   # disposable Postgres 17 + PostgREST v14.5 (loopback; applies EVERY migration incl. the new one)
(cd backend && npm run test:merchant-members)                                          # unit: 34 controls
(cd backend && npm run test:rehearsal-merchant-members)                                # integration: 34 controls  (VNO_REHEARSAL=1 is set by the script)
PATH=/opt/homebrew/opt/libpq/bin:$PATH node migration/v2/check-function-privileges.mjs --rehearsal --members     # 20 / 20
# reproduce the defect on the deployed code: a384f48's backend/src + this commit's integration test
git archive a384f48 backend | tar -x -C /tmp/old && cp backend/scripts/integration-merchant-members.ts /tmp/old/backend/scripts/ && (cd /tmp/old/backend && npm ci && VNO_REHEARSAL=1 VNO_CONTINUE_ON_FAIL=1 node -r ts-node/register/transpile-only scripts/integration-merchant-members.ts)   # 12 controls FAIL (also copy supabase/migrations and migration/v2/rollback into /tmp/old so FI-12 can read them)
```
**Where I would push hardest** (these are the places I am least able to prove from here):
1. *Hosted vs rehearsal.* The functions were never run on the hosted database; the rehearsal baseline is a reconstruction. Anything in the hosted `collaborators` / `audit_events` / `user_profiles` / `merchant_details` (extra NOT NULL columns, triggers, RLS/force-RLS, check constraints, a unique constraint on `collaborators_code`) that would make the function behave differently from the REST inserts it replaces.
2. *What the advisory lock does not cover.* Other writers of `collaborators_email` (Partner registration, Admin create, the retired route) take no lock; the check inside the function is not a constraint.
3. *The 30-second `IN_FLIGHT` grace and the reconciliation event.* Can a legitimate sequence produce a misleading event, or leave a permanent gap? (Clock: `registered_date` is `now()` for new rows but was the app clock for rows written by `a384f48`.)
4. *Fail-closed vs availability.* A missing/renamed function turns every create **and every replay** into a 500. Is that the right trade (it was a deliberate choice: a 2xx must imply an audit trail)?
5. *Whether the tests could pass vacuously* (the fault-injection trigger, the two-instance races, the invariants in FI-11, the catalog ACL assertions).
6. *Anything that still lets a row exist without its creation audit event, or an event without its row.*

### 9.2 Supplemental review by a fresh-context Claude agent (NOT a substitute for Codex)
A fresh-context agent was given the diff and the intended property **without my conclusions**, and a disposable schema to attack. I re-verified each claim myself on the database before acting (rolled-back transactions / two real sessions). Full report: `06-fresh-context-review.md` in the evidence folder.

| # | Reviewer severity | Finding | Verified by me | Disposition |
|---|---|---|---|---|
| 1 | **Medium** | `reconcile_…` eligibility was too broad: an Admin-created pending row (own `collaborator.created` audit) tagged to the Merchant, resubmitted by the Merchant with identical data, received a false "creation audit missing" event and was returned to the Merchant as a replay | **Reproduced** on the real functions (outcome `RECONCILED`, both events side by side) | **Fixed**: only rows with the Members code shape are eligible; others ⇒ `NOT_ELIGIBLE` ⇒ generic 409. Control FI-5b; mutants S10, S13 |
| 2 | Low (Medium during deploy overlap) | the advisory lock serialises only callers of the function; unlocked writers can create a duplicate; the old convergence is gone; the header/commit overstated this | **Reproduced** (two sessions ⇒ two rows) | **Cannot be fixed without a unique index** (§7.1). Wording corrected in the migration, the service and the commit message; FI-13 pins down what the lock *does* guarantee; the residual is stated in §3, §7.1 and offered for the owner's acceptance |
| 3 | Low | `IN_FLIGHT` answered 2xx with no audit trail, contradicting "a 2xx always implies an audit trail"; a future-dated row stayed in-flight forever | Confirmed (FI-6 asserted that 201) | **Fixed**: retryable 409 `MEMBER_AUDIT_PENDING`; the window is now ±30 s. FI-6; mutants S7, T6 |
| 4 | Low (depends on hosted triggers) | an `INSERT` that yields no row left a committed audit event with a NULL entity and returned `CREATED` with null fields | **Reproduced** | **Fixed**: `INTO STRICT`. FI-14; mutant S14. Hosted trigger/index precheck added to the runbook |
| 5 | Info | function-level validation weaker than its message (tabs/newlines pass; e-mail stored raw) | Confirmed | **Fixed** (blank checks include tab/CR/LF; the normalised e-mail is stored). FI-9 |
| 6 | Info | cap / identity check / limiters are outside the transaction and lock | Agreed — unchanged by design | Documented (§7.2, §8); next release |
| 7 | Low | tests weak, stale or flaky: trivial race control and stale title; FI-3/4 timing-dependent; FI-10 would pass for a wrong JWT secret; global counts; Node-clock vs VM-clock; FI-12 drops functions mid-suite; code-collision retry unexercised; unit tests cover only the parsers | Confirmed | **Fixed**: honest titles; deterministic FI-13; FI-10 requires SQLSTATE `42501`; run-scoped counts; ages set by the DB clock. **Accepted**: FI-12 on the disposable DB (documented), the `23505` retry (§8.5), parser-only unit tests |

The review's "checked and found sound" list (rollback of both inserts on audit failure; the lock holding a second session ~3 s then `EMAIL_HELD`; ACL; return shapes; lock keys and no deadlock order; no PII in audit/errors; rollback script; ordering; no double write) is recorded in the full report.

**While fixing these I found and fixed three weaknesses in my own tests** (a typo-class mistake in the first mutation harness, a pollution-driven false "caught", and a global orphan-event assertion that a genuine mutant residue could break); they are described in §4.4.


## 10. Proposed release (for the owner's decision — NOT authorised, NOT executed)
1. Codex review with no open High/Medium finding.
2. Owner approves **(a)** the schema change and **(b)** push + deploy of the candidate HEAD.
3. Owner applies the migration per §3; prechecks, 20/20 privilege check, write-free smoke test, fingerprint diff.
4. Claude pins **API only** to the candidate HEAD (Web is unchanged: `frontend/` is byte-identical to the deployed one), verifies SUCCESS, `/health` 200, exact `meta.commitHash`; runs the **write-safe** hosted checks only: specs `102` (N6 sends an *invalid* body, N5 an *empty* one), `00-unauth`, then the 52 approved safe cases. **No Members creation test on the live system.**
5. Codex verifies. Rollback references: API `77d16db1-7620-4ce6-a0af-9cc55a5a3675` at `a384f48` (re-stage); the functions may stay in place.

## 11. Recommendation
These are three **separate** recommendations. None is an approval; each needs the owner's decision.

### 11.1 The atomicity remediation (this change: migration + API) — **GO, conditional**
*Why GO:* the root cause is reproduced on the deployed code and removed by a transaction; 34 integration controls (including fault injection, two-instance races, a lock-contract test, a rollback drill) pass on a clean export, 20 of 20 planted regressions are caught, and a fresh-context review's Medium finding was reproduced, fixed and pinned by a test. The change is additive (two functions), reversible without data loss, and *production has never recorded a Members creation* (§6), so there is nothing to repair and no user is affected while it is scheduled.
*Conditions (all must hold; any failure ⇒ NO-GO for that step):*
1. **Codex's independent review has no open High/Medium finding** (§9.1 lists where I would push hardest).
2. The owner approves the **schema change on the live environment** and the push + deploy of the candidate HEAD (nothing here was authorised).
3. The **hosted prechecks** of §3 step 1 show no unexpected trigger, extra `NOT NULL` column or unique index on `collaborators` / `audit_events`. This is the one thing the rehearsal cannot prove.
4. After applying: `check-function-privileges.mjs --members` = **20 / 20**, and the write-free smoke test returns `NOT_ALLOWED` for both functions — *before* the API is deployed.
*Residuals the owner accepts by approving:* (a) a lock-free writer can still create a duplicate e-mail until the unique index of 11.2 exists (reproduced, practical exposure nil today); (b) the first real Merchant creation will be the first hosted execution of the insert path — production member-creation tests are not authorised, so it fails closed (500, nothing persisted) if the hosted schema differs; (c) the guards listed in §8.
*Urgency:* low to moderate — a latent defect in a feature nobody has used. It can be scheduled; it is not an incident.
*NO-GO triggers:* any anomaly in the prechecks; privilege check < 20/20; a Codex High/Medium; the schema change not approved.

### 11.2 Database uniqueness constraint (next release) — **NO-GO to apply now; GO to prepare**
Three existing duplicate-e-mail groups (6 of 384 rows) block a full unique index, and a partial (pending-only) index would not cover the dangerous pending-duplicates-an-active-Partner case. Prepare it as its own release: owner decisions on the 3 groups (non-destructive, through the governed Admin flow), `create unique index concurrently` as a separate controlled step, a `unique_violation` handler mapping to `EMAIL_HELD`, and (optionally) a uniqueness constraint on `collaborators_code`. Not a prerequisite for 11.1.

### 11.3 Durable throttling (next release) — **GO to design and bundle with 11.2; not needed for 11.1**
Count `created` events per Merchant in the last hour/day and the pending cap **inside the create function under a per-Merchant advisory lock**: durable across restarts and replicas, atomic with the insert, no new table. There is no usage data to size it from (no creation has ever occurred), so the current 10/hour, 40/day and 50 values stay until real usage exists. Low urgency.

### Decisions the owner will need to make
1. Approve (or not) the schema change and the release of §10 after Codex's review.
2. Accept the residuals above.
3. What to do with the pending row `COL-05C60E056C3D4B5B` (§6): leave it, or have an authorised Admin reject/deactivate it through the governed flow.
4. Whether to commission the inventory of the other 31 write-then-audit call sites (§8.1) and the 11.2 duplicate-group clean-up.

