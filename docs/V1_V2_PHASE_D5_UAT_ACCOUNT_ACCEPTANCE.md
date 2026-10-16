# VNO V2 Phase D5 — UAT Account Provisioning and RBAC Acceptance

Date: 2026-10-16 (Asia/Ho_Chi_Minh)
Scope: Railway `uat` and Supabase project `hsezyogfxgnkpweoqqny` only
Release: `0ab5519c75b302fa7dbe1ca6efb4fe8aa990658b`
Decision: **NO-GO for Phase D5 UAT acceptance**

## Executive result

All three approved UAT identities now have active, database-backed application profiles. The new Merchant and Collaborator identities did not previously exist and were created without changing unrelated Auth users or business records. Their synthetic business records are linked to the correct profiles, and one synthetic referral transaction provides positive evidence for tenant-scoped transaction and commission reads.

The deployed three-role authorization model passes: the earlier Admin test and the new Merchant/Collaborator tests confirm correct role login, own-record access, Admin API denial for non-Admins, profile RLS isolation, role/tenant mutation denial, private-table denial and unrelated-merchant denial. Temporary test credentials were invalidated after the checks.

Phase D5 remains **NO-GO for functional acceptance** because the application still has material UI/API gaps: Admin user/role lifecycle management is read-only in the UI, referral/member screens call missing API routes, Merchant profile editing does not match the backend update contract, and no application media-upload workflow exists. Custom SMTP and leaked-password protection remain unverified. The Merchant recovery request was accepted; the Collaborator recovery request remains rate-limited after one bounded retry.

No V1 access occurred. No V1 data was imported. No production environment, DNS, code, commit, push or deployment was changed.

## Environment evidence

| Item | Result | Evidence |
|---|---|---|
| Railway API health | PASS | `GET https://vno-api-uat.up.railway.app/health` returned HTTP 200. |
| Railway web health | PASS | `GET https://vno-web-uat.up.railway.app/login` returned HTTP 200. |
| Deployed login UI | PASS | The deployed page rendered email/password controls, Merchant and Collaborator registration choices, and a recovery link. |
| Deployed recovery UI | PASS | `/forgot-password` rendered a non-enumerating recovery form linked to the reset workflow. |
| Release identity | PASS | Local checked-out release remained `0ab5519c75b302fa7dbe1ca6efb4fe8aa990658b` on `codex/vno-phase-d4-security`. |

## Account provisioning status

| Role | Status | Result |
|---|---|---|
| Platform Admin | CREATED; ACTIVATION PENDING USER ACTION | `dungduong2412@gmail.com` was absent from both Supabase Auth and `user_profiles`. One Auth identity and one active `admin` profile were created. `user_id` matches, and both tenant-link fields are null. No hard-coded email bypass was added. |
| Merchant test identity | CREATED; RECOVERY PENDING USER ACTION | `dungduong2412+merchant@gmail.com` was absent from Auth, profiles and merchant records. One Auth identity, one active Merchant profile and one synthetic merchant were created. The recovery API returned HTTP 200. |
| Collaborator test identity | CREATED; RECOVERY RATE-LIMITED | `dungduong2412+collaborator@gmail.com` was absent from Auth, profiles and collaborator records. One Auth identity, one active Collaborator profile and one synthetic collaborator were created. The recovery API returned HTTP 429 on the initial request and one bounded retry. |

Every role test used an in-memory generated credential only. Credentials and tokens were never printed or persisted, and both new temporary credentials were rotated after testing. The Admin and Merchant recipients can complete the accepted recovery flows; the Collaborator recipient must request recovery after the Supabase email limit resets.

Synthetic UAT identifiers:

- Merchant ID: `9ea93d89-a8a1-4c11-8b07-4c3d8eb590da`; code: `UAT-M-D5-20261016-A4722D`.
- Collaborator ID: `c7076e03-43dd-411a-b9d9-18222363a581`; code: `UAT-C-D5-20261016-A4722D`.
- The collaborator's merchant association points to the synthetic Merchant ID above.
- Referral transaction ID: `8c4b2dc3-2c58-4b71-95b6-7b3cb4e0adff`; document number: `UAT-D5-20261016-A4722D`.
- The synthetic transaction contains `100000.0000` VND document total, `5000.0000` VND discount, and `10000.0000` VND unverified commission. It is explicitly tagged `uat_synthetic` and must never be included in production migration reconciliation.

Post-provisioning inventory:

- Supabase Auth users: 18.
- Application profiles: 17.
- Active profiles: 3 Admin, 2 Merchant and 4 Collaborator.
- UAT business records: 15 merchants, 15 collaborators and 1 explicitly synthetic referral transaction.
- Profiles with null status: 2 Admin and 6 Collaborator; these cannot pass the backend's `active` profile checks.
- Auth identities without a profile: 1 pre-existing email identity, created 2025-12-31, confirmed, never signed in, and carrying no declared application role.
- Invalid role-to-business-record links: 0.
- Duplicate target Admin identities: 0.

## Authentication test results

| Test | Status | Evidence |
|---|---|---|
| Admin deployed login | PASS | `POST /auth/login` returned HTTP 201 with role `admin` using the bounded in-memory credential. |
| Incorrect password | PASS | The same deployed endpoint returned HTTP 401. |
| Token lifetime | PASS WITH NOTE | Issued JWT lifetime was 3,600 seconds. Elapsed-time expiry was not waited out; the configured lifetime was verified from the signed token claims. |
| Logout | PASS | Supabase global logout returned HTTP 204; the previously issued token was then rejected by the deployed Admin endpoint with HTTP 401. |
| Temporary credential disposal | PASS | After rotation, the test credential was rejected with HTTP 401. |
| Password recovery request | PASS WITH USER ACTION | Supabase accepted one recovery request for the approved Admin address with HTTP 200 and the deployed reset path. Inbox delivery and link completion require the administrator. |
| Merchant login | PASS; RECOVERY PENDING | Deployed `POST /auth/login` returned HTTP 201 with role `merchant`. Wrong-role login returned HTTP 401. The temporary credential was invalidated; recovery returned HTTP 200. |
| Collaborator login | PASS; RECOVERY RATE-LIMITED | Deployed `POST /auth/login` returned HTTP 201 with role `collaborator`. Wrong-role login returned HTTP 401. The temporary credential was invalidated; recovery returned HTTP 429. |

## Authorization and RLS test results

| Test | Status | Evidence |
|---|---|---|
| Unauthenticated Admin API denial | PASS | `GET /user-profiles` returned HTTP 401 without a bearer token. |
| Admin user directory | PASS | Deployed `GET /user-profiles` returned HTTP 200 and 15 rows. |
| Admin merchant directory | PASS | Deployed `GET /merchants` returned HTTP 200 and 14 rows. |
| Admin collaborator directory | PASS | Deployed `GET /collaborators` returned HTTP 200 and 14 rows. |
| Admin transaction access | PASS AT ADMIN TEST TIME | The earlier deployed Admin test returned HTTP 200. A later synthetic UAT transaction now exists. |
| Admin commission access | PASS AT ADMIN TEST TIME | The earlier deployed Admin test returned HTTP 200. A later synthetic UAT commission now exists. |
| Admin media metadata access | PASS, EMPTY DATA | Deployed `GET /media` returned HTTP 200 and zero rows. |
| Own-profile RLS read | PASS | Direct authenticated REST read returned exactly one row, the caller's profile. |
| Cross-profile RLS read | PASS | Direct authenticated REST read of the profile collection returned only that same one row. |
| Role/tenant-link self-mutation | PASS | A same-value probe covering `role`, `merchant_id` and `collaborator_id` returned HTTP 403. The migration grants authenticated users update rights only to `full_name`. |
| Server-side Admin check | PASS | `AdminGuard` requires database role `admin` and status `active`; the frontend is not the authority. |
| Merchant own business record | PASS | `GET /merchants/{synthetic-id}` returned HTTP 200 and the linked Merchant ID. |
| Collaborator own business record | PASS | `GET /collaborators/me` returned HTTP 200 and the linked Collaborator ID. |
| Merchant transaction/commission scope | PASS | `/transactions/me` returned the one linked synthetic transaction; `/commissions/me` returned one transaction and `10000.0000` commission. |
| Collaborator transaction/commission scope | PASS | `/transactions/me` returned the one linked synthetic transaction; `/commissions/me` returned one transaction and `10000.0000` commission. |
| Unrelated merchant denial | PASS | Both Merchant and Collaborator tokens received HTTP 403 for a different merchant's private detail endpoint. |
| Merchant/Collaborator denied Admin APIs | PASS | Each role received HTTP 403 from `/user-profiles`, `/merchants`, `/collaborators`, `/transactions`, `/commissions` and `/media`. |
| Merchant/Collaborator direct private-table denial | PASS | Direct Data API access to `referral_transactions` returned HTTP 403 for both roles. |
| Merchant/Collaborator profile isolation | PASS | Each token saw exactly one `user_profiles` row and it matched the authenticated `user_id`. |
| Merchant/Collaborator role and tenant mutation | PASS | Direct attempts to write `role`, `merchant_id` or `collaborator_id` returned HTTP 403 for both roles. |

The application backend uses the Supabase service role for domain queries only after validating the caller's JWT and database-backed profile. Direct browser access to private domain tables is revoked from `anon` and `authenticated`; tenant scoping is implemented in the backend services. The three-role deployed authorization evidence now covers Admin, Merchant and Collaborator. It does not close the separate missing-UI/API functionality described below.

## Admin management capability matrix

| Required capability | API | Admin UI | Acceptance |
|---|---|---|---|
| View all merchants | Present and deployed | Present | PASS |
| Search merchants | No query/search contract | Only status filters; no text search | FAIL |
| Create merchant | Public onboarding endpoint exists | No Admin create flow | FAIL |
| View merchant details | Present and deployed | Present | PASS |
| Edit merchant profile | PATCH exists, but its DTO uses legacy `business_*` fields while the record/UI use `merchant_*` fields | No Admin edit form | FAIL |
| Approve/reject/deactivate merchant | Present | Present | PASS BY REVIEW; no existing record was mutated during this non-destructive run |
| View collaborators | Present and deployed | Present | PASS |
| Manage collaborators | Approve/reject/update/delete endpoints exist | Approve/reject and QR viewing exist; no general Admin edit/deactivate UI | PARTIAL |
| View users | Present and deployed | Present | PASS |
| Assign/change roles | Admin create/update service can change a profile role | No UI | PARTIAL; API path not exercised against an existing identity to avoid overwrite |
| Activate/deactivate users | No dedicated lifecycle endpoint | No controls | FAIL |
| View merchant/collaborator associations | Link fields exist on profiles | No association view | FAIL |
| View transactions | Admin endpoint present and authorized | No Admin transaction page | PARTIAL |
| View commissions | Admin endpoint present and authorized | No Admin commission page | PARTIAL |
| Prevent privilege escalation | Backend guard plus RLS/grants | Frontend cannot override backend | PASS |

## Merchant, Collaborator and media capability findings

1. The Merchant profile UI submits `merchant_name`, contact/address, commission and discount fields, but `UpdateMerchantSchema` accepts a different legacy `business_*` field set plus status fields. Zod strips the unsupported fields, so the intended Merchant profile update is not a working end-to-end contract.
2. Merchant and Collaborator "Người Theo Dõi" pages call `/merchants/members` and `/collaborators/members`. Neither route exists in the deployed controllers. Referral/member dashboards therefore cannot be accepted.
3. Collaborator own-profile read is verified through `/collaborators/me`; the update route has owner-or-Admin enforcement. No field update was required for provisioning, so UI editing remains a separate functional test.
4. Transaction and commission scoping exists in `/transactions/me` and `/commissions/me`, but no Merchant or Collaborator UI exposes these records in the reviewed release.
5. Media metadata listing and five-minute authorized signed URLs are implemented. There is no application upload endpoint. Current profile screens convert images to base64 fields instead of uploading to the private Storage buckets and persisting `media_assets` metadata. Authorized media upload is therefore not accepted.
6. Merchant and Collaborator layouts use `localStorage` role hints for navigation. A missing role hint routes an authenticated user toward `/admin`, but the Admin layout and backend subsequently re-check the database profile. This is a UX/routing defect, not an observed privilege bypass.

## Security and configuration

| Control | Status | Evidence / blocker |
|---|---|---|
| No credential exposure | PASS | No generated password, refresh token, access token, service key or recovery link was printed or written to the report/repository. |
| Password policy in application | PASS BY CODE | Account-creation and recovery forms require at least 12 characters with upper/lowercase, number and symbol. |
| Leaked-password protection | BLOCKED | The public Auth settings endpoint does not disclose this control. The Supabase dashboard requires an interactive login, and the locally stored management credential was rejected by the Management API. It must be verified by an authorized dashboard administrator. |
| Hosted SMTP | FAIL FOR RELEASE READINESS | Public Auth settings show no custom SMTP host. Admin and Merchant recovery requests were accepted, while the Collaborator request was rate-limited. API acceptance does not prove delivery. Supabase's default email service is not suitable for production onboarding or broad UAT recipients. |
| Email confirmation | PASS | `mailer_autoconfirm` is false. |
| External providers | PASS | Email is enabled; unrelated social providers are disabled. |
| Open signup | RISK | `disable_signup` is false and the deployed login page exposes Merchant and Collaborator onboarding. This may be intended, but it requires an explicit UAT business decision and abuse/rate-limit review. |

## Exact administrator actions required

1. Open the recovery message sent to `dungduong2412@gmail.com`, confirm that the link host is the UAT Supabase project and that it redirects only to `https://vno-web-uat.up.railway.app/reset-password`, then set a unique password of at least 12 characters containing upper/lowercase letters, a number and a symbol. Do not reuse a production password.
2. Sign in at `https://vno-web-uat.up.railway.app/login` and confirm the browser routes to `/admin/dashboard`. Do not share the password or recovery link.
3. In Supabase Dashboard for project `hsezyogfxgnkpweoqqny`, open Authentication password/security settings and verify **Leaked password protection** is enabled. If it is off, record the proposed project-level change and obtain the required approval before enabling it.
4. For `dungduong2412+merchant@gmail.com`, open the recovery message, verify the UAT host and redirect, and set a unique strong password. For `dungduong2412+collaborator@gmail.com`, wait for the email rate-limit window to reset, use the deployed `/forgot-password` page once, and complete the same checks. Do not share either password or recovery link.
5. Configure an approved UAT custom SMTP sender, validate SPF/DKIM as applicable, confirm the UAT web origin and reset path are in the Auth redirect allowlist, and then run exactly one delivery test to an approved test recipient.
6. After password setup, perform one interactive browser login for each of the three roles and confirm the expected route. API role routing is verified, but recipient-driven recovery completion was intentionally not bypassed.
7. Decide whether public Merchant/Collaborator signup is intended in UAT. If not, propose the Auth/application configuration change separately; do not silently disable it.
8. Remediate the UI/API gaps listed above, review and test the patch, and obtain separate commit/deployment approval before changing the deployed release.
9. Investigate the one pre-existing Auth identity without an application profile and the eight profiles whose status is null. Do not delete or overwrite them without ownership evidence.

## GO / NO-GO

**NO-GO for Phase D5 UAT acceptance and NO-GO for production import.**

The three-role server-side authentication and authorization model now passes with authorized synthetic accounts. Phase D5 still cannot be accepted as full business-functionality parity because Admin business administration is not feature-complete in the UI, referral/member and Merchant profile flows contain contract defects, media upload is missing, the Collaborator recovery email is rate-limited, and SMTP/leaked-password controls are not verified ready. Production import or cutover must not begin until these blockers are closed and all three recipient-driven browser login flows are completed.
