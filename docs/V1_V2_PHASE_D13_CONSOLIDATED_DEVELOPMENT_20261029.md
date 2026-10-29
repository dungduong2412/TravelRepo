# VNO V2 — Phase D13 Consolidated Development

Date: 2026-10-29
Branch: `codex/vno-phase-d4-security`
Base / D12 candidate: `25be5b55dac27e087e3cba833a08500371bf40e3`
Railway UAT baseline: `1d6198369d9dd4fa9253c2a11a24bf6a991e36d5`
External changes: **none**

## 1. Integrated result

The local candidate now provides one coherent, three-role application flow:

- verified Supabase email signup before a Merchant or Collaborator application is bound;
- restricted pending-applicant profile editing and private media proposals;
- independent Admin application and media decisions, including rejection/resubmission;
- active Merchant/Collaborator identity, approved-media and historical-report access;
- Merchant-only Collaborator QR resolution;
- an explicitly isolated **UAT simulation** transaction command with exact financial arithmetic and durable idempotency;
- Admin, Merchant and Collaborator reporting of the same synthetic transaction;
- no payment, settlement, payout, confirmation, cancellation or imported-history mutation command.

This is not represented as a production-equivalent V1 payment engine. V1 actor/transition, cancellation, numbering and settlement semantics remain unproven. The simulation is visibly and structurally separated from imported V1 history.

## 2. Onboarding and authorization

| State | Own application/profile | Own private media | Active operations | Admin decision |
|---|---:|---:|---:|---:|
| email unverified | denied | denied | denied | none |
| verified, not submitted | may submit matching-email application | denied until bound | denied | none |
| pending | read/write allowed fields | propose/read/cancel pending | denied | approve/reject application and media separately |
| blocked | read/correct/resubmit | read decision history | denied | review resubmission |
| active | role-scoped | propose replacement; approved media stays effective | allowed by role | moderate future media independently |

The backend verifies `email_confirmed_at`, normalized email equality and identity uniqueness through Supabase Auth before binding a business row. Public Admin-created confirmed-user bypasses were removed. Admin approval also rechecks that the linked Auth identity is confirmed.

Merchant onboarding covers owner/store contacts, tax code, description, 0–3 categories and preserved text geography fields. Collaborator onboarding covers name, contact and private banking metadata. Commercial rates are not applicant-controlled.

Pending or rejected media never becomes effective. Existing approved media remains effective until an Admin approves a replacement. The applicant status component shows application/media states, rejection reasons, resubmission and safe cancellation of a pending proposal.

## 3. Hosted UAT Auth requirements

These settings are required before browser UAT and were not changed locally:

1. Email/password signup enabled with email confirmation required.
2. Site URL: `https://vno-web-uat.up.railway.app`.
3. Redirect allowlist:
   - `https://vno-web-uat.up.railway.app/merchant/onboard?confirmed=1`
   - `https://vno-web-uat.up.railway.app/collaborator/onboard?confirmed=1`
   - `https://vno-web-uat.up.railway.app/reset-password`
4. Approved UAT-only custom SMTP sender/domain and VNO confirmation/recovery templates; link tracking must not rewrite Auth links.
5. Bounded signup/recovery limits and HTTP 429 treated as a wait condition.
6. Leaked-password protection enabled if available on the project plan.
7. Only approved disposable UAT identities; no imported-customer activation or email.

The browser draft excludes passwords and uses session storage. Opening confirmation on another device/browser can require re-entering non-secret profile fields; this remains a browser-acceptance item.

## 4. Financial model and UAT simulation

Canonical percentage rates are stored/calculated as fractions. UI forms display percentage points. Missing and historical values are not defaulted or rewritten.

The sealed 102-row V1 transaction source independently reconfirmed:

- document total: `377705162.0000`;
- discount total: `24077880.8000`;
- commission total: `27466958.1000`;
- discount equals `round4(gross × source discount rate)` for 102/102;
- commission equals `round4(gross × source commission rate)` for 102/102.

The simulation RPC requires:

- an active verified Merchant and assigned active verified Collaborator;
- a positive gross amount with at most four decimal places;
- reviewed percentage rates in fractional `[0,1]` form;
- a UUID idempotency key unique per Merchant.

It writes `record_kind='uat_simulation'`, `simulation_status='OPEN'`, `legacy_status=NULL`, `payment_status='unverified'`, `external_settlement_enabled=false`, an append-only creation event and an audit event in one database transaction. Identical retries return the original row. Reusing a key with changed input fails. The UI labels this as a UAT simulation, shows the database-calculated values and never presents it as paid or settled.

No confirm, cancel, pay, settle, payout or external-payment route exists. The historical V1 states OPEN, CONFIRMED, CANCELED and PAID remain read-only evidence, not an inferred transition permission.

## 5. Proposed additive migrations

Neither migration was applied to shared UAT.

| Migration | Purpose | SHA-256 |
|---|---|---|
| `20261027030914_vno_phase_d13a_fractional_rate_guard.sql` | validate only new/changed percentage rates as fractions without rewriting historical rows | `b8a97723461e291dfb872f8303a4fd027ce2b60b214ac29d87412b9cb2760750` |
| `20261028142324_vno_phase_d13_integrated_uat_simulation.sql` | separate UAT simulation provenance, private transaction events, exact/idempotent RPC | `bce2330791ce4447d2bdffd1e78b1d4bc547c7f423f270b1c3f1b2485a7acf09` |

The second migration is additive and rerunnable: guarded columns/constraints/indexes/table plus `create or replace function`. New event data has RLS enabled, no `anon` or generic `authenticated` access, and service-role-only grants. Existing transaction rows receive only the non-destructive `v1_import` discriminator default; source statuses and amounts are unchanged. Constraints are `NOT VALID` where historical validation would otherwise rewrite or block accepted records.

## 6. Acceptance evidence

| Gate | Result |
|---|---:|
| D13 simulation database migration/engine | **PASS**, transaction rolled back |
| Integrated QR → transaction → three-role report | **16/16 PASS** |
| Exact test amount `1234.5678` | discount `123.4568`; commission `61.7284` |
| Duplicate identical request | same transaction, replay flag true |
| Conflicting idempotency reuse | HTTP 409 |
| Admin/Collaborator transaction creation | HTTP 403 |
| confirm/cancel/pay/settle endpoints | HTTP 404 |
| D13A onboarding/application/media | **25/25 PASS** |
| Password/magic-link/recovery identity + effective media | **30/30 PASS** |
| Authorization controls | **35/35 PASS** |
| D6 workflows | **22/22 PASS** |
| D10 financial/Merchant | **14/14 PASS** |
| D10B category boundaries | **11/11 PASS** |
| D12 QR/mobile/privacy | **14/14 PASS** |
| D13A/backend contracts | **37/37 PASS** |
| Media failure/cleanup | **8/8 PASS** |
| Backend typecheck/lint/build | **PASS** |
| Frontend typecheck/build | **PASS**, 36 routes |
| Frontend lint | **PASS**, 0 errors and 17 pre-existing warnings |
| Backend/frontend production audits | **0 vulnerabilities** each |
| Backend Docker build | **PASS** |
| Frontend Docker build with Railway-style public build args | **PASS** |

The D12 session test is now self-contained: when no effective persona media exists, it creates scoped temporary fixtures, verifies signed-byte retrieval for password/magic-link/recovery sessions, and removes the exact rows/objects it created.

## 7. Rehearsal and source preservation

The D13 migration was applied only to the preserved local Docker rehearsal for the API test, then fully removed. The test-created simulation/audit/media data and temporary rate values were removed. Final counts returned to:

- 102 referral transactions;
- 367 audit events;
- 618 media metadata rows;
- 618 Storage objects;
- original null D2 synthetic commercial rates;
- no `transaction_events` table or D13 simulation columns/function in the rehearsal.

The sealed snapshot was read only. No live V1 connection, shared-UAT import, Auth mutation, Storage mutation, migration, Railway change, push, notification, settlement or cutover occurred.

## 8. Remaining blockers and release recommendation

**GO for local consolidated release-candidate preparation.** The code and proposed migrations are coherent and locally verified.

**NO-GO for immediate shared-UAT browser execution or deployment** until the two exact migrations are reviewed/applied through controlled UAT gates, hosted Auth/SMTP/redirect/leaked-password settings are verified, and the application is pushed/staged/deployed through an explicit release gate.

**NO-GO for production financial use.** The UAT simulation must remain disabled outside isolated/UAT contexts. Production-equivalent transaction transitions, document numbering, cancellation/reversal and the meaning of `PAID` require separate evidence and owner approval. No settlement capability is present.
