# VNO Phase D4 — Isolated UAT deployment and smoke plan

Date: 2026-10-14 (Asia/Ho_Chi_Minh)

## Selected target

Railway project `vno-v2-uat` (`70162398-3ad9-4f50-8d64-bccbee32d429`) has one isolated environment, `uat` (`60c2c34a-77d0-4fc0-bac5-36deaf779479`), and two empty services:

- `vno-api` (`4fc48af8-08a4-4040-8938-a2f75223f8ee`)
- `vno-web` (`f23dacf5-e25d-4c9d-a9a1-dd37128d3264`)

Neither service has a deployment, replica, domain, volume or pending staged change. Production traffic is therefore unchanged. Do not connect source, set domains or accept a Railway deployment until approval.

## Prepared service configuration

The repository contains separate production Dockerfiles. Configure `vno-api` with root directory `/backend`, Dockerfile `/Dockerfile`, health check `/health`, and port supplied by Railway. Configure `vno-web` with root directory `/frontend`, Dockerfile `/Dockerfile`, and pass `NEXT_PUBLIC_API_URL` at build time.

Required variable names (values remain secret/platform-managed):

- API: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGINS`, `PORT`.
- Web/build: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `PORT`.
- `CORS_ORIGINS` must contain only the generated HTTPS UAT web origin. Never reuse a production service-role key in logs or client variables.

## Authorized deployment sequence

1. Review and push the exact approved D4 commit to a UAT-only branch.
2. Connect both Railway services to `dungduong2412/TravelRepo`, pinning the reviewed commit; set the root directories and Dockerfiles above.
3. Set variables in the `uat` environment, generate separate HTTPS domains, and update API CORS plus frontend API build argument to the final domains.
4. Deploy `vno-api`, verify `/health`, then deploy `vno-web` and verify `/login`.
5. Configure the Supabase UAT Site URL/redirect allow-list only after the final web domain exists.
6. Run `node deployment/uat/smoke-authorization.mjs` with three authorized test accounts. The script performs sign-in and read-only authorization checks; it sends no email and creates no records.
7. Require PASS for web login, API health, all three sign-ins, Admin financial/media reads, Merchant/Collaborator denials, and own-profile reads. Capture deployment IDs and HTTP status evidence without tokens or email addresses.

No deployment was executed in Phase D4. Local Docker builds were attempted, but Docker Hub metadata retrieval timed out before any image layer was downloaded; npm production builds passed independently. Repeat container builds in CI/authorized Railway before accepting this gate.
