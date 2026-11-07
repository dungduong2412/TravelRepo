# VNO V2 — Simple signup + `uat-signup-partner3` readiness (UAT, 2026-11-07)

**Web:** vno-web deployed at `c80c709b4346d9a1e334b643d96e8464900d9908` (deployment `198635ba-b7ad-4446-8e1b-9b4c8cc771f4`, SUCCESS). Railway config = git `HEAD` = remote branch tip.
Rollback: re-stage web `source.commitSha = 55b3b21604b9a16d69ed83b44a7df8dfef2bfb42` (previous web build) with `environmentStageChanges` + `environmentPatchCommitStaged`.
No migration, no Production action, no record deleted or modified, no Auth setting changed, no mail triggered by me for the owner's alias.

## 1. Preflight for `andyduong2412+uat-signup-partner3@gmail.com` (read-only, service key, nothing printed)
| Check | Result |
|---|---|
| Auth user with this e-mail (507 users scanned) / any `*partner3*` address | 0 / 0 |
| `user_profiles` by e-mail | 0 rows |
| `collaborators` by e-mail | 0 rows |
| `merchant_details` by `merchant_email` / `owner_email` | 0 / 0 |
| Migrated V1: `legacy_identity_map.source_email_sha256 = sha256(lower(trim(email)))` | 0 rows (hash scheme re-verified on 5 of 5 sampled migrated rows; no Auth user exists to be linked by `auth_user_id`) |

## 2. Allowlist (owner-authorised for this one exact address)
`AUTH_EMAIL_ALLOWLIST` on vno-api: 6 existing entries preserved + `andyduong2412+uat-signup-partner3@gmail.com` = **7 exact addresses** (no domain entry). `AUTH_EMAIL_DELIVERY=enabled`, `INVITATION_DELIVERY=capture`, `INVITATION_EMAIL_ALLOWLIST` unset. Applied with `environmentStageChanges` (only that variable staged) + `environmentPatchCommitStaged`; vno-api redeployed `6dbc6246` SUCCESS 15:30Z, Nest started 15:30:18Z, `/health` 200.
Effective check: the repo's own `isRecipientAllowed` evaluated against the live variable → exact alias **allowed** (also case-insensitively); `…partner4@`, the bare `andyduong2412@gmail.com`, a `googlemail.com` twin and an unrelated address **refused**.

### Correction to earlier reports about the API build
Earlier records say vno-api stayed at `1471baa` because the Railway config shows that `source.commitSha`. The deployment history shows otherwise: API deployments were built from the branch tip at deploy time (`9372708`, `64c4a10`, `f5c9a82`, and now `343b81f`). `git diff 64c4a10 HEAD -- backend/src` is **empty**, so the running API code is `64c4a10` (identical to HEAD) and this redeploy changed no code. Treat the `1471baa` pin on the API service as not authoritative; the web service pin *is* honoured (read back = `c80c709`).

## 3. What changed in the UX (frontend only)
1. **New e-mail → sign up and verify** (unchanged CTA "Đăng ký & xác nhận email"; "Gửi hồ sơ" after verification).
2. **Registered e-mail → Login or Forgot password.** The sign-up form shows one message ("Email này đã được đăng ký…") and "Đã có tài khoản? Đăng nhập · Quên mật khẩu". The extra "Tiếp tục hồ sơ" Resume panel is **removed** (one path instead of two).
3. **Verified e-mail without profile → normal login continues at onboarding.** If `/auth/login` refuses a valid password, the login page asks Supabase Auth with the same credentials: confirmed + no business profile → session kept, redirect to `/collaborator/onboard` or `/merchant/onboard` (role from `requested_role`); unconfirmed → "Email chưa được xác nhận"; pending → "Tài khoản đang chờ duyệt"; blocked → "chưa được kích hoạt". Nothing is created and the API still refuses operational calls until approval.
4. **Stale notices cleared:** when a verified/existing/mismatch session appears, the earlier sign-up error and "check your e-mail" notice are removed (no green banner next to a red message).
5. **Draft e-mail adoption:** a deliberate login replaces the e-mail kept in an older local draft, so onboarding is not mis-flagged as someone else's session.
6. No automatic profile creation or approval anywhere (spec asserts counts after every step).

## 4. Evidence
- Clean production build, `tsc`, eslint (0 errors), selftest: pass.
- Candidate build (local web+API on hosted UAT data): spec 96 **18/18** (both roles: signup → confirm → registered-email → login continuation → new device → one submit = one pending record + one linked pending profile → pending login → cross-role/account switching → unconfirmed → Admin approve → workspace login); regression 00/95/60/90 **42/42**.
- Hosted (deployed web + API): **51 passed**, 1 failed + 8 not run — all Merchant LO1+ in spec 96, caused by the Supabase **Auth e-mail send rate limit** (page correctly showed "Email xác nhận vừa được gửi. Vui lòng đợi khoảng một phút rồi thử lại"), not by the application. Hosted Partner LO1–LO9 passed. Merchant passed 9/9 on the candidate build; the hosted Merchant rerun was deliberately NOT repeated to leave the quota for the owner's real signup.
- The rate limit was consumed by my synthetic signups (~15:35–15:45Z). Expect it to clear about an hour after the last attempt (≈ 16:45Z / 23:45 +07).

## 5. Owner manual flow and evidence tool
`railway run --service vno-api -- node e2e-uat/tools/owner-uat-stage.mjs andyduong2412+uat-signup-partner3@gmail.com` (read-only) prints the stage: S0 no user → S1 signed up/unconfirmed → S2 confirmed, no profile → S3 submitted/pending (record, link, duplicates, audit events, login count) → S4 approved + QR code value. `verify-partner-submission.mjs` gives the strict V0–V9 check after submission.
Not simulated: receipt of the confirmation e-mail, the click, the profile entry, the Admin approval and the Partner QR view are the owner's manual steps. This record does not declare full Authentication UAT PASS.

## 6. Addendum — owner hit the e-mail rate limit (23:09 +07)
Owner screenshot of `/collaborator/onboard` for `partner3` showed "Email xác nhận vừa được gửi. Vui lòng đợi khoảng một phút rồi thử lại…". Server evidence: no Auth user for the alias (stage S0), no `AuthEmailHook` call since the last synthetic test (15:45:51Z), i.e. Supabase rejected the signup (`over_email_send_rate_limit`) before the hook; **no mail was sent**. The copy was wrong (it claimed a mail was sent). Fixed in web `c2e98aa9238173bf3a3a0a89d1e6eec669ec04d5` (deployment `bc38deaf-d631-48e2-b526-c10fb2a02bf7`, SUCCESS; Railway = git = remote, nothing staged, vno-api untouched at `6dbc6246`): "Hệ thống đang giới hạn việc gửi email xác nhận nên email có thể chưa được gửi. Hãy kiểm tra hộp thư và thư mục spam; nếu không thấy, vui lòng thử lại sau khoảng một giờ." Selftest asserts it never says "vừa được gửi". Verified live by loading both onboarding pages in a browser (new text present, old text and the Resume text absent, "Đã có tài khoản?" links present). Only no-mail checks were run (selftest, tsc, lint 0 errors, build, hosted `00-unauth` 7/7).
