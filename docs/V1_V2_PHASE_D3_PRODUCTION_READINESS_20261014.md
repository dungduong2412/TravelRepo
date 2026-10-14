# VNO V1 → V2 Migration — Phase D3 Production Readiness

Date: 2026-10-14 (Asia/Ho_Chi_Minh)

Scope: application release candidate, Supabase project `hsezyogfxgnkpweoqqny`, accepted `snapshot-3`, local isolated Auth/SMTP rehearsal, and rollback planning.

Decision: **NO-GO for production V2 import**.

## Safety boundary

- V1 was not accessed or modified.
- No production V1 data was imported into V2.
- Hosted V2 schema, Auth settings, Storage objects, and application deployment were not changed in Phase D3.
- No customer-facing password reset was sent.
- No push, deployment, DNS change, cutover, restore, or production import occurred.
- Port 3000 was not used.

## Five-item release-gate checklist

| # | Release gate | Status | Verification evidence / required closure |
|---:|---|---|---|
| 1 | Leaked-password protection | **BLOCKED** | The live Supabase security advisor reports `auth_leaked_password_protection` with `Leaked Password Protection Disabled`. Exact approved action: open Supabase Dashboard for project `hsezyogfxgnkpweoqqny` → **Authentication → Providers → Email / Password security** → enable **Prevent use of leaked passwords** → Save; then rerun the security advisor and test sign-up/password-change rejection with an authorized test account. This hosted security setting was not changed without approval. Supabase documents this as a Pro-plan feature: [Password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). |
| 2 | Password reset and SMTP | **BLOCKED** | Application recovery pages and non-enumerating messaging are implemented. Isolated SMTP test **PASS**: local Mailpit captured a recovery email to a throwaway `example.invalid` account, the link established a recovery session, password update succeeded, the new password authenticated, and the test user was removed; no external/customer email was sent. Hosted closure requires approval to configure **Authentication → SMTP Settings** with the approved provider and sender, set the deployed UAT Site URL and allow-list `<UAT origin>/reset-password` under **URL Configuration**, review the Recovery template and rate limits, then perform one delivery/reset/login test using a designated UAT test account only. Two designated test accounts exist in hosted Auth, but no hosted recovery email was triggered. |
| 3 | Application review and release commit | **FAIL** | Release-candidate commit `06954135cb4adde629db01fde244a2d4191d4974` is local only. Backend typecheck/lint/build and frontend typecheck/lint/build pass; frontend lint has existing `no-img-element` performance warnings only. Local role/API authorization suite passes all 35 controls, including login response compatibility, role escalation denial, financial denial, own/cross-merchant isolation, public response sanitization, and Admin/Merchant/Collaborator behavior. Security review removed duplicate token storage, hard-coded test passwords, legacy domain-password tooling, and public merchant-detail exposure; added strict onboarding/recovery passwords and environment-based CORS. However, production dependency audit remains unacceptable: backend has 3 high advisories (9 total), while frontend has 1 critical and 6 high advisories (9 total). Available remediations require reviewed major upgrades to NestJS 12, Next.js 16.4, and Tailwind 4; they were not force-applied. |
| 4 | Pre-import rollback and recovery | **BLOCKED** | The reviewed procedure is in `docs/V1_V2_PHASE_D3_ROLLBACK_RUNBOOK_20261014.md`. It covers database recovery point/logical export, Storage byte backup because database backups contain metadata but not object bytes, Auth prestate and import-created-user rollback, deterministic batch rollback, and whole-project restore escalation. The actual hosted recovery point, encrypted prestate exports, Storage byte copy, and isolated restore drill must be created/verified immediately before the approved import window; none was executed in this phase. |
| 5 | Target UAT and deployed authorization smoke | **BLOCKED** | Supabase target identity is verified as active/healthy `VietnamNumberOne`, project `hsezyogfxgnkpweoqqny`, PostgreSQL 17. Live counts remain 14 merchants, 14 collaborators, 15 Auth users, zero referral transactions, and zero media assets. The repository has no identified deployed UAT application target or deployment configuration, and deployment was not authorized. Therefore the required post-deployment Admin/Merchant/Collaborator smoke suite cannot yet run. Configure `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, publishable key, backend Supabase variables, and exact `CORS_ORIGINS`, deploy only after approval, then rerun the 35-control suite against the deployed URLs. |

## Snapshot and deterministic duplicate controls

The accepted source remains exclusively:

- path: `/Users/dungduongdinhquoc/Documents/VNO/phase-d1-20261013/snapshot-3/`
- tenant: `b7688a1c-23f9-637d-c2fb-3a16eb1befd2`
- manifest SHA-256: `da291214739f71cd2c5d02a356f5ea73cbb66cc36914de150d74a0b97b7abfa8`

Independent Phase D3 verification passed all 730 entries in `files.sha256` plus the acceptance-manifest digest. The source directory was read only.

The importer is now pinned to the accepted path and digest, rejects path traversal in the checksum manifest, and stops before contacting the target if seal or tenant validation fails. It aborts before overwriting any unreviewed merchant, collaborator, Auth user, or profile match. Restart-owned rows must contain the expected legacy identity and tenant. Existing V2 category values are preserved when the four reviewed category names match; only legacy identity metadata is added.

The reviewed match result remains:

| Entity | Existing V2 | V1 source | Matches | Conflicts | Planned additions |
|---|---:|---:|---:|---:|---:|
| Merchants | 14 | 148 | 0 | 0 | 148 |
| Collaborators | 14 | 270 | 0 | 0 | 270 |
| Auth users | 15 | 433 | 0 | 0 | 433 identities, of which 417 are active and 16 archive-only |

Live entity/Auth counts have not changed since the match report. The 14 existing merchants and 14 existing collaborators therefore remain untouched; any new match or conflict at preflight is a hard stop requiring a fresh reviewed reconciliation.

## Rollback readiness

Procedure design is complete, but operational rollback readiness is not yet accepted. Before import, the operator must prove a current database recovery point, encrypted logical/prestate export, complete private Storage byte backup and checksums, Auth prestate manifest, and a successful restore drill in isolation. Database restore alone cannot recover deleted Storage object bytes. No production rollback action is authorized by this report.

## Recommendation

**NO-GO for production V2 import.**

Production import remains blocked until all five gates pass, especially leaked-password protection, hosted SMTP/recovery validation, dependency remediation, just-in-time backup/restore evidence, and the authorized deployed UAT smoke suite. The release-candidate commit is reviewable but must not be pushed or deployed as production-ready in its current dependency state.
