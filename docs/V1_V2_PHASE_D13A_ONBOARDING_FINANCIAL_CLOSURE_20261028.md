# VNO V2 — Phase D13A Onboarding and Financial Workflow Closure

Date: 2026-10-28
Branch: `codex/vno-phase-d4-security`
Local base / D12 candidate: `25be5b55dac27e087e3cba833a08500371bf40e3`
Railway UAT baseline: `1d6198369d9dd4fa9253c2a11a24bf6a991e36d5`
Shared Supabase/Railway changes: **none**

## 1. Result

D13A closes the local application-side registration bypass and proves a restricted pre-approval onboarding model in the preserved isolated rehearsal. It also normalizes percentage-rate handling to canonical database fractions and supplies an additive database guard proposal. No transaction mutation was added because the V1 actor and transition rules remain unproven.

- **Registration UAT:** **NO-GO to execute now; conditional GO for release preparation.** The code is locally ready, but hosted email-confirmation, redirect, SMTP and security configuration must be reviewed, the proposed rate migration must be separately approved/applied, and the application must be deployed through its own gate.
- **Synthetic financial transaction UAT:** **NO-GO.** Exact formulas and stored states are proven, but order actors, state transitions, cancellation/reversal authority, document-number rules and the meaning of `PAID` remain unresolved. No speculative write API exists.

## 2. Registration state and authorization matrix

| State | Evidence / representation | Own profile | Own private media proposal | Active operations | Admin action |
|---|---|---:|---:|---:|---|
| Email unverified | Supabase Auth has no verified session | denied | denied | denied | none |
| Email verified, application not submitted | verified JWT/email only | may submit one matching-email application | denied until application exists | denied | none |
| Application `pending` | business row and `user_profiles` row are pending | read/write permitted fields | upload/read own pending proposals | denied | approve or reject application; decide media separately |
| Application `blocked` | business/profile blocked | read permitted; resubmit own application | read own private proposal/history; new upload remains denied until pending | denied | review resubmission |
| Application active, media pending | business/profile active; media proposal pending | allowed by role | allowed | allowed by role | approve/reject media |
| Application active, media approved | active business/profile; approved media effective | allowed by role | allowed | allowed by role | later replacement remains pending until decision |

The four concepts are separate:

1. Supabase email ownership verification.
2. VNO application decision (`pending`, `active`, `blocked`).
3. Operational activation through the application profile status.
4. Media decision (`pending`, `approved`, `rejected`, or preserved `legacy_effective`).

Application approval never marks an email verified. Media approval never activates an application. Pending applicants cannot access members, reports, QR operations or other active-business routes.

## 3. Email verification implementation

### Application changes

- Browser registration now calls `supabase.auth.signUp` and supplies an allowlisted `emailRedirectTo`.
- The public business APIs are no longer anonymous. A verified Supabase JWT is required.
- The backend checks the Auth user through the Admin API, requires `email_confirmed_at`, normalizes and matches the email, and rejects an existing profile/user binding.
- The backend no longer accepts registration passwords or public commercial rates.
- Generic user-profile creation and the legacy Admin backfill no longer create already-confirmed Auth accounts. Backfill links only an existing, confirmed Auth identity.
- Existing active UAT accounts and role mappings are not rewritten.

The isolated fixture uses `email_confirm: true` only to construct a verified local test identity without sending email. No runtime application code contains that bypass.

### Required hosted UAT settings (not changed)

Before registration UAT:

1. Keep email/password signup enabled and require email confirmation.
2. Set the UAT Site URL to `https://vno-web-uat.up.railway.app`.
3. Add exact redirect allowlist entries for:
   - `https://vno-web-uat.up.railway.app/merchant/onboard?confirmed=1`
   - `https://vno-web-uat.up.railway.app/collaborator/onboard?confirmed=1`
   - `https://vno-web-uat.up.railway.app/reset-password`
4. Configure an approved UAT-only custom SMTP sender/domain and confirmation/recovery templates. Disable provider link tracking that rewrites Auth URLs.
5. Set bounded signup/recovery email limits and CAPTCHA as appropriate. Treat HTTP 429 as a wait condition; do not retry repeatedly.
6. Enable leaked-password protection in Supabase Auth if the project plan exposes the setting. Its current hosted value was not changed or reasserted in this local-only phase.
7. Use only approved disposable test identities; do not invite or activate imported customers.

The confirmation callback returns to the role-specific onboarding page. Because the pre-confirmation profile form is not persisted across devices, an applicant may need to re-enter non-secret profile data after opening the confirmation link on another browser. This is a UX limitation, not an identity/security gap, and should be checked in browser UAT.

## 4. Pre-approval profile and media workflow

Merchant and Collaborator creation now binds the verified Auth user directly to a pending application profile. Pending owners may:

- read their own application;
- edit permitted non-commercial fields;
- create private media proposals;
- inspect their own proposal state and rejection reason;
- resubmit a blocked application.

They may not:

- use members, QR, financial, reporting or other operational endpoints;
- set their role, tenant or assignment;
- set Merchant discount/commission terms;
- publish pending/rejected media;
- read another owner’s private records or signed URLs.

The D10B media state machine and Admin-only decision path are reused unchanged. The self-contained D13A rehearsal demonstrated that pending media returns zero effective/public rows, while Admin application approval and Admin media approval are separate calls.

## 5. Financial-rate normalization

### Canonical rule

- Database, API and calculation representation: fractional rate in `[0,1]` for percentage types.
- UI representation: percentage points, explicitly labelled `%`.
- Exact conversion example: `10` UI percentage points ↔ `0.1000` stored fraction.
- `null` stays `null`; no missing rate receives a default.
- Fixed-value commercial terms are not subjected to the fractional percentage bound.

### Audited paths

| Path | D13A behavior |
|---|---|
| Public Merchant registration | no commercial fields accepted |
| Admin Merchant editor | displays percentage values as points; converts to fractions on write |
| Merchant profile display | multiplies stored percentage fraction by 100 only for presentation |
| Transaction/commission reports | displays rate fractions as percentage points; monetary amounts unchanged |
| V1 import | preserves source fractional values and nulls exactly |
| Existing rows | never rewritten by D13A |
| Future transaction creation | must snapshot canonical fractions; intentionally not implemented |

String-based conversion helpers avoid floating-point multiplication in form serialization. Backend DTOs reject changed percentage rates below `0` or above `1` while preserving fixed values and nulls.

### Proposed additive migration

File: `supabase/migrations/20261027030914_vno_phase_d13a_fractional_rate_guard.sql`
SHA-256: `b8a97723461e291dfb872f8303a4fd027ce2b60b214ac29d87412b9cb2760750`

The migration creates a trigger function and trigger on `merchant_details`. It validates only inserts or changes to the four commercial type/value fields. Therefore:

- new/changed percentage values must be fractional and within `[0,1]`;
- unrelated edits to a historical row are not blocked solely because an old commercial value exceeds the new rule;
- no row is updated, deleted, truncated or remapped;
- function execution is revoked from `PUBLIC`, `anon` and generic `authenticated`.

The migration was transactionally rehearsed against the isolated Docker database and rolled back. It was not applied to shared UAT.

## 6. Evidence-backed QR transaction specification

### Proven evidence

- Collaborators have a stable collaborator code usable as an authenticated lookup identity.
- The current D12 QR resolver is read-only and explicitly returns `financial_action_created: false`.
- The sealed V1 snapshot contains 102 transactions with raw states:
  - `0 = OPEN` (2)
  - `1 = CONFIRMED` (37)
  - `2 = CANCELED` (2)
  - `3 = PAID` (61)
- For all 102 transactions:
  - `discount_amount = round4(document_total × discount_rate)`;
  - `commission_amount = round4(document_total × commission_rate)`.
- Source rates are fractions. Existing totals reconcile exactly:
  - document: `377705162.0000`;
  - discount: `24077880.8000`;
  - commission: `27466958.1000`.
- One historical orphan relationship remains preserved.

### State/authorization matrix

| Transition/action | Stored-state evidence | Permitted actor | D13A decision |
|---|---|---|---|
| create `OPEN` | state exists | unresolved | blocked; not implemented |
| `OPEN → CONFIRMED` | both states exist | unresolved | blocked; not implemented |
| `OPEN/CONFIRMED → CANCELED` | states exist | unresolved; timing unresolved | blocked; not implemented |
| `CONFIRMED → PAID` | states exist | unresolved | blocked; `PAID` is not assumed to mean settlement |
| skip/reopen/reverse | no sufficient evidence | unresolved | blocked; not implemented |
| scan/retry | identity lookup proven only | authenticated Merchant may resolve identity; financial authority unresolved | resolver remains read-only |

The exact V1 QR wrapper, Merchant–Collaborator relationship requirement, order creator, confirmation authority, cancellation window, document numbering and payment meaning remain unresolved. Stored statuses are evidence of values, not proof of permissible transitions.

### Future safe write model (proposal, not implemented)

Any future transaction command requires:

- one database transaction/RPC;
- authenticated Merchant assignment and approved Collaborator identity;
- immutable gross amount and fractional rate snapshots using `numeric(18,4)`;
- a unique durable idempotency key;
- identical retries returning the original transaction, but conflicting payload reuse failing;
- immutable source/raw status plus a distinct V2 lifecycle field;
- append-only actor/from/to/request audit events;
- optimistic versioning or row locking for transitions;
- reversal records rather than destructive amount/status rewriting;
- no bank transfer, payout or settlement side effect.

## 7. Verification evidence

| Gate | Result |
|---|---:|
| D13A contract assertions | **28/28 PASS** |
| Isolated registration/onboarding/media lifecycle | **25/25 PASS** |
| Pending applicant denied active operations | **PASS** |
| Merchant/Collaborator application rejection/resubmission | **PASS** |
| Session refresh after verified signup | **PASS** |
| Onboarding financial-write delta | **0 transactions** |
| Isolated cleanup | **PASS**, tested table counts restored exactly |
| Fractional-rate migration rehearsal | **PASS**, transaction rolled back |
| D6 functional workflow | **22/22 PASS** |
| D6 contracts | **28/28 PASS** |
| D9 media failure/cleanup | **8/8 PASS** |
| Authorization controls | **35/35 PASS** |
| D10 financial/merchant | **14/14 PASS** |
| D10B category limits | **11/11 PASS** |
| D10B media approval | **22/22 PASS** |
| D12 QR/mobile/privacy | **14/14 PASS** |
| D12 migrated-application checks | **11/11 PASS** |
| Backend typecheck/lint/build | **PASS** |
| Frontend typecheck/lint/build | **PASS**, 36 routes; 17 existing warnings, 0 errors |
| Backend production audit | **0 vulnerabilities** |
| Frontend production audit | **0 vulnerabilities** |
| Backend Docker build | **PASS** |
| Frontend Docker build with explicit Railway-style public build arguments | **PASS** |

One order-dependent D12 media-session rerun was invoked after the D10B cleanup suite had removed its pre-seeded effective persona media, producing 12 fixture failures. Identity/session checks still passed. This was not accepted as proof either way; the new D13A suite is self-contained, creates its own proposals, proves publication boundaries, and restores all tested counts. The previously accepted self-contained D12 session run remains 30/30.

## 8. Snapshot and rehearsal preservation

Read-only reconciliation after the dependency/application changes remained exact:

- 148 Merchants;
- 270 Collaborators;
- 102 transactions;
- 272 Merchant-category links;
- 11,726 source rows;
- 1 orphan transaction;
- 618/618 media hashes, 416,329,553 bytes;
- financial totals exactly as listed above.

The sealed snapshot, manifest and preserved Docker rehearsal volume were not modified or re-imported. Temporary D13A records and objects were ownership-scoped and removed; tested counts returned to their starting values.

## 9. Changed scope

The local D13A work changes only:

- Merchant/Collaborator verified signup, pending onboarding, approval/resubmission and member-invitation contracts;
- pending-owner media authorization while retaining publication controls;
- rate presentation/conversion and Admin commercial editing;
- local contract, onboarding, rate-guard and financial verification tests;
- the additive fractional-rate migration proposal;
- this report.

The uncommitted D13 readiness report and financial verifier were preserved. No commit, push, Railway action, shared Supabase change, live V1 access, customer email, import, payment or cutover occurred.

## 10. Next gates

### Registration UAT

**Conditional GO for a reviewed release candidate; NO-GO for immediate browser execution.** Required sequence:

1. Review the D13A diff and migration checksum.
2. Approve/apply only the exact additive rate migration in Supabase UAT and verify history/schema/data invariants.
3. Configure and verify UAT email confirmation, exact redirects, custom SMTP, templates, rate limits and leaked-password protection.
4. Commit/push/stage/deploy through separate approvals.
5. Run one disposable Merchant and Collaborator browser journey, including confirmation, recovery, rejection/resubmission, pending media, Admin decisions and cleanup.

### Synthetic financial transaction UAT

**NO-GO.** The owner must first approve an evidence-backed actor/transition matrix, document-number rule, QR payload rule and precise meaning of `PAID`. Only then should an additive idempotent transaction/event schema and private transactional command be designed, reviewed and rehearsed.
