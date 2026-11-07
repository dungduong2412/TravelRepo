# VNO V2 — Onboarding identity UX: UAT release (2026-11-07)

**Deployed SHA (vno-web only): `c9afe98018fa64065d3f5a1dac3d4952a411cdac`** — Railway `vno-v2-uat` / `uat`, web service `f23dacf5-e25d-4c9d-a9a1-dd37128d3264`, deployment `f5cdc383-b3ac-48e4-92a1-8f696254bf57` SUCCESS (build started 04:58Z). Read back from Railway config = `git rev-parse HEAD` at deploy time = `git ls-remote origin` branch tip. No staged patch left over.
**vno-api unchanged** at `1471baae48216d30ac07e292dc59c7eaeed7776f`. Rollback: stage web `source.commitSha = 8072f3e8a60bf93ff9d8ab404ecc8a5859dd210a` with `environmentStageChanges` + `environmentPatchCommitStaged`.

Not done: no migration, no env/variable change, no Auth allowlist change, no mail triggered, no account approved, no orphan/real/V1 record touched, no Production action.

## Change
Verified-identity states on both onboarding pages (ready / existing / mismatch / anonymous), confirm page warns before replacing another session, pending wording "Hồ sơ đang chờ phê duyệt", initial CTA "Đăng ký & xác nhận email", "Gửi hồ sơ" only for a verified session.

## Evidence
* Clean `rm -rf .next && next build` OK; `tsc --noEmit` OK; eslint 0 errors (10 pre-existing `<img>` warnings).
* Candidate regression (prod build, local web+API on hosted UAT data): `00-unauth` 7/7, `95-onboarding-identity` 9 tests PASS, `40-experience` 17/19. **X10/X11 fail identically on the unchanged deployed 8072f3e** (pre-existing: D14 commit 308a442 made the Partner QR payload a URL and the specs still expect the bare code); unrelated to onboarding and not changed here.
* Deployed smoke (hosted web + API): `00-unauth` 7/7, `95-onboarding-identity` 9/9 (identity notices, role-mismatch protection, pending wording, signup navigation/CTA, cross-alias refusals on the deployed API).
* Live bundle of `/merchant/onboard` and `/collaborator/onboard` contains the new CTA.

## Owner's Partner account (andyduong2412+uat-signup-partner2@gmail.com)
Before submission: Auth confirmed 2026-11-07T03:44:49Z, 0 profiles, 0 Partner records. After the owner submits, run:
`railway run --service vno-api -- node e2e-uat/tools/verify-partner-submission.mjs andyduong2412+uat-signup-partner2@gmail.com` (read-only; checks one record, one linked pending profile, no duplicates, one submitted audit event, no approval event).
