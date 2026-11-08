# VNO V2 — Partner signup replaced by the single-step business flow (UAT, 2026-11-08)

**Decision implemented (owner):** the two-step Partner signup is rejected. The flow is now
**Register once → Admin approves → the system e-mails an activation link → one click enters the Partner Portal.**
Scope: **Partner only.** The Merchant signup is unchanged. No migration, no Production action, no Auth-dashboard setting changed, no existing account/record deleted or edited.

**Deployed to UAT:** API `91550541-35dc-4312-9b8a-acafb7bec67c` (2026-11-08T07:41:49Z) and Web `457dfa41-37d8-480b-8d8c-4368678ed26a` (07:43:42Z), both at commit `9c7c09efbb823ea62346ad368eba1150eafd38d7`, SUCCESS, read back from Railway. Rollback: re-stage both services to `0adedce…` (API; `backend/src` identical to the previous release) / `73814300b818c5fd0e74a821aad48ab98f99bcc3` (web) with `environmentStageChanges` + `environmentPatchCommitStaged`; no data migration to undo.
**Status: see §9.** The flow is proven end to end on synthetic identities against the deployed UAT. Full Signup E2E is **NOT declared PASS** until Partner3 itself (real owner, real mailbox, real e-mail) has gone through it.

## 1. The flow

| Step | What happens | Where |
|---|---|---|
| 1. Register | One form: Họ và Tên, Số Điện Thoại, Email. One `POST /partner-registrations` creates, all-or-nothing: an Auth identity (unconfirmed, **no password**), a `collaborators` row (`pending`, unverified) and a linked `user_profiles` row (`pending`). Success text: *"Đăng ký thành công. Hồ sơ của bạn đang chờ phê duyệt. Chúng tôi sẽ gửi email khi tài khoản được kích hoạt."* | `/collaborator/onboard` → `/success?type=partner-registered` |
| 2. Visible | The row exists immediately; Admin > Partners > Pending shows it ("Chờ phê duyệt") with name, phone, e-mail, code, date. | `/admin/collaborators` |
| 3. Approve | Admin approves: ownership verified, record + profile activated together, QR generated, `collaborator.approved` audited **once**, then the activation e-mail is triggered. | `POST /collaborators/:id/approve` |
| 4. E-mail | One message with a single button. Outcome (`sent` / `suppressed` / `failed` + reason) is audited as `collaborator.activation_email_*` and shown to the Admin. | `ApplicationEmailService` |
| 5. Activate | The link `…/auth/activate#token=…` signs the person in and opens `/collaborator/dashboard`. No password, no second form, no extra confirmation step. | `POST /auth/activate` |

Why there is **no password at registration:** the identity exists before anyone has proven they own the mailbox. A password chosen then would let a stranger who typed someone else's address log in as that person once the Partner is approved. The activation click is the proof of mailbox ownership (it sets `email_confirmed_at`). A password can be set afterwards (the portal shows a notice, §4) or later through "Quên mật khẩu".

## 2. Existing e-mail (checked before anything is created)

| Address already has | Answer (HTTP 200) | UI |
|---|---|---|
| a pending profile | `{outcome:"exists", state:"pending"}` | "đã đăng ký và đang chờ phê duyệt" |
| an active profile | `state:"active"` | "đã có tài khoản được kích hoạt" + Đăng nhập / Gửi lại liên kết / Quên mật khẩu |
| a rejected / suspended / inactive profile, an Admin-created or V1 Partner record nobody can sign in to, a Merchant owner record, or a pending invitation | `state:"support"` | "cần Admin hỗ trợ" — no new record is made |
| only an Auth identity (the old two-step signup was never finished, e.g. **Partner3**) | **adopted** — no second identity; an unconfirmed identity first loses any password someone set earlier (random value, never revealed); a confirmed one keeps its own | creates the pending application |

Never duplicated: identity, profile, Partner record. Concurrent submissions of one address are arbitrated by the existing case-insensitive unique index on `user_profiles(email)`; the loser is rolled back and told the current state.

**Enumeration / abuse protection** (there is deliberately no separate "is this e-mail registered?" endpoint): the only thing revealed is the coarse state above, to someone who submits the address; per-client (10 / 10 min) and per-address (3 / 10 min) limits → `429 REGISTRATION_RATE_LIMITED`; an hourly cap on new applications (`PARTNER_REGISTRATION_HOURLY_CAP`, default 60) → `503 REGISTRATION_BUSY`; a hidden honeypot field (looks successful, creates nothing); lookups are case-insensitive and treat `_`/`%` literally. Client address = platform edge value (`X-Real-IP`, else the right-most `X-Forwarded-For`). A CAPTCHA is **not** included; recommended before any public Production exposure.

## 3. Admin approval and the activation e-mail

* **Ownership check** before any write: exactly one account linked to the record; the Auth identity, the account e-mail and the application e-mail are the same address. Otherwise `409` `OWNER_NOT_CLAIMED` / `OWNER_EMAIL_MISMATCH` / `OWNER_AMBIGUOUS` / `OWNER_IDENTITY_MISSING`, nothing written. (E-mail *confirmation* is no longer required at approval — the activation link supplies it.)
* **Idempotent:** a second approve returns `already_approved:true` and writes, audits and mails nothing.
* **Mail never undoes an approval.** If delivery is suppressed by the recipient policy (`delivery_disabled` / `not_allowlisted` / `migrated_identity`) the account is not touched (no nonce is written). If SMTP fails the previous link state is restored. Both are audited and shown in the Admin drawer.
* **Retry without duplicates:** `POST /collaborators/:id/activation-email` (Admin) issues a *new* link (older ones stop working) and mails it; it never approves or creates anything. `GET /collaborators/:id/activation-status` feeds the drawer panel (has the person entered the portal, last attempts).
* Recipient policy is the platform's single one (delivery switch + allowlist + not a migrated V1 identity), identical to the Auth hook gateway.

## 4. Activation link

`<FRONTEND_URL>/auth/activate#token=<token>` — token = `base64url(claims).base64url(HMAC-SHA256)`.

* **Account-bound:** claims carry the Auth user id and Partner id; both must match the database.
* **Short-lived:** 24 h by default (`ACTIVATION_LINK_TTL_HOURS`, clamped 1–72).
* **Current only:** each e-mail writes a fresh nonce on the Auth user (`app_metadata.activation_nonce`); a newer e-mail or a spent link invalidates every older one.
* **Single use:** redemptions for one account run one at a time; the one that moves `user_profiles.login_count` from the value it saw to the next wins (compare-and-set, also safe across instances); a concurrent loser revokes **only its own** session. After success the nonce is cleared, so the same link never opens the account again.
* **Pre-account takeover closed:** an identity created before its mailbox was proven carries `app_metadata.activation_password_reset=true`. While set, **neither `/auth/login` nor `JwtGuard` (any API call, even with a direct Auth session) accepts it**, so a password somebody set through Auth's public sign-up gives nothing. The activation click replaces any password with a random one and clears the marker. Identities that proved their mailbox earlier (e.g. Partner3, confirmed) have no marker and keep their own password.
* **Mailbox proof & session:** the API mints a one-time Auth session server-side for exactly that account (this confirms the e-mail) and returns the same payload as `/auth/login`; the page stores the session and redirects to the dashboard. `collaborator.activated` is audited.
* **Never logged or exposed:** the token sits in the URL **fragment** (never sent to any server, log or Referer); the page moves it to memory, clears the address bar, and POSTs it in a body. It is not stored, not audited, not returned by any API. Audit rows carry only trigger, reason, masked recipient.
* **Failure copy** by stable code: `ACTIVATION_LINK_INVALID` (bad/expired/superseded), `ACTIVATION_LINK_USED`, `ACTIVATION_NOT_APPROVED`, `ACTIVATION_RATE_LIMITED`; expired/used links offer a resend form.
* **Resend:** `/auth/activate` without a token is the "send me a new link" form → `POST /auth/activation-link`, **always `202 {accepted:true}`** for any input; real work runs afterwards and only for an approved account that has not yet been used with a **password** (entering through a link counts once, so a link consumed by a mail scanner never strands the person), ≤ 3/h per address, ≤ 10/h per client, 2-minute cool-down per account. Link-only Partners can use the same form as their way back in.
* After the first entry the portal shows *"Đặt mật khẩu để đăng nhập lần sau"* (until a password login has happened), linking to the existing password setting.

## 5. Atomicity — what it is and is not

Supabase's client has no multi-table transaction and a database function would need a migration (out of scope). So "atomic" is implemented as **all-or-nothing with compensation**: create identity → Partner row → profile (unique-index arbitrated) → audit; on any failure the later steps are undone in reverse and a newly created identity is deleted, and the caller is told nothing was created (`500 REGISTRATION_FAILED`). Proven by `test:partner-single-step` (forced profile-insert failure leaves 0 identities, 0 records, 0 profiles; a clean retry then succeeds). A process crash *between* two writes could still leave a fragment; a Postgres RPC (migration) would remove that last window if the owner wants it.

## 6. Existing UAT data — Partner3

`andyduong2412+uat-signup-partner3@gmail.com` (checked read-only 2026-11-08, `partner-flow-status.mjs`): Auth identity `3461e4ce-…` created 2026-11-07T16:58:22Z, e-mail confirmed 16:58:58Z, last sign-in 06:48:02Z today; **0 profiles, 0 Partner records**; Auth metadata holds only `requested_role=collaborator` (no name, no phone). Nothing was stored that could be reused, and nothing was invented. Partner3 signed in again at 02:38Z, 04:02Z and 06:48Z today (the last two after the Step 2/2 release); none reached a submit (Railway HTTP log: no `POST /collaborators` at any time).
With the new flow Partner3 needs **one** thing: the owner types their own name and phone into `/collaborator/onboard` (the e-mail is pre-filled from the last login attempt). The existing identity is adopted (no second identity); the application then follows §1. The old password stays valid because that e-mail was confirmed.

## 7. Changes

Backend: `modules/partner-registration/*` (new), `modules/activation/*` (new), `common/http/rate-limiter.ts` (new), `auth` (`/auth/activate`, `/auth/activation-link`), `collaborators` (approve rewrite, retry/status routes), `application-email.service.ts` + `email-templates.ts` (activation e-mail, outcome-reporting delivery).
Frontend: `/collaborator/onboard` (single form), `/auth/activate` (new), `/success` (new type), login/signup copy, Admin > Partners (activation panel, retry, e-mail outcome in the approve notice), `RoleDashboardShell` (set-password notice), `login-resolve` (Partner needs no session).
Tests: `backend` `test:partner-single-step` (24 controls, in-memory Supabase), frontend `partner-registration.selftest.ts`, E2E `98-partner-single-step.spec.ts` (replaces the Step 2/2 spec 97); specs 60/90/95/96 now cover the Merchant only (Partner parts moved to 98). New read-only tool `e2e-uat/tools/partner-flow-status.mjs`.
Not changed: Merchant flow, V1/migrated data, Auth e-mail hook, allowlist, Supabase Auth settings.

## 8. Independent security review (fresh reviewer, code only) and what was done

| # | Finding | Disposition |
|---|---|---|
| 1 | **High.** A stranger can register someone's address, then set a password on the unverified identity through Auth's public sign-up; after the owner's click confirms the e-mail, that password logs in as the Partner | **Fixed** (marker + guard + password replacement, §4). Reproduced end to end in spec 98 **S10b** against real Supabase Auth: before the click `/auth/login` 401 and a direct Auth session gets 401 on `/user-profiles/me`, `/collaborators/me`, `/collaborators/me/qr-code`; after the legitimate click the attacker's password is rejected by Auth (400) and the owner's session works |
| 2 | Medium. The page redeems on load, so a JavaScript-executing link scanner can spend the link, and resend then refused (dead end) | The one-click behaviour you specified is **kept** (a confirm button would be an extra step). The dead end is **removed**: resend stays eligible until a password login exists; invalid/used copy now says some mail apps spend links; a lost-response message no longer claims the link is unused. Residual: such a scanner costs one resend |
| 3 | Medium. The loser of a concurrent redemption signed out ALL of the user's sessions | **Fixed:** local sign-out of its own session only; per-account lock; optimistic compare-and-set |
| 4 | Medium. `X-Real-IP` trusted before the right-most `X-Forwarded-For` | **Reordered.** Railway's header handling could not be verified from here; the per-address limits and the hourly cap do not depend on it |
| 5 | Medium/low. Two simultaneous approvals could both pass; a crash between the record and profile updates left an active Partner that could never be activated | **Fixed:** conditional update + per-record lock; the next approve finishes an interrupted one (profile repaired, audited `collaborator.profile_repaired`, one e-mail) |
| 6 | Low. Nonce read-modify-write race between two sends | **Fixed** by the per-account send lock |
| 7 | Low. Anyone can use up a victim's resend quota or pre-register an address with their own name/phone | **Accepted / documented** (§10) |

## 9. Evidence

| Check | Result |
|---|---|
| Backend `test:partner-single-step` (in-memory Supabase, forced failures, races) | **29 controls PASS**; `test:approve-unclaimed` 7, `test:auth-email-hook` 15, `test:public-catalog` 14, `test:invitation-guards` 3 PASS. `test:email-delivery` 37 pass / **2 fail — the same 2 fail with these changes stashed** (pre-existing hook signup/recovery link cases) |
| Frontend `tsc`, eslint (0 errors; 10 pre-existing `<img>` warnings), self-tests, clean build | PASS |
| Candidate (local web+API on UAT data): 00, 20, 30, 40, 95, 98 | 49 pass + spec 98 **14/14**; only X10/X11 (spec 40) fail — **pre-existing** (QR payload host / V1 shared codes), identical before this work |
| **Hosted UAT** (deployed web + API) spec 98, run `20261108084348` | **14/14 PASS** |
| `smtp:check` against the UAT SMTP settings | config OK, authenticated encrypted session accepted, **no message sent** |

Hosted run `20261108084348` (synthetic `@vno-uat-synthetic.example`, `e2e-uat/evidence/partner-single-step-20261108084348.json`):
* **Register:** `POST /partner-registrations` **201** at 08:44:14.9Z → `COL-14325597918974B9`, record `457aedb3-92ac-4b25-82b5-34ccff7f2689` (pending, unverified), Auth user `9c260f5e-…` (unconfirmed, no password), 1 linked pending profile; audit `collaborator.application_submitted` 08:44:16.8Z; success text exactly as specified.
* **Admin Pending immediately:** count 5 → 6, row + drawer with name/phone/e-mail/code; same address again → **200** `{exists, pending}`, still 1 record/1 profile/1 identity.
* **Before approval:** `/auth/login` 401; forged link 401 `ACTIVATION_LINK_INVALID`; valid-signature link 403 `ACTIVATION_NOT_APPROVED`.
* **Approve:** `POST …/approve` **201** (audit `collaborator.approved` 08:44:32.8Z, once); record + profile `active`, QR; `activation_email = suppressed (not_allowlisted)` because the synthetic domain is outside the allowlist (the approval stands, outcome audited); Admin retry **201** without a second approval; second approve → `already_approved`; address again → **200** `{exists, active}`.
* **Activation:** link signed with the server secret (stand-in for the mailbox) → `POST /auth/activate` **201** → `/collaborator/dashboard`; `email_confirmed_at` 08:44:48.8Z (set by the click), `login_count` 1, `collaborator.activated` 08:44:49.3Z, QR `GET /collaborators/me/qr-code` **200** payload `https://vno-web-uat.up.railway.app/c/COL-14325597918974B9`; the token appears in no address bar and no request URL; second open → 401; expired link → resend form; `/auth/activation-link` → identical **202 `{"accepted":true}`** for registered, unknown and malformed addresses.
* **Adoption (Partner3 situation):** confirmed Auth identity + password + no profile → one registration → same identity linked (`8c775ada-…`), 1 record + 1 pending profile, old password still valid; its application was then approved so the owner's Pending list is back to the original **5**.
* A first hosted attempt failed at the Admin approve click with `net::ERR_NETWORK_IO_SUSPENDED` (the test machine's own network was suspended for an instant; the Railway log shows the client closed the request at 499 ms). The server had received it and completed the approval and the audit rows normally; the rerun above is clean. Nothing was left pending.

**What is NOT proven yet:** delivery of the real e-mail to a real mailbox (synthetic domains are outside the allowlist, by design) and the click from that mail. That needs Partner3 (§11).

## 10. Residual risks (owner awareness)

* **No CAPTCHA** on the public form. Mitigations: per-client and per-address limits, hourly cap (60), honeypot. Add a CAPTCHA before any public Production exposure. Limiters are in process memory (one API instance) and reset on deploy.
* **Registration without verification is inherently open to squatting:** anyone can submit someone else's address with their own name/phone, and can lock that address's own submit (3 per 10 min). The Admin review is the control; the activation e-mail only ever goes to the real mailbox. Likewise 3 anonymous resend requests per hour can exhaust a victim's self-service resend (Admin retry still works).
* **Atomicity** is all-or-nothing with compensation, not a database transaction (§5).
* **Link scanners** that execute JavaScript can spend a link; recovery is a resend (§8 #2).
* Merchant signup still has the confirm-then-submit flow. Same pre-account-takeover reasoning applies to it only in a different form (its password is chosen before confirmation, but the Merchant session cannot act until Admin approval and e-mail confirmation); it was not changed.

## 11. Partner3 — what happens next

Nothing is invented. When the owner is ready (any browser; no Admin session needed in it):
1. Open `https://vno-web-uat.up.railway.app/collaborator/onboard`, type **their own name and phone**, e-mail `andyduong2412+uat-signup-partner3@gmail.com`, press **Đăng ký**. Expected: HTTP 201, the exact success text, the existing Partner3 identity adopted (no second identity).
2. Admin > Partners shows it under **Chờ phê duyệt** at once. Admin approves (approve → activation e-mail to Partner3's real mailbox, which is on the allowlist, `AUTH_EMAIL_DELIVERY=enabled`).
3. The owner opens the e-mail and clicks the single button → lands on the Partner dashboard with no password and no form.
Evidence to be captured for each step: `railway run --service vno-api -- node e2e-uat/tools/partner-flow-status.mjs andyduong2412+uat-signup-partner3@gmail.com` (states, statuses, audit rows incl. `collaborator.activation_email_sent`/`collaborator.activated`) plus the Railway HTTP log for the real `POST /partner-registrations`, `POST …/approve`, `POST /auth/activate` and `GET /collaborators/me/qr-code`. Only after all of that is Signup E2E PASS.

