# VNO V2 Phase D6 — Business Functional Parity

Date: 2026-10-17 (Asia/Ho_Chi_Minh)
Branch: `codex/vno-phase-d4-security`
Starting release: `0ab5519c75b302fa7dbe1ca6efb4fe8aa990658b`
Scope: local implementation and isolated local Supabase rehearsal only
Decision: **PASS for code review; NO-GO for production import**

## Executive result

The known application-level D6 gaps are implemented locally. Platform Admin now has centralized Merchant, Collaborator and user lifecycle operations; authorization assignments are governed by database-backed role checks and audited. Merchant and Collaborator profile/member flows use aligned API contracts. All three roles have authorized transaction and commission history views. Private media upload, listing and signed retrieval enforce owner scope, supported MIME signatures and a 5 MiB application limit while retaining compatibility with the existing migration media model.

The isolated rehearsal passed 20 schema/contract assertions, the existing 35 authorization controls, and 22 D6 functional controls. Backend and frontend typechecks, lint commands and production builds passed. Runtime dependency audits report zero vulnerabilities. The frontend's full development dependency audit now reports five high-severity findings in the lint-only `eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch -> braces` chain; `npm audit` proposes a forced breaking tooling downgrade, so no blind change was made.

This is not authorization to import production records. The additive migration has not been applied to hosted UAT, the candidate has not been pushed or deployed, deployed end-to-end scenarios require separate approval, and hosted leaked-password/SMTP controls remain unverified. No V1 system was accessed. No hosted Supabase, Railway, production data, DNS, Auth identity or Storage object was changed.

## Functional-parity matrix

| V1-required capability | Current V2 implementation | D5 gap closed | Verification evidence | Status / remaining blocker |
|---|---|---|---|---|
| Centralized Merchant management | Admin list/filter/detail, pending creation, governed edit, approve, reject and soft deactivation | Added Admin create/edit contract and UI lifecycle controls; delete no longer removes the record | D6 Admin pending-create control HTTP 201; existing Admin route guards; build includes `/admin/merchants` | PASS locally; deployed UAT pending |
| Centralized Collaborator management | Admin list, pending creation, governed edit/merchant association, approve, reject and soft deactivation | Added Admin create/update/deactivate contracts and UI lifecycle controls | D6 Admin pending-create control HTTP 201; build includes `/admin/collaborators` | PASS locally; deployed UAT pending |
| User listing/account lifecycle | Admin directory can change role, status and role-appropriate business assignment | Replaced read-only user UI; added Admin get/update endpoints and account-state synchronization | Admin role/assignment HTTP 200; inconsistent assignment HTTP 400; self-deactivation HTTP 400 | PASS locally |
| Role assignment/revocation | Database profile is authoritative; Merchant/Collaborator assignment is mutually exclusive and role-bound | Added strict DTO validation, Auth metadata synchronization and rollback on sync failure | 35/35 authorization controls; self-verification denials; D6 `NOT VALID` checks enforce new writes | PASS locally; existing legacy rows still require explicit reconciliation before constraint validation |
| Activation/deactivation | Admin lifecycle status synchronizes profile, business link and Auth app metadata; Merchant/Collaborator deactivation is non-destructive | Added active/pending/inactive/blocked management and safe soft deactivation | Admin lifecycle functional controls and contract assertions pass | PASS locally |
| User-to-business relationships | Admin assigns exactly one role-appropriate Merchant or Collaborator; Merchant links are reconciled | Added entity existence checks and `merchant_user_links` reconciliation | Valid assignment HTTP 200; invalid combination HTTP 400 | PASS locally |
| Authorization guards and audit trails | AdminGuard remains database-backed; all privileged lifecycle operations write `audit_events`; Admin has bounded audit read | Added Audit module and event writes for Merchant, Collaborator and user lifecycle actions | Audit event query HTTP 200; non-Admin Admin endpoint HTTP 403 | PASS locally |
| Merchant profile maintenance | Self-service DTO contains only Merchant-owned descriptive/contact/address fields; financial, verification and status fields are Admin-only | UI and backend now use the same `merchant_*` contract; owner email and governed fields are read-only | Contract assertions pass; self-verification request HTTP 400 | PASS locally |
| Collaborator profile maintenance | Self-service DTO contains identity/contact/bank/follow-up fields; governed status, rating and verification are Admin-only | Removed privileged fields from public/self contracts and payloads | Contract assertions pass; self-verification request HTTP 400 | PASS locally |
| Referral/member workflows | `/merchants/members` and `/collaborators/members` list/create within the authenticated Merchant team and create pending identities | Restored both missing frontend endpoints | Merchant and Collaborator scoped list/create controls all pass; cross-scope Admin impersonation denied | PASS locally |
| Transaction history | Admin sees all; Merchant sees its linked transactions; Collaborator sees its own history including preserved merchant-orphan rows | Replaced report placeholders with role-scoped history UI | Linked ownership and orphan preservation controls pass | PASS locally |
| Commission views | Same scoped source as transactions; precise stored amount, percent, payment state and lifecycle state are displayed | Added Admin and role-scoped financial history views | Existing scoped `/commissions` controls plus production frontend build pass | PASS locally |
| Legacy status fidelity | `legacy_status`, `lifecycle_status` and `payment_status` remain distinct and are shown without inferring payment/settlement | Added raw legacy status to backend selection and an explicit UI warning | Orphan test retains numeric legacy status `17`; no settlement mapping introduced | PASS locally |
| Orphan transactions | Nullable Merchant relationship is preserved; Collaborator ownership still grants authorized history access | Added UI/API coverage without fabricating a Merchant | Admin and Collaborator see the synthetic orphan; Merchant does not | PASS locally |
| Private Merchant media | Owner-scoped upload to `merchant-media`, metadata persistence, list and short-lived signed retrieval | Added upload/list endpoints and profile media manager | Upload/list/signed retrieval controls pass; cross-role retrieval HTTP 403 | PASS locally |
| Private Collaborator media | Owner-scoped upload to `partner-media` using the same validation/retrieval model | Added shared role-aware media workflow and profile media manager | Schema, owner-resolution and Storage authorization tests pass | PASS locally; deployed object test pending |
| MIME/size/provenance controls | JPEG, PNG and WebP only; magic-byte validation; declared size and 5 MiB app limit; SHA-256 and original bucket/path/owner metadata retained | Replaced ungoverned base64 profile behavior | 20 contract assertions; byte-signature mismatch HTTP 400 | PASS locally |
| Legacy media compatibility | Uses existing private buckets and `media_assets` ownership/provenance schema; application limit applies only to new interactive uploads | No schema rewrite or destructive bucket change | Clean migration reset and media metadata integration pass | PASS structurally; complete 618-file migration remains a later import-stage check |
| Leaked-password protection | Project-level hosted Auth setting | No code path can authoritatively verify it | Supabase security-advisor query was permission-denied; no setting changed | BLOCKED: authorized Dashboard administrator must verify it is enabled |
| Hosted SMTP/recovery | Existing non-enumerating recovery UI remains; only approved UAT identities may be used | No retry was made after the prior HTTP 429 | Prior Admin/Merchant recovery requests were accepted; Collaborator remained rate-limited | BLOCKED: configure approved UAT SMTP and run one separately authorized delivery/completion test |
| Deployed three-role workflows | Candidate is locally verified | No deployment was authorized in D6 | Local builds and role suites pass | BLOCKED pending separate push/deployment approval and deployed UAT E2E |

## Additive migration proposed for hosted UAT

File: `supabase/migrations/20261016140546_vno_phase_d6_functional_parity.sql`

The migration is idempotent and additive. It does not drop, rename, truncate or rewrite data. It adds:

1. `NOT VALID` checks for allowed profile roles, allowed lifecycle states and exact role-to-entity assignment. PostgreSQL enforces them for new or updated rows while allowing known legacy rows to remain available for explicit reconciliation.
2. Partial indexes for `user_profiles.merchant_id`, `user_profiles.collaborator_id` and `collaborators.merchant_system_id`.
3. Merchant/date and Collaborator/date indexes for scoped transaction history.
4. Owner/date indexes for Merchant and Collaborator media.
5. Action/date indexing for the Admin audit trail.

The migration was applied successfully during a clean isolated Supabase reset together with the full repository migration chain. It remains **proposed only** for hosted UAT and must be reviewed before execution. No RLS was disabled and no anonymous or authenticated grants were added.

## Validation evidence

| Gate | Result | Evidence |
|---|---|---|
| Clean isolated schema application | PASS | Baseline and all migrations, including D6, applied from a clean local database |
| Backend D6 contracts | PASS | 20 assertions |
| Existing authorization regression | PASS | 35/35 controls |
| New D6 functional integration | PASS | 22/22 controls |
| Backend typecheck | PASS | `tsc --noEmit` |
| Backend lint | PASS | zero errors |
| Backend production build | PASS | `tsc` |
| Backend full dependency audit | PASS | zero vulnerabilities |
| Backend runtime dependency audit | PASS | zero vulnerabilities |
| Frontend typecheck | PASS | `tsc --noEmit` |
| Frontend lint | PASS WITH WARNINGS | zero errors; 14 non-blocking Next.js image/navigation warnings, including one new media-preview image warning |
| Frontend production build | PASS | Next.js compiled 30 routes, including `/admin/financials` |
| Frontend runtime dependency audit | PASS | zero vulnerabilities |
| Frontend full dependency audit | RISK ACCEPTANCE REQUIRED | five high-severity development-only findings in the lint glob chain; no production dependency exposure; forced suggested fix is breaking |
| Hosted leaked-password control | BLOCKED | Management/security-advisor access was not authorized for the connected account |
| Hosted SMTP and recovery completion | BLOCKED | Requires administrator SMTP configuration and one approved recipient-driven test after rate-limit recovery |
| Deployed UAT E2E | BLOCKED | Explicit deployment approval was not provided in D6 |

### D6 functional controls

The 22-control isolated suite verifies: Admin self-deactivation denial; non-Admin lifecycle denial; valid and invalid role/entity updates; audit persistence; safe Admin creation of pending Merchant and Collaborator entities without account activation; Merchant and Collaborator self-verification denial; scoped member lists and pending creation; inability to impersonate member scope; orphan and linked transaction visibility; raw legacy status retention; private upload/list/signed retrieval; cross-role media denial; and content-signature rejection.

The test harness hard-fails unless both Supabase and the backend use a loopback hostname. It creates synthetic local-only rows and removes them after the run.

## Security observations and residual risks

1. **Production runtime dependency exposure: none reported.** Both backend and frontend `--omit=dev` audits returned zero vulnerabilities.
2. **Development tooling advisory:** the frontend full audit reports five high findings through `eslint-config-next@16.4.0 -> @next/eslint-plugin-next@16.4.0 -> fast-glob@3.3.1 -> micromatch@4.0.8 -> braces@3.0.3`. The reported path is exercised by lint/build tooling, not the deployed application runtime. The available forced audit action would change to `eslint-config-next@14.2.35`; that breaking downgrade was not applied. Reassess when a compatible upstream fix is published or approve a focused tooling change separately.
3. **Hosted leaked-password protection:** an authorized administrator must open Supabase Dashboard for project `hsezyogfxgnkpweoqqny`, inspect Authentication password/security settings and record whether Leaked Password Protection is enabled. If disabled, enabling it is a separate project-level change requiring approval.
4. **Hosted SMTP/recovery:** configure the approved UAT sender, SPF/DKIM as applicable, redirect allowlist and recovery template. Then run exactly one recovery flow for an approved test identity. Do not retry an HTTP 429; wait for the documented limit window.
5. **Legacy profile rows:** the `NOT VALID` assignment constraint intentionally avoids silently discarding or rewriting existing ambiguous records. Reconcile those rows before validating the constraint in a later reviewed migration.
6. **Interactive upload limit:** the new 5 MiB limit protects UAT workflows but does not constrain the later controlled import of validated legacy objects, which uses the migration pipeline rather than this endpoint.

## Exact changed files

Application source and tests:

- `backend/package.json`
- `backend/scripts/test-d6-contracts.ts`
- `backend/src/app.module.ts`
- `backend/src/modules/audit/audit.controller.ts`
- `backend/src/modules/audit/audit.module.ts`
- `backend/src/modules/audit/audit.service.ts`
- `backend/src/modules/collaborators/collaborators.controller.ts`
- `backend/src/modules/collaborators/collaborators.dto.ts`
- `backend/src/modules/collaborators/collaborators.service.ts`
- `backend/src/modules/media/media.controller.ts`
- `backend/src/modules/media/media.dto.ts`
- `backend/src/modules/media/media.service.ts`
- `backend/src/modules/merchants/merchants.controller.ts`
- `backend/src/modules/merchants/merchants.dto.ts`
- `backend/src/modules/merchants/merchants.service.ts`
- `backend/src/modules/transactions/transactions.service.ts`
- `backend/src/modules/user-profiles/user-profiles.controller.ts`
- `backend/src/modules/user-profiles/user-profiles.dto.ts`
- `backend/src/modules/user-profiles/user-profiles.service.ts`
- `frontend/app/admin/collaborators/page.tsx`
- `frontend/app/admin/financials/page.tsx`
- `frontend/app/admin/layout.tsx`
- `frontend/app/admin/merchants/page.tsx`
- `frontend/app/admin/users/page.tsx`
- `frontend/app/collaborator/dashboard/layout.tsx`
- `frontend/app/collaborator/dashboard/members/page.tsx`
- `frontend/app/collaborator/dashboard/profile/page.tsx`
- `frontend/app/collaborator/dashboard/reports/page.tsx`
- `frontend/app/merchant/dashboard/layout.tsx`
- `frontend/app/merchant/dashboard/members/page.tsx`
- `frontend/app/merchant/dashboard/profile/page.tsx`
- `frontend/app/merchant/dashboard/reports/page.tsx`
- `frontend/components/FinancialHistory.tsx`
- `frontend/components/MediaManager.tsx`
- `migration/v2/prepare-rehearsal.sh`
- `migration/v2/test-authorization.mjs`
- `migration/v2/test-d6-functional.mjs`
- `supabase/migrations/20261016140546_vno_phase_d6_functional_parity.sql`

Reports:

- `docs/V1_V2_PHASE_D5_UAT_ACCOUNT_ACCEPTANCE.md`
- `docs/V1_V2_PHASE_D6_FUNCTIONAL_PARITY_20261017.md`

Generated tracked backend build artifacts refreshed by `npm run build`:

- `backend/dist/app.module.js`
- `backend/dist/app.module.js.map`
- `backend/dist/modules/collaborators/collaborators.controller.d.ts`
- `backend/dist/modules/collaborators/collaborators.controller.js`
- `backend/dist/modules/collaborators/collaborators.controller.js.map`
- `backend/dist/modules/collaborators/collaborators.dto.d.ts`
- `backend/dist/modules/collaborators/collaborators.dto.js`
- `backend/dist/modules/collaborators/collaborators.dto.js.map`
- `backend/dist/modules/collaborators/collaborators.service.d.ts`
- `backend/dist/modules/collaborators/collaborators.service.js`
- `backend/dist/modules/collaborators/collaborators.service.js.map`
- `backend/dist/modules/media/media.controller.d.ts`
- `backend/dist/modules/media/media.controller.js`
- `backend/dist/modules/media/media.controller.js.map`
- `backend/dist/modules/media/media.service.d.ts`
- `backend/dist/modules/media/media.service.js`
- `backend/dist/modules/media/media.service.js.map`
- `backend/dist/modules/merchants/merchants.controller.d.ts`
- `backend/dist/modules/merchants/merchants.controller.js`
- `backend/dist/modules/merchants/merchants.controller.js.map`
- `backend/dist/modules/merchants/merchants.dto.d.ts`
- `backend/dist/modules/merchants/merchants.dto.js`
- `backend/dist/modules/merchants/merchants.dto.js.map`
- `backend/dist/modules/merchants/merchants.service.d.ts`
- `backend/dist/modules/merchants/merchants.service.js`
- `backend/dist/modules/merchants/merchants.service.js.map`
- `backend/dist/modules/transactions/transactions.service.js`
- `backend/dist/modules/transactions/transactions.service.js.map`
- `backend/dist/modules/user-profiles/user-profiles.controller.d.ts`
- `backend/dist/modules/user-profiles/user-profiles.controller.js`
- `backend/dist/modules/user-profiles/user-profiles.controller.js.map`
- `backend/dist/modules/user-profiles/user-profiles.dto.d.ts`
- `backend/dist/modules/user-profiles/user-profiles.dto.js`
- `backend/dist/modules/user-profiles/user-profiles.dto.js.map`
- `backend/dist/modules/user-profiles/user-profiles.service.d.ts`
- `backend/dist/modules/user-profiles/user-profiles.service.js`
- `backend/dist/modules/user-profiles/user-profiles.service.js.map`

No generated secret or environment file was added.

## Release decision and next actions

**GO for owner review of the local D6 candidate.**
**NO-GO for production V2 import or cutover.**

Required sequence:

1. Review this code, migration and the development-only dependency risk.
2. If accepted, explicitly authorize pushing the candidate and deploying it to Railway UAT; review and apply the additive migration to Supabase UAT in the same controlled release.
3. Run the deployed Admin, Merchant, Collaborator and Storage end-to-end suite using synthetic UAT data only.
4. Verify leaked-password protection and complete the single approved hosted SMTP/recovery flow without retrying rate-limited requests.
5. Reconcile pre-existing legacy profile assignment exceptions, then separately decide whether to validate the `NOT VALID` constraints.
6. Produce a deployed D6 acceptance report. Only after those gates pass should production-import approval be reconsidered.

No push, deployment, production import or cutover is included in this candidate.
