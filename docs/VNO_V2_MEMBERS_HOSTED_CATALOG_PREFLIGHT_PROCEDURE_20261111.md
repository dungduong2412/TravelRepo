# VNO V2 — Hosted catalog preflight for `20261111000001` (procedure)

**Purpose.** The migration `supabase/migrations/20261111000001_vno_merchant_member_atomic_create.sql` adds one function that inserts into `public.collaborators` and `public.audit_events` from inside the database. The rehearsal database is a faithful *reconstruction*; it cannot prove what the **hosted** tables look like. This preflight compares the hosted catalog with exactly what the function needs, **before** anything is applied. It is read-only and reads no personal data.

**Status.** Prepared, **not yet run against the hosted database**: running it needs the database password, which is not available to Claude Code (and must never be pasted into a chat). A *partial* result obtained without the password is in §6.

**Target.** Supabase project `hsezyogfxgnkpweoqqny` only (the tool stops if the linked project ref differs).
**Who runs it.** The owner, or a delegate holding the VNO database credentials, at a host terminal that already has `SUPABASE_DB_PASSWORD` exported — the same terminal discipline used for the earlier migrations.

## 1. Before you start
1. The checkout is the candidate commit: `git rev-parse HEAD` must equal the SHA in the hand-off message.
2. The tool files are unmodified: `shasum -a 256 migration/v2/preflight-members-catalog.sql migration/v2/preflight-members-catalog.mjs` must equal the values in §7.
3. `psql` is on `PATH` (Homebrew: `PATH=/opt/homebrew/opt/libpq/bin:$PATH`). `supabase/.temp/project-ref` contains `hsezyogfxgnkpweoqqny` and `supabase/.temp/pooler-url` exists (the project is linked, as for earlier migrations).
4. `SUPABASE_DB_PASSWORD` is exported **in that terminal only**. Do not pass it as an argument, write it into a file, or send it anywhere.

## 2. Run
```
cd migration/v2
PATH=/opt/homebrew/opt/libpq/bin:$PATH node preflight-members-catalog.mjs
```
The tool prints every **gate** (PASS / FAIL) and a handful of key inventory lines, and writes `migration/v2/evidence/members-catalog-preflight-<timestamp>/preflight.json` (mode 0600). Exit code 0 = every gate PASS; 1 = at least one FAIL, or the check could not run (then nothing was changed either).

## 3. Why it is safe (what the tool does and does not do)
* The session is opened with `default_transaction_read_only=on`, the SQL runs inside `begin read only … rollback`, and `statement_timeout` is 60 s. The database itself refuses any write.
* It reads **catalog metadata** (`pg_class`, `pg_attribute`, `pg_attrdef`, `pg_constraint`, `pg_index`, `pg_trigger`, `pg_policy`, `pg_proc`, `pg_roles`, `pg_event_trigger`, `pg_default_acl`, `pg_extension`), the registered migration versions, and **aggregates**: counts, one digest per table, and a yes/no for a few well-known identifiers. It prints **no row data**: no e-mail, phone, name or bank detail.
* The password reaches `psql` only through `PGPASSWORD`; any appearance of it in `psql`'s error text is replaced by `<redacted>` before printing; the evidence file contains no credentials. (The word *password* appears in the evidence only as the **column name** `collaborators_password`.)

## 4. Expected result and how to read it
**Expected:** `All gates passed. Nothing was changed.` and `N gates passed, 0 failed` (N depends on the hosted columns/sequences; 54 on the rehearsal).

| Gate (what a FAIL means) | If it FAILs |
|---|---|
| a table or a needed column is missing, has another type family, or a bounded `varchar` is shorter than the longest value the API can send (code 10 · name 120 · phone 16 · e-mail 254 · bank name 100 · account 20 · role 8 · action 38 · entity type 12 · entity id 36 · source 12) | the function would fail (22xxx / 42703) — stop, review |
| a `NOT NULL` column **without a default** that the function does not write | every insert would fail (23502) — stop |
| a `CHECK` constraint on `audit_events` mentions `action` / `entity_type` / `actor_role` / `source` | the new audit action could be rejected — read the constraint, then decide |
| a `UNIQUE` index/constraint covers `collaborators_email` | contradicts the recorded analysis (3 duplicate groups exist) — stop and re-check |
| an enabled `BEFORE INSERT` / `INSTEAD OF` trigger on `collaborators` or `audit_events` | it could rewrite or swallow the row (the function aborts safely, but the behaviour must be understood) — review the trigger text in the evidence |
| `service_role` lacks INSERT/SELECT on a table, does not bypass RLS, `authenticator` cannot become `service_role`, or lacks USAGE on a sequence | the function (SECURITY INVOKER, run by PostgREST as `service_role`) would be refused — stop |
| `create_merchant_member_application` or any `*merchant_member*` function already exists | the migration was already applied, or a clashing object exists — do not apply a second time |
| the advisory-lock prefix `vno:merchant-member-email:` is used by another function body | lock keys would collide — stop |
| duplicate `collaborators_code` values | the code-collision retry would misbehave — review |
| `20261111000001` already registered · prerequisite `20261109000001` not registered · a later version registered | wrong order / wrong database — stop |

**A FAIL is a stop-and-review, never an instruction to change anything.** Send `preflight.json` for review.

**Values to compare with the recorded facts** (all appear in the printed output):

| Fact | Recorded at 2026-11-11 (GET-only analysis) | Where |
|---|---|---|
| `collaborators` rows | 384 | `INFO collaborators: rows / by status` |
| groups of rows sharing a case-insensitive e-mail / rows in them | 3 / 6 | `INFO collaborators: groups …` |
| rows with the Members code shape `COL` + 7 hex | 0 | `INFO collaborators with the Members code shape` |
| `audit_events` creation events / reconciliation events | 0 / 0 | `INFO audit_events: rows / creation events …` |
| the preserved pending row `COL-05C60E056C3D4B5B` | present, pending, 0 audit events | `INFO the one pending row …` |
| digests of `collaborators` and `audit_events` | record them now | `INFO digest …` |

## 5. Re-run, and use it as the before/after record
* Run it again **immediately before** applying the migration (the catalog may change between runs) and treat only that run as the gate.
* Keep its two **digest** lines. After the migration is applied, run it again: the only differences must be (a) gate `create_merchant_member_application does not exist yet` now FAILs (expected: the function exists), (b) the migration history gains `20261111000001` once the owner registers it, (c) digests change **only** if unrelated business writes happened in between (compare row counts, then investigate). A change that cannot be explained by independent activity is a stop.
* After applying, the privilege check is `node migration/v2/check-function-privileges.mjs --members` (read-only) and must show **11 passed, 0 failed**.

## 6. What is already known without the password (partial, GET-only)
`migration/v2/rest-schema-probe.mjs` sends **one GET** to the project's REST root and reads PostgREST's published schema. Result at 2026-11-11 (evidence: `migration/v2/evidence/members-audit-atomicity-20261111-rev2/hosted-rest-schema-probe/`, schema metadata only):

* **33 PASS, 0 FAIL, 1 UNRESOLVED.** All four tables are exposed; every column the function writes or reads exists with the right type family; every bounded length is large enough; `collaborators` has **no** NOT NULL column without a default beyond the ones the function writes (`id` defaults to `gen_random_uuid()`); `audit_events` `occurred_at` defaults to `now()` and `source` to `v2`.
* `create_merchant_member_application` is **not** callable (migration not applied) and there is no other `*merchant_member*` function. The 9 callable functions are the existing transaction/media/category ones.
* **UNRESOLVED:** `audit_events.id` is a `bigint NOT NULL` with no default visible over REST — what an identity column looks like (PostgREST does not publish identity defaults). The deployed `AuditService` inserts without it and the table holds many rows, so it is very likely an identity column; only the catalog preflight proves it.
* **Not visible over REST at all, therefore still open until this preflight runs:** constraints, indexes, triggers, RLS and policies, privileges and role attributes, functions outside the exposed schema, event triggers, the migration history.

## 7. Integrity of the tool
```
shasum -a 256 migration/v2/preflight-members-catalog.sql migration/v2/preflight-members-catalog.mjs migration/v2/rest-schema-probe.mjs
da40ead7545d17fe07c7b0166834fabbe4a7a4f058dbc75791052af7b6c03e75  migration/v2/preflight-members-catalog.sql
32c5acb48a6e6ae8adb621689c6e6f78692b859f5f083e98179b2eba264fcdf8  migration/v2/preflight-members-catalog.mjs
f5c8e461b222c05b66809a72e2863c3145b74cc168b0a6b8d3b68d2e45501e70  migration/v2/rest-schema-probe.mjs
```
