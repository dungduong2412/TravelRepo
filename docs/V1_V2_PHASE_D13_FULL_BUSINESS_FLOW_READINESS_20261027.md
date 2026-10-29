# VNO V2 — Phase D13 Full Business Flow Readiness

Date: 2026-10-27
Local branch: `codex/vno-phase-d4-security`
Local D12 candidate: `25be5b55dac27e087e3cba833a08500371bf40e3`
Railway UAT release: `1d6198369d9dd4fa9253c2a11a24bf6a991e36d5`
Decision: **NO-GO for a registration-to-commission browser test**

## 1. Executive result

The deployed D11 release can accept pending Merchant and Collaborator applications, Admin can approve the business entities and accounts, and the governed private-media workflow works after an owner can authenticate. The local D12 candidate adds the Merchant recovery/magic-link identity fix and a permission-checked, read-only Collaborator QR resolver.

It does **not** implement a complete registration-to-commission flow. The blocking findings are:

1. Public registration creates an Auth user with `email_confirm: true`; it does not prove ownership through Supabase email verification.
2. Pending Merchant and Collaborator applicants cannot authenticate, so they cannot complete their business profiles or submit media before Admin approval.
3. The deployed release has no Merchant QR scan route/API. D12 has QR identity resolution locally, but it deliberately creates no transaction.
4. There is no transaction create, confirm, cancel or reversal API and no database idempotency key for a V2 order.
5. Source evidence proves the V1 status meanings and exact monetary formulas, but not which actor may create/confirm/cancel/pay or the allowed transition graph.
6. V1 commercial rates are fractional (`0.1000` means 10%). Current public Merchant registration accepts percentage-point inputs and the UI appends `%` to the raw stored value. This is a 100× ambiguity and must be resolved before creating financial records.

No shared UAT row, Auth identity, Storage object, migration, Railway configuration or V1 system was changed during D13.

## 2. Deployed and local identity

Railway read-only inspection found both UAT services healthy and running D11 SHA `1d6198369d9dd4fa9253c2a11a24bf6a991e36d5`:

| Service | Health/evidence | Release |
|---|---|---|
| `vno-api` | `/health` HTTP 200 | `1d619836...` |
| `vno-web` | `/login`, `/merchant/onboard`, `/collaborator/onboard` HTTP 200 | `1d619836...` |
| Merchant QR page | `/merchant/dashboard/qr-scan` HTTP 404 | absent from deployed D11 |
| QR resolver | anonymous `POST /qr/resolve` HTTP 404 | absent from deployed D11 |
| Transaction mutation | anonymous `POST /transactions` HTTP 404 | no create route |

There was no staged Railway patch. Local HEAD is D12 candidate `25be5b55...`, one commit ahead of the deployed release.

The Supabase management connection was read-only attempted but is not currently authorized for project introspection (`-32600 permission denied`). No alternate privileged connection or write mechanism was attempted. Therefore this report relies on accepted aggregate UAT evidence for the latest Storage/media baseline and does not claim a fresh live database count.

## 3. End-to-end readiness matrix

| Journey step | Deployed UAT | Local D12 | Classification | Evidence / gap |
|---|---|---|---|---|
| Merchant self-registration | Route and public create API exist | same | **Incomplete** | Creates pending Merchant and pending profile, but also Admin-creates an already-confirmed Auth identity. Form lacks full owner/category/location/media data and lets the applicant propose commercial rates. |
| Merchant email verification | not implemented | not implemented | **Incomplete / security blocker** | `auth.admin.createUser(... email_confirm: true)` bypasses verification; no verified-email claim/bind step. |
| Merchant onboarding/profile persistence | partial | improved after login | **Incomplete** | Pending applicant cannot authenticate to finish categories, complete geography or upload media before approval. D12 profile improvements apply only after login. |
| Merchant Admin approval | implemented | implemented | **Ready in deployed UAT** | Approval activates Merchant and linked profile; authorization controls previously passed. |
| Merchant gallery upload/approval | implemented after activation | implemented with recovery-session identity fix | **Deployed core; D12 session fix not deployed** | Private pending upload, Admin decision, effective-media publication, rejection preservation and cross-owner denial passed the priority media test. |
| Collaborator self-registration | route and public create API exist | same | **Incomplete** | Creates pending entity/profile and confirmed Auth user; cannot upload avatar before approval. |
| Collaborator email verification | not implemented | not implemented | **Incomplete / security blocker** | Same server-side confirmation bypass as Merchant. |
| Collaborator Admin approval | implemented | implemented | **Ready in deployed UAT** | Approval activates entity/profile and generates a QR image from the stable Collaborator code. |
| Collaborator avatar approval | implemented after activation | implemented | **Ready with sequencing limitation** | Governed media works, but not in the requested pre-approval order. |
| Merchant/Collaborator login | active accounts work | D12 additionally fixes recovery/magic-link Merchant identity | **Password ready; recovery fix local only** | Pending accounts are intentionally rejected. D12 six role/session combinations passed locally. |
| QR generation/display | deployed Collaborator QR exists | same plus mobile UX | **Ready for identity only** | QR contains the stable Collaborator code; no bank/contact data. Exact V1 wrapper/URI format remains unverified. |
| Merchant scans QR | absent (404) | authenticated Merchant-only resolver | **Implemented locally, not deployed** | D12 accepts raw code or `/c/{code}`, returns sanitized identity/association, and explicitly reports `financial_action_created:false`. |
| Synthetic order creation | absent | absent | **Blocked by business rule + schema** | No POST/create command, durable idempotency key, rate snapshot contract or actor rule. |
| Discount/commission calculation | read-only historical display | read-only historical display | **Formula proven; mutation blocked** | Exact V1 formulas proven, but rate representation is inconsistent in current V2 inputs/UI. |
| Confirm/cancel/reverse order | absent | absent | **Blocked by unresolved V1 actor/transition rules** | Status meanings are known; permitted transitions and actors are not. |
| Three-role transaction/report reconciliation | historical reads implemented | historical reads implemented | **Ready for existing records only** | Admin/Merchant/Collaborator scoped GET reports and exact totals pass; no newly created V2 order can be exercised. |
| Duplicate scan/commission prevention | no financial action to duplicate | QR resolution is read-only/idempotent | **Incomplete** | Existing behavior cannot duplicate money, but durable idempotency for a future write does not exist. |
| Synthetic cleanup | targeted patterns exist | same | **Not executed** | A full journey was not started because its financial half is unavailable and shared UAT database introspection is currently unauthorized. |

## 4. Registration and media findings

### Registration contract

`POST /merchants` and `POST /collaborators` are public. Each service inserts a pending business entity, then calls `UserProfilesService.createOrUpdate` with a plaintext password supplied over the request. That service creates an Auth user through the server-side Admin API and sets `email_confirm: true`. The application profile remains pending until Platform Admin approval, but the email address itself has not been proven.

Required replacement design:

1. Browser calls Supabase Auth `signUp` using an allowlisted UAT callback and an approved disposable address.
2. Only after a verified Auth session exists may the browser submit or claim a pending business application.
3. The backend binds the application to `auth.uid()` only when the normalized verified Auth email matches the application email.
4. Admin approval activates the role/business assignment; it does not manufacture email verification.
5. Rate-limited email behavior is surfaced without retries or account enumeration.

This needs an additive registration/application model or an equivalent transactional claim mechanism. Reusing the current business row is possible only if claim state, verified Auth ownership and Admin approval are represented separately and race-safe.

### Profile/media sequencing

The requested sequence requires media before final entity approval. Current authorization requires an active role/profile to use owner media endpoints. Choose one explicit rule before implementation:

- **Recommended:** email-verified applicants receive a restricted `onboarding` session that can edit only their pending application and upload private pending media; operational/reporting routes remain denied until Admin approval.
- Alternative: Admin approves the account first, then the owner completes profile/media. This does not match the requested journey and weakens the value of pre-approval review.

The existing D10B media state machine remains suitable: pending objects are private, existing effective media remains active, only Platform Admin decides, rejection preserves the previous effective asset, and approved/`legacy_effective` media alone is returned as effective.

## 5. Verified V1 transaction evidence

Source: sealed Phase D1 `snapshot-3`; no live V1 connection was opened. The aggregate-only verifier is `migration/v2/verify-d13-financial-rules.mjs`.

| Evidence | Result |
|---|---:|
| Transactions | 102 |
| Source status `0 = OPEN` | 2 |
| Source status `1 = CONFIRMED` | 37 |
| Source status `2 = CANCELED` | 2 |
| Source status `3 = PAID` | 61 |
| Document total | `377705162.0000` |
| Discount total | `24077880.8000` |
| Commission total | `27466958.1000` |
| `discount = round4(document total × source discount rate)` | 102/102 |
| `commission = round4(document total × source commission rate)` | 102/102 |
| `commission = round4((document-discount) × rate)` | only 15/102; rejected as general rule |

Rates in the source are fractions: for example `0.1000` produces 10% of the document total. The most common source rates are `0.1000` and `0.0500`. Import currently preserves those values exactly, which is correct for losslessness. The V2 presentation/input contract must therefore either:

- store canonical fractions and multiply/divide by 100 only at UI/API boundaries; or
- add explicit unit/version fields and migrate only V2-created commercial settings, never altering imported source values.

The first option is recommended. Public registration must not set commercial terms; these are Admin-governed and should remain null until reviewed.

### Proven and unproven rules

Proven:

- Stable Collaborator code exists and is suitable as the private lookup identity after authentication.
- V1 status meanings are OPEN, CONFIRMED, CANCELED and PAID.
- Discount and commission use the gross document total and source fractional rate.
- Existing historical orphan and raw statuses must remain unchanged.

Not proven and therefore blocked:

- who creates an OPEN order;
- whether Merchant or Collaborator confirms it;
- who may cancel and until which state;
- whether PAID represents customer payment, commission settlement, or another lifecycle event;
- whether any transition may skip a state;
- the exact V1 QR wrapper and whether the QR itself carried an order or only a Collaborator identity;
- document numbering rules for new V2 orders.

No payment or bank-transfer action should exist in D13. `PAID` must not be used as evidence of settlement authority.

## 6. Required code and database changes

These are proposals only; no migration was created or applied.

### Authentication/onboarding

- Replace public Admin-created confirmed users with Supabase Auth signup/verification plus authenticated application claim.
- Add a pending-application state that is separate from email verification and operational activation.
- Add restricted onboarding guards permitting only own pending profile/media operations.
- Remove commission/discount fields from public Merchant registration; expose them only to Platform Admin.
- Add tests for duplicate normalized email, replayed claim, mismatched email, unverified session, rejected application and concurrent approval.

Suggested additive fields/table:

- `registration_applications(id, role, normalized_email, auth_user_id, merchant_id, collaborator_id, status, email_verified_at, submitted_at, decided_at, decided_by, decision_reason, version)`;
- a partial unique constraint for an active application per normalized email/role;
- no `anon` table grants; service-role backend access only;
- a tightly scoped authenticated claim RPC or backend transaction that validates `auth.uid()` and the verified Auth email.

### Financial command model

Additive requirements for `referral_transactions` or an adjacent V2-order table:

- `origin` (`v1_import` or `v2`), immutable;
- `idempotency_key`, unique for V2 writes;
- Merchant-scoped `document_number` uniqueness for V2 records;
- `created_by_user_id` and rate-source metadata;
- immutable fractional `document_discount_rate` and `commission_rate` snapshots;
- optimistic `status_version`;
- cancellation/reversal reason, actor and timestamps;
- an append-only `transaction_events` audit table containing from/to state, actor, request/idempotency key and exact monetary snapshot.

Use a single database transaction/RPC for scan-to-order creation. It must authenticate the Merchant assignment, lock the rate source, calculate `numeric(18,4)` amounts in PostgreSQL, insert the transaction and audit event, and return the existing row on an identical idempotency replay. A reused key with different input must fail. Keep the RPC private, revoke `PUBLIC`/`anon`/generic `authenticated`, and call it only through the role-checking backend.

Do not implement confirm/cancel/reverse transitions until the owner supplies or approves the actor/transition matrix. No settlement RPC or external payment integration is required or authorized.

## 7. Local acceptance and preservation results

Current D13 verification:

| Gate | Result |
|---|---:|
| Backend typecheck/lint/build | PASS |
| Frontend typecheck/lint/build | PASS; 36/36 routes, 17 existing warnings, 0 errors |
| Backend production dependency audit | 0 vulnerabilities |
| Frontend production dependency audit | 0 vulnerabilities |
| D6 contract assertions | 28/28 PASS |
| Media failure/cleanup | 8/8 PASS |
| Aggregate V1 financial formula verification | 102/102 PASS for discount and gross-total commission formulas |
| Preserved D11 rehearsal | PASS |

Accepted unchanged D12 evidence remains:

- D11 functional controls 132/132;
- D12 QR/mobile/privacy 14/14;
- migrated-application checks 11/11;
- password/magic-link/recovery media sessions 30/30;
- tenant rows 148 Merchants, 270 Collaborators, 102 transactions and 272 category links;
- one orphan transaction preserved;
- 618/618 media hashes, 416,329,553 bytes;
- exact financial totals shown above.

The preserved Docker rehearsal was queried read-only and remains intact. The sealed snapshot and manifest were not modified or re-imported.

## 8. Exact future UAT procedure

Run only after the authentication/rate/idempotency changes are reviewed, migrated to isolated UAT, deployed, and the unresolved actor/transition decisions are approved.

1. Record Railway SHA/deployment IDs and Supabase project ref. Assert no Production values.
2. Capture exact counts and ID-set hashes for Auth users, profiles, Merchants, Collaborators, applications, transactions, events, media rows and both Storage buckets. Capture financial totals at four decimals.
3. Allocate one test-run UUID and two approved disposable plus-address identities. Use small JPEG/PNG/WebP fixtures with recorded size/SHA-256.
4. Register Merchant through Supabase signup. Verify that an unconfirmed email cannot claim the application and that no duplicate Auth/profile/business row is created.
5. Complete the confirmation callback once. Claim the Merchant application, persist owner/store/category/geography data, and confirm commercial terms remain null and non-editable to the applicant.
6. Upload Merchant hero/gallery proposals. Confirm private pending state and that anonymous/other-role signed URL requests fail. Admin sets fractional commercial rates, reviews the application/media and approves. Verify effective ordering.
7. Repeat signup/verification/claim for Collaborator. Persist allowed private banking metadata, upload avatar, approve application/avatar, and verify QR payload contains only the stable code.
8. Login both roles using password and one recovery/magic-link path; refresh the browser and verify own profile/effective media.
9. Merchant scans the Collaborator QR. Verify the resolver returns the intended Collaborator and Merchant association without private data.
10. Submit one synthetic order with a new UUID idempotency key and exact decimal document total. The database computes discount and commission from locked fractional rate snapshots.
11. Replay the identical request/key and require the same transaction ID with no new transaction, event or commission. Replay the key with a changed amount and require conflict.
12. Apply only the owner-approved confirm/cancel/reverse transitions. Verify every denied actor/state combination and append-only audit history. Do not test settlement.
13. Reconcile Admin, Merchant and Collaborator views to the same transaction ID, source/V2 status, document total, discount and commission. Verify cross-owner reads/writes fail.
14. Capture after counts, totals, ID-set hashes, Storage inventory and audit events. The expected delta is exactly the documented synthetic entities/assets/order/events.
15. Cleanup only records bearing the test-run UUID and only in dependency-safe order after ownership proof. Retain audit evidence if policy requires it. Re-run counts/hashes/totals and require the accepted prestate, with any intentionally retained audit delta documented.

## 9. Decisions required from the owner

1. Confirm the recommended onboarding model: verified email → restricted pending onboarding → Admin approval → active role.
2. Confirm that only Platform Admin sets Merchant discount/commission terms and that canonical storage uses fractional rates.
3. Supply or approve the transaction actor/transition matrix for OPEN, CONFIRMED, CANCELED and PAID.
4. Confirm the V2 document-number rule and whether the Collaborator QR represents identity only.
5. Clarify the business meaning of PAID; do not equate it to commission/bank settlement without evidence.

## 10. Recommendation

**NO-GO for full browser-based registration-to-commission UAT.** Registration, media, QR identity resolution and historical reporting are useful partial capabilities, but the requested journey would currently bypass email verification, cannot submit media in the requested order, and has no safe financial write path. The rate-unit mismatch alone can produce materially wrong money.

**GO for a bounded D13 implementation-design gate** once the five owner decisions above are supplied. That gate should produce one reviewed additive migration and application candidate, prove the transaction RPC under concurrency in the isolated rehearsal, then request separate approval for UAT migration/deployment and the synthetic browser test.
