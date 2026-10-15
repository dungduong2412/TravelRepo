# VNO Phase D5 — Railway Build-Failure Fix

Date: 2026-10-15  
Scope: Railway project `70162398-3ad9-4f50-8d64-bccbee32d429`, environment `uat` only

## Result

**READY FOR REVIEW; NOT REDEPLOYED.** The Dockerfiles are present in GitHub and both service root directories are correct. The failed deployments stopped at Railway's Dockerfile lookup before either Dockerfile executed. A second web-image issue was reproduced locally and fixed: the Next.js build now receives the two required public Supabase build arguments.

No V1 access, production import, Supabase configuration change, customer email, DNS change, Railway deployment commit, push, or deployment occurred during this fix.

## Failure evidence

| Service | Failed deployment | Railway source metadata | Root | Configured Dockerfile | Raw failure |
|---|---|---|---|---|---|
| `vno-api` | `ed0c1999-0d56-441b-b5e2-2436c8d9483a` | branch head `8a34ae5172f94b59ee7ec9146ea27d2f9b27731a` | `/backend` | `/Dockerfile` | `failed to read Dockerfile at 'Dockerfile'` |
| `vno-web` | `2af60078-424f-48c5-80af-6496ef3c88c6` | branch head `8a34ae5172f94b59ee7ec9146ea27d2f9b27731a` | `/frontend` | `/Dockerfile` | `failed to read Dockerfile at 'Dockerfile'` |

The requested application SHA `90c011324d7e5907ee0c7a99f5d681bdb411e765` and the deployed branch-head SHA both contain:

- `backend/Dockerfile`
- `frontend/Dockerfile`
- the corresponding package manifests, lockfiles, sources, and Docker ignore files

GitHub's tree API independently confirmed those paths at the requested application SHA. The remote branch currently points to `8a34ae5172f94b59ee7ec9146ea27d2f9b27731a`, not `90c011324d7e5907ee0c7a99f5d681bdb411e765`. Railway's recorded deployment metadata likewise names `8a34ae5...`, despite the live source configuration displaying a `90c0113...` pin. Therefore the prior deployment did not satisfy exact-SHA traceability, even though the later commit only adds the Phase D4 report.

Railway unpacked 2,488,320 bytes. A local `git archive` of each candidate SHA is also 2,488,320 bytes; compressed sizes are approximately 393–395 KB and match Railway's uploaded snapshot. This rules out a missing or truncated repository archive. The actionable failure is the explicit Dockerfile override/lookup interaction, not absent Git content.

## Minimal application correction

Only `frontend/Dockerfile` changes. Its build stage now declares and exports:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

The existing `NEXT_PUBLIC_API_URL` behavior remains unchanged. The anon key is a public client credential by design; no service-role or secret key is accepted by the frontend image.

Without this correction, the web Docker build advances past Dockerfile discovery but fails during Next.js prerendering with `supabaseUrl is required`. With the correction and UAT public build arguments, it completes successfully.

## Railway configuration prepared for review

For both services, retain the existing isolated-monorepo roots and remove the custom Dockerfile-path override so Railway auto-detects the capitalized `Dockerfile` at the selected source root:

| Setting | `vno-api` | `vno-web` |
|---|---|---|
| Root directory | `/backend` | `/frontend` |
| Dockerfile path | default/unset (`Dockerfile` at service root) | default/unset (`Dockerfile` at service root) |
| Start command | `node dist/main.js` | `node server.js` |
| Health check | `/health` | `/login` |
| Port | `3100` | `3001` |

No root-directory change is justified: Railway's current monorepo documentation uses `/backend` and `/frontend` for this exact isolated layout. Do not move either Dockerfile and do not change the build context to the repository root.

The corrected release commit must be pushed only after approval, then both service sources must be pinned to that exact commit. The Railway environment patch should combine the two source pins and two Dockerfile override removals in one non-destructive UAT-only patch. Review the staged diff before accepting it.

## Verification

| Check | Status | Evidence |
|---|---|---|
| Backend typecheck | PASS | `npm --prefix backend run typecheck` |
| Backend lint | PASS | `npm --prefix backend run lint` |
| Backend production build | PASS | `npm --prefix backend run build` |
| Backend production dependency audit | PASS | zero high/critical runtime findings |
| Frontend typecheck | PASS | `npm --prefix frontend run typecheck` |
| Frontend lint | PASS | `npm --prefix frontend run lint` |
| Frontend production build | PASS | `npm --prefix frontend run build` |
| Frontend production dependency audit | PASS | zero high/critical runtime findings |
| Backend Docker build | PASS | image built from `backend/` context |
| Frontend Docker build | PASS | image built from `frontend/` context with all three public build arguments |
| Container API health | PASS | local image returned HTTP 200 and `{\"status\":\"ok\"}` at `/health` |
| Container web health | PASS | local image returned HTTP 200 at `/login` |
| Isolated authorization rehearsal | PASS | all 35 Admin/Merchant/Collaborator, RLS, denial, ownership, and cross-role controls passed |

The authorization rehearsal used only the isolated local Phase D2 Supabase environment and its synthetic personas. It was stopped after testing. No hosted database or Auth state was changed.

## Redeployment sequence after approval

1. Push the reviewed release commit to a branch without triggering any production service.
2. Stage UAT-only source pins for both services to the exact release commit.
3. Stage removal of the explicit `/Dockerfile` overrides; retain `/backend` and `/frontend` roots.
4. Verify the staged Railway patch is non-destructive and contains only those four service changes.
5. Obtain explicit approval, then commit the Railway patch.
6. Confirm both builds report Dockerfile detection, then verify `/health` and `/login`.
7. Run `deployment/uat/smoke-authorization.mjs` using only the three approved UAT accounts.

## Decision

- **GO for a reviewed UAT redeployment:** yes, after explicit approval of the staged Railway patch.
- **GO for production import or cutover:** no. Phase D5 deployed authorization, hosted recovery/SMTP, and remaining security gates still require evidence after a successful UAT deployment.
