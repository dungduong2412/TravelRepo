# VNO V2 — Partner3 real signup: Step 2/2 diagnosis, fixes and journey evidence (UAT, 2026-11-08)

**Status: Signup E2E is NOT PASS.** Everything up to "confirmed, no profile" is proven on Partner3 itself. Submission, Admin visibility, approval, login and QR are proven only on
synthetic identities (spec 97, 6/6 on the candidate and on hosted UAT) and still need the owner's real "Gửi hồ sơ" on Partner3.

**Web:** vno-web deployed at `73814300b818c5fd0e74a821aad48ab98f99bcc3` (deployment `d645ab0d-99b3-4075-a75e-6644ff27843e`, SUCCESS, 2026-11-08T02:57:33Z). Railway config = git HEAD = remote.
Rollback: re-stage web `source.commitSha = c2e98aa9238173bf3a3a0a89d1e6eec669ec04d5` (`environmentStageChanges` + `environmentPatchCommitStaged`).
**API untouched** (deployment `6dbc6246`, 2026-11-07T15:30:01Z; `backend/src` unchanged). No migration, no Production action, no Auth setting, no mail triggered.

## 1. Diagnosis (real Railway HTTP log, `railway logs --http`)
| Time (UTC) | Request | HTTP | Meaning |
|---|---|---|---|
| 11-07 16:58:26 | `POST /auth/hooks/send-email` | 200 | confirmation mail for Partner3 handled by the hook |
| 16:58:58 | `POST /auth/diagnostics` ×3, `GET /user-profiles/me` | 204 / 200 | owner confirmed (Auth `email_confirmed_at` = 16:58:58.64Z) and reached the profile form; `/user-profiles/me` 200 with an empty body = no profile |
| 17:00:34 / 17:01:23 | `POST /auth/login` | 401 / 201 | the same browser then logged in as **Admin** (replacing the Partner3 session) |
| 17:02:38 | `POST /collaborators/a71ce95a-…/approve` | **409** | approval of a *different* record, see §2 |
| 11-08 02:38:02 | `POST /auth/login` | 401, then `GET /user-profiles/me` 200 ×3 | Partner3 logged in again; the new login-continuation sent it to the blank onboarding form |
| 02:41–02:43 | `GET /collaborators` | 304 | owner looked at the Admin list; Partner3 not there |

**No `POST /collaborators` from the owner at any time.** Partner3 has `email_confirmed_at`, **0** `user_profiles`, **0** `collaborators`, **0** `merchant_details` (`owner-uat-stage.mjs`, 03:00:52Z).
Root cause: not an API or database defect — the application was never submitted. E-mail confirmation only opens the profile form; the page did not say so, and the browser's native "required"
tooltip (the form had `required` fields and the screenshot has blank name/phone) is easy to miss, so a click on "Gửi hồ sơ" can be a silent no-op.

## 2. The approval 409 (diagnosed separately — NOT an accepted approval)
Record `a71ce95a-f99c-4195-b5a5-df90ab47171f` = `COL-05C60E056C3D4B5B` / `UAT-E2E-P-r1031233001`, a synthetic E2E leftover from 2026-10-31: `collaborators_status=pending`, **0 linked `user_profiles`**, one audit event (`collaborator.created`).
`CollaboratorsService.approve` refuses with `409 {code: OWNER_NOT_CLAIMED}` when no verified owner profile is linked — by design (an Admin-created / V1-imported record must be claimed first). It fails before any write: record and audit trail unchanged
(re-verified 11-08 02:59:50Z on hosted: still pending, no QR, audit events 1 → 1). It is unrelated to Partner3, whose application will create the linked profile itself.
UI defect found: the failure was written to a page banner that sits **behind the open detail drawer**, so the Admin saw nothing. Fixed (§3).

## 3. Changes (web only, commit `7381430`)
* **Step 2/2**: after e-mail confirmation the banner is "Bước 2/2 — Hoàn tất và gửi hồ sơ {Đối tác|Nhà cung cấp}" with a "✓ Bước 1/2 Xác nhận email (xong) / Bước 2/2 (bạn đang ở đây)" row, "hồ sơ **CHƯA được gửi** và Admin chưa nhìn thấy nó", and a reminder above the button. Kept: "Email đã xác nhận thành công. Vui lòng hoàn tất hồ sơ …".
* **Visible submit**: forms are `noValidate`; a blank/invalid submit shows a red alert naming the fields ("Hồ sơ CHƯA được gửi vì còn thiếu…"), focuses the first one and scrolls to it. An API failure shows what happened and `(HTTP <status> · <code>)`, always starting with "hồ sơ CHƯA được gửi"
  (`lib/api-failure.ts`; `ApiRequestError` in `lib/api.ts` carries `httpStatus`/`apiCode`, message unchanged, and is invisible to `errorCode()` so the e-mail-rate-limit copy can never be shown for a profile submit). The success page shows the new record's code and "Chờ phê duyệt".
* **Admin > Partners**: list read with `cache: 'no-store'` (request carries `Cache-Control: no-cache`, asserted), **Refresh** button, re-read on window focus and every 30 s while visible, "updated hh:mm:ss", a **Chờ phê duyệt (N)** counter + chip. Approve / Reject / Deactivate results are shown **inside the drawer** (error with HTTP code, "record unchanged") and success as a green notice naming the status and the QR.
* **One vocabulary** (`lib/status-labels.ts`): database `pending` is displayed as **Chờ phê duyệt** in Admin partners/merchants/users/dashboard, login, dashboard shell, media proposals, members, onboarding. Stored values, API and DB are unchanged (`data-status="pending"`, `title="pending"`).

## 4. Evidence
| Check | Result |
|---|---|
| frontend selftest (`npx tsx lib/auth-errors.selftest.ts`), `tsc`, eslint | pass / pass / 0 errors (10 pre-existing `<img>` warnings), clean build |
| Candidate (local web+API on hosted UAT data) 00 + 95 + 96 + 97 | **40/40** |
| Candidate spec 40 | 20 pass, X10 + X11 fail — same two QR failures as before this work (X10: payload host is the hosted URL while the candidate runs on localhost; X11: V1 shared codes); X16 (new "chờ phê duyệt" copy) passes |
| **Hosted** (deployed web + API) 00 + 95 + 97 | **22/22** |
| Spec 96 hosted | not rerun (it fires ~6 signup mails; candidate 18/18 on identical code); the owner's mail quota is kept free |

Spec 97 (synthetic partner, Auth admin `generate_link` → **no mail, no quota**), hosted run `20261108025853`, `e2e-uat/evidence/partner-step2-20261108025853.json`:
* J0 409 replay on the leftover record: `POST …/approve` **409 OWNER_NOT_CLAIMED**, shown in the drawer, record still pending/unverified/no QR, audit 1 → 1.
* J1 confirmed → Step 2/2 banner; `email_confirmed_at` 02:59:51.99Z; profiles 0, records 0, write requests 0.
* J2 blank "Gửi hồ sơ" → visible alert naming Họ và Tên + Số Điện Thoại, `#fullName` focused, 0 writes, 0 records.
* J3 Admin list opened **before** the submit lacked the record (no stale pretence); `POST /collaborators` **201** at 03:00:01Z, id `4ee65cb9-77d0-4338-9fc5-67c1c0921e04`, code `COL-80E00AFDD983986D`, status `pending`, verified `false`; exactly 1 `collaborators` row (pending) + 1 linked `user_profiles` (pending, role collaborator); audit `collaborator.application_submitted@03:00:01.359Z`; Admin **Refresh** → row under the Pending filter, badge "Chờ phê duyệt", pending count 6 → 7.
* J4 Admin Approve in the UI: `POST …/approve` **201**; record `active`/verified with QR; profile `active`; audit `collaborator.approved@03:00:06.719Z`; pending count back to 6.
* J5 Partner login `POST /auth/login` **201** → `/collaborator/dashboard`; `GET /collaborators/me/qr-code` **200**, payload `https://vno-web-uat.up.railway.app/c/COL-80E00AFDD983986D`, `login_count ≥ 1`, `last_login_at 03:00:10.878Z`.

Synthetic data created by these runs (all `@vno-uat-synthetic.example`, nothing deleted): `UAT-E2E-STEP2-20261108024914` (first candidate run that failed on a test-code assertion; finished by approving it so it does not sit in the owner's Pending list),
`…024955`, `…025037`, `…025853` (all approved). Admin Pending list afterwards = the 5 pre-existing records (`COL-05C60E056C3D4B5B`, `COL-B57DE3C194B57F69`, `COL-80BFCB2967EDD04C`, `COL-F003CC3F02C48BC8`, `COL-4753E20CBA4FE801`).

## 5. What the owner does (Partner3 itself)
1. **Use two browsers or a private window** — Partner and Admin share one browser session; logging in as Admin replaces the Partner3 session (that is what happened at 17:01).
2. Partner3: `https://vno-web-uat.up.railway.app/login` → e-mail + the password chosen at signup → the page opens `/collaborator/onboard` showing **Bước 2/2 — Hoàn tất và gửi hồ sơ Đối tác** (hard-reload first if an old page is open).
3. Fill Họ và Tên + Số Điện Thoại → **Gửi hồ sơ**. Expect the page "Hồ sơ đang chờ phê duyệt" with the record code.
4. Then verify with `railway run --service vno-api -- node e2e-uat/tools/verify-partner-submission.mjs andyduong2412+uat-signup-partner3@gmail.com` (V0–V9) and `owner-uat-stage.mjs` (S0–S4); Admin approval is then done in Admin > Partners (Chờ phê duyệt chip) and evidenced the same way (approval HTTP status, `collaborator.approved` audit, active profile); finally Partner3 logs in again and opens the QR.
