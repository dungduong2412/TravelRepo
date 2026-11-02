# VNO V2 — API-only deployment of the Auth Email Hook gateway (2026-11-02)

**API deployed SHA: `d84fce427565ced62aed5ff712aa6b190a1a6ba1`** (Railway `vno-v2-uat` / `uat` / service `vno-api`, deployment `7c8997b4-5cf9-449d-84a6-c422870ff13e`, SUCCESS). **Web unchanged**: deployment `ed1d9b42-…` at `f89dfb909c230abae28579568c2e9249d96522af`. Migration `20261102000001` was not reapplied.
Rollback: stage `services.<vno-api id 4fc48af8-08a4-4040-8938-a2f75223f8ee>.source.commitSha = f89dfb909c230abae28579568c2e9249d96522af` with `environmentStageChanges`, then `environmentPatchCommitStaged`.

Not done, by instruction: Supabase Auth hook not enabled, no SMTP, no email sent, no Railway variable added or changed, no Production or Web change.

## Release content (5 files, committed as `d84fce4`, pushed)
`backend/src/modules/auth-email-hook/{auth-email-hook.service,email-policy}.ts`, new `email-templates.ts`, `backend/src/main.ts`, `backend/scripts/test-auth-email-hook.ts`. Staged by explicit path; no `dist`, `.env`, evidence, PNG/JSON, docs or tooling. Scan of the files: no secret-shaped strings; 14 addresses, all synthetic (example.com/x.com/…); their SHA-256 hashes match 0 rows of the hosted `legacy_identity_map`, and 0 `auth.users` match. Neither service has a deploy trigger, so the push deployed nothing; the deploy was one staged patch containing only the API `source.commitSha`.

## Results
| Check | Result |
|---|---|
| Typecheck (`tsc`) | PASS |
| Lint (`npm run lint`, plus the 3 changed paths incl. the test file after one fix) | PASS |
| Email-hook tests | PASS 12/12 |
| Production build (compiled `main.js`, run as in Railway): unsigned → 401; wrong signature → 401; correct signature, stale timestamp → 401 | PASS |
| Same build, no secret configured: any request → 503, 0 identity lookups, 0 SMTP connections | PASS |
| Same build, `AUTH_EMAIL_DELIVERY` unset (default) and `=disabled`: correctly signed request for an **allowlisted tester** → 200 `{suppressed:true}`, **0 SMTP connections** (connection-counting trap) | PASS |
| Hosted: `/health` | 200 `{"status":"ok"}` |
| Hosted: deployed SHA | `d84fce4…` (API), web `f89dfb9…` unchanged |
| Hosted: unsigned and wrongly signed POST to `/auth/hooks/send-email` | rejected, HTTP **503** (no `AUTH_EMAIL_HOOK_SECRET` is configured yet, so the gateway fails closed before reading the request; 401 is returned once a secret exists and was proven on the production build above) |
| Hosted delivery-disabled | UAT has **no** `AUTH_EMAIL_DELIVERY`, `AUTH_EMAIL_HOOK_SECRET`, `SMTP_*`, `INVITATION_*` variable (names checked, no values read), so delivery is disabled by default and no SMTP exists to send with. A *signed* request cannot be made on hosted without the secret, so the zero-email proof for the allowlisted-tester case is the production-build test above |
| Existing login/authorization: hosted `00-unauth` + `20-regression` + `40-experience` | PASS 36/36, 0 fail, 0 skip |
| Anonymous privacy suite on the new deployment | PASS 9/9 |
| Business data, hosted | other public tables 25 / 16 934 rows; `auth.users` 475; `storage.objects` 616; `legacy_identity_map` 451; batch `validated`; history 13 rows, latest `20261102000001`; stored invitation links 0 — all identical to the post-Gate-A baseline |
| Read-only reconcile `--uat --no-db` (rerun) | 20 PASS / 0 FAIL / 2 NOT_RUN; C17 and C18 then closed by read-only SQL through the API: guard trigger `merchant_details_fractional_rates_trg` enabled; 39 foreign keys, 0 violations |

**C19 note:** the first reconcile run after deploy reported 1 of 602 media objects mismatched (about 4 MB fewer bytes). That script counts any fetch error or 120 s timeout as a mismatch. An independent re-verification (3 attempts each, SHA-256 and size) passed 602/602 with no retries, and the reconcile rerun passed C19 with 406 739 732 bytes. Cause not proven beyond a single failed download that did not recur; both runs are kept in `migration/v2/evidence/gate-a-20261102/`.

## Next configuration prerequisites (owner)
Superseded: the AWS SES plan was dropped by owner decision; the existing VNO e-mail service will be used. Current prerequisites, variables and steps: `VNO_V2_UAT_EMAIL_GATE_B_RUNBOOK_20261102.md`.
