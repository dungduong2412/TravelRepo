# VNO V1 → V2 Migration — Phase D4 Security & Deployment Closure

Date: 2026-10-14 (Asia/Ho_Chi_Minh)

Branch: `codex/vno-phase-d4-security`

Application/security commit: `90c011324d7e5907ee0c7a99f5d681bdb411e765` (local only; not pushed)

Baseline application commit: `06954135cb4adde629db01fde244a2d4191d4974`

Baseline D3 report commit: `4470c402b492136d48d6ead80f5a3cc007be1917`

Decision: **NO-GO for production V2 import**.

## Safety boundary

- V1 was not accessed or modified.
- Accepted `snapshot-3` was not modified and no production data was imported.
- No hosted V2 schema/data, Supabase Auth setting, Storage object or customer account was changed.
- No customer-facing email was sent and no migrated account was activated.
- No branch was pushed; no Railway source/domain was connected; no deployment, DNS change or cutover occurred.
- Production application traffic and port 3000 were untouched.

## Five release gates

| # | Gate | Status | Evidence and closure condition |
|---:|---|---|---|
| 1 | Dependency security and application regression | **PASS** | Baseline inventory contains 106 root advisory/range rows and all npm aggregate nodes. Minimal non-major remediation was tried first; it could not fix the critical Next 14 or high Nest 10 runtime chains. The isolated branch upgrades to Next 16.4.0/React 19.3.0/Tailwind 4.3.3 and Nest 12.1.3/Config 12.0.1, with TypeScript 6.0.3 and ESLint 9.39.5. Backend and frontend typecheck, lint and production builds pass. Local authorization suite passes all 35 controls. Both production audits report **0 vulnerabilities**. Backend full audit reports 0. Frontend full audit retains five high aggregate entries from one unpatched `braces@3.0.3` advisory in Next's ESLint-only chain; it is not copied into the standalone runtime and is accepted only as dev/CI risk. |
| 2 | Leaked-password protection | **FAIL** | The live Supabase Security Advisor at `2026-10-14T08:43:03.502Z` still reports `auth_leaked_password_protection` / **Leaked Password Protection Disabled**. An administrator must enable **Prevent use of leaked passwords** for project `hsezyogfxgnkpweoqqny`, save, and rerun the advisor. This gate cannot pass while the finding remains. |
| 3 | UAT SMTP and authorized recovery | **BLOCKED** | UAT SMTP settings/credentials and a deployed HTTPS recovery origin were not supplied or authorized. The recovery template, redirect/rate-limit checklist and application pages are prepared. Local Mailpit regression passes capture, link verification, password update and login using an `example.invalid` account, with cleanup and no external mail. Closure requires configured custom SMTP, exact UAT redirect allow-list and one designated UAT test-account delivery/reset/login; no customer address may be used. |
| 4 | Isolated UAT deployment and role smoke | **BLOCKED** | Railway target `vno-v2-uat` exists with isolated `uat` environment and empty `vno-api`/`vno-web` services. Both have no deployment, domain, replica or staged changes. Dockerfiles, `/health`, environment contract and remote-safe smoke script are prepared. No deployment was authorized. Local Docker builds could not reach Docker Hub metadata before timeout; npm production builds passed. Closure requires approved push/deployment of the exact reviewed commit, successful container builds, HTTPS domains, and deployed Admin/Merchant/Collaborator smoke PASS. |
| 5 | Rollback and recovery | **PASS** | The just-in-time hosted backup procedure is documented. In an isolated local Supabase rehearsal, one synthetic migration batch, Auth user and 4 KiB private Storage object were created, the object byte SHA-256 was verified, and all exact synthetic identities were rolled back. Database, Auth and both Storage inventory counts/hashes matched prestate. Targeted recovery took **0.097 s** (0.571 s total). A fresh hosted recovery point, encrypted logical export and complete Storage-byte backup remain mandatory immediately before an approved import window. |

## Dependency risk decision

The complete package/advisory/path/range/exploitability inventory is in `docs/V1_V2_PHASE_D4_VULNERABILITY_INVENTORY_20261014.md`.

There are no unresolved critical/high findings in either deployed production dependency audit. The residual frontend full-audit issue is [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), propagated as five package entries through `braces → micromatch → fast-glob → @next/eslint-plugin-next → eslint-config-next`. The latest published `braces` remains affected and npm proposes an unsafe Next ESLint downgrade. This dependency is dev-only, receives repository-controlled lint patterns and is absent from the standalone runtime. Recheck the registry before deployment and remove this acceptance if packaging or inputs change.

## Authentication and hosted target evidence

Supabase project `hsezyogfxgnkpweoqqny` is `ACTIVE_HEALTHY`, PostgreSQL 17.6.1. Read-only counts remain 14 merchants, 14 collaborators, 15 Auth users, zero referral transactions and zero media assets. No hosted mutation was performed.

The prepared operator steps, exact recovery template and rate-limit starting values are in `docs/V1_V2_PHASE_D4_UAT_AUTH_CONFIGURATION_20261014.md`. Supabase custom SMTP should use a UAT-only sending identity, disabled link tracking and an exact `https://<uat-web>/reset-password` allow-list entry. Only one authorized test account is permitted for the hosted recovery test.

## UAT target and deployment procedure

The selected Railway project is `vno-v2-uat` (`70162398-3ad9-4f50-8d64-bccbee32d429`), environment `uat` (`60c2c34a-77d0-4fc0-bac5-36deaf779479`), services `vno-api` (`4fc48af8-08a4-4040-8938-a2f75223f8ee`) and `vno-web` (`f23dacf5-e25d-4c9d-a9a1-dd37128d3264`). The reviewed configuration and smoke sequence are in `docs/V1_V2_PHASE_D4_UAT_DEPLOYMENT_20261014.md`.

## Rollback evidence

The recovery report is `docs/V1_V2_PHASE_D4_RECOVERY_REHEARSAL_20261014.md`; the executable guard is `migration/v2/test-rollback-recovery.mjs`. It refuses non-local targets. The test preserved 163 merchants, 285 collaborators, 102 transactions, 618 media rows and 420 profiles in the isolated rehearsal while restoring the synthetic database/Auth/Storage changes to identical hashes.

## Exact changed files in application/security commit

- Backend: `backend/package.json`, `backend/package-lock.json`, `backend/tsconfig.json`, `backend/eslint.config.mjs`, removal of `backend/.eslintrc.json`, `backend/Dockerfile`, `backend/.dockerignore`, `backend/src/app.module.ts`, `backend/src/health.controller.ts`, and rebuilt tracked files under `backend/dist/` including `health.controller.*`.
- Frontend: `frontend/package.json`, `frontend/package-lock.json`, `frontend/tsconfig.json`, `frontend/eslint.config.mjs`, removal of `frontend/.eslintrc.json`, `frontend/app/globals.css`, `frontend/postcss.config.js`, `frontend/next.config.mjs`, `frontend/Dockerfile`, and `frontend/.dockerignore`.
- Controls: `deployment/uat/smoke-authorization.mjs`, `migration/v2/test-rollback-recovery.mjs`, and `supabase/templates/recovery.html`.
- Evidence: `docs/V1_V2_PHASE_D4_VULNERABILITY_INVENTORY_20261014.md`, `docs/V1_V2_PHASE_D4_UAT_AUTH_CONFIGURATION_20261014.md`, `docs/V1_V2_PHASE_D4_UAT_DEPLOYMENT_20261014.md`, and `docs/V1_V2_PHASE_D4_RECOVERY_REHEARSAL_20261014.md`.

## Next actions

1. Administrator enables leaked-password protection and provides a clean Security Advisor result.
2. Approve/configure UAT SMTP, final Railway HTTPS domains, exact redirects and one designated test account.
3. Review commit `90c011324d7e5907ee0c7a99f5d681bdb411e765`; then explicitly authorize push and UAT-only deployment if accepted.
4. Rebuild both Docker images in the authorized deployment environment and run `deployment/uat/smoke-authorization.mjs`.
5. Immediately before any separately approved import, create and verify the hosted database recovery point, encrypted prestate export and complete Storage byte backup.

## Recommendation

**NO-GO for production V2 import.** Dependency remediation and isolated rollback testing are closed, but leaked-password protection is still disabled and the required hosted SMTP/recovery plus deployed UAT authorization tests have not run. Stop here pending review; do not import, push, deploy or cut over.
