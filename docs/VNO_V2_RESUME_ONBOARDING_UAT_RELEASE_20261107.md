# VNO V2 — Resume onboarding (P1 signup dead-end): UAT release (2026-11-07)

**Deployed SHA (vno-web only): `55b3b21604b9a16d69ed83b44a7df8dfef2bfb42`** — deployment `6d996d9a-f6ca-4ea5-ae8e-c8482638faa3` SUCCESS; Railway `source.commitSha` = `git rev-parse HEAD` = remote branch tip; no staged patch. vno-api unchanged (`1471baae…`).
Rollback: stage web `source.commitSha = c9afe98018fa64065d3f5a1dac3d4952a411cdac` (`environmentStageChanges` + `environmentPatchCommitStaged`). Not done: migration, env/allowlist change, real mail, Production, any change to existing/owner accounts or records.

## Fix
"Đã xác nhận email? Tiếp tục hồ sơ" on both onboarding pages signs in with the ORIGINAL e-mail + password directly against Supabase Auth (never signUp, never the profile-gated `/auth/login`), requires a confirmed e-mail, then shows: no profile -> profile form (verified e-mail read-only), pending -> "Hồ sơ đang chờ phê duyệt", active -> "Hồ sơ đã được duyệt" + Đăng nhập, blocked -> existing-profile state; other role / other e-mail -> flagged. Sign-up with a registered e-mail now points to Resume. Also fixed: Merchant page showed the "check your e-mail" notice twice (introduced in c9afe98).

## Evidence
* Clean `next build`, `tsc`, eslint 0 errors, `auth-errors` selftest (resume messages).
* Candidate (prod build): 00-unauth 7/7, 96 18/18, 95 9/9, 60 12/12, 90 pass. (An earlier SG6 failure was my own `E2E_SIGNUP_PASSWORD` override equalling the "new password"; rerun with defaults 12/12.)
* **Deployed (hosted web + API): 00 7/7, 95 9/9, 96 18/18 (both roles)**: session loss, wrong password, new device/no draft, unconfirmed refused, exactly one pending record + one linked pending profile after one submit, API duplicate refused (local + deployed), pending: operational endpoints >=400 and /login "Tài khoản đang chờ duyệt", cross-role and account switching, Admin approval -> resume shows approved -> normal login reaches the workspace; Auth users per e-mail stay 1.
* Known pre-existing, unrelated: spec 40 X10/X11 (QR payload drift since D14).
* Test data: synthetic `@vno-uat-synthetic.example` identities only (mail suppressed by the hook); the owner's Partner account still has 0 profiles / 0 Partner records.
