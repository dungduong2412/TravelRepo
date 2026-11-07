# VNO V2: final password policy (UAT), 2026-11-07

**Policy (owner decision):** minimum 8 characters, at least 1 letter (a-z/A-Z), at least 1 digit. No uppercase or special-character rule. Supabase leaked-password rejection off.
**Deployed:** vno-web `8072f3e` (message handling only). vno-api unchanged (`f5c9a82`). No migrations, no allowlist change, no Production action.

## Root cause of the owner's Partner-signup rejection
Supabase UAT was rejecting well-known leaked passwords (`422 weak_password`, `reasons:["pwned"]`, reproduced 01:35Z with synthetic probes). The app mapped every `weak_password` to
"8 characters, 1 letter, 1 digit", which is false for a compliant password. The setting was then switched off (probe at 02:45Z: the same passwords return 200). I did not switch it and cannot read the Dashboard toggle; the evidence is behavioural.

## Changes (frontend only, commit 8072f3e)
* `lib/password-policy.ts`: one rule, one hint, one error; new `PASSWORD_SERVER_REJECTED` (used only when the client check already passed, so it says the password meets the rules and is not asking for anything more complex).
* `lib/auth-errors.ts`: `weak_password` -> that text (signup and reset); new `passwordUpdateMessage()`.
* Account Change Password: no longer shows raw English Auth text; First Password: no longer one generic line for every failure; Partner signup now shows the same visible hint as Merchant.

## Policy parity
| Surface | Rule source | Result |
|---|---|---|
| Merchant / Partner signup, Reset, First password, Account change | `frontend/lib/password-policy.ts` | same regex, same hint, same message |
| Backend managed-user creation | `user-profiles.dto.ts` | parity matrix 14/14 identical accept/reject vs frontend |
| Supabase Auth (UAT) | Dashboard | behaviour matches: 7 chars, letters-only, digits-only -> 422 weak_password (not pwned); 8-char lowercase+digit, `password123`, `Password123`, `Qwerty123`, no-uppercase, symbol-containing -> 200 |

## Hosted evidence (synthetic accounts only, `*@vno-uat-synthetic.example`)
* `tests/90-password-policy.spec.ts`: **14/14 PASS** (8 accept cases incl. 3 known-leaked, 3 reject cases, Merchant + Partner signup form, reset-password flow incl. old password refused).
* `tests/60-auth-signup.spec.ts` with `E2E_SIGNUP_PASSWORD=password123`: **12/12 PASS** (both roles: register, unverified cannot sign in, confirm once, pending profile, admin approve + login, duplicate rejected, **SG6 Account-settings change to a leaked-style password**). First run: SG6 failed on a selector in my new test (Next route announcer also has role=alert), fixed, rerun 12/12.
* Protections: allowlist still exactly 6 entries; 17 synthetic signups all `suppressed … not_allowlisted`, 0 mails sent; 0 leftover `policy-probe`/`uat.pwpolicy` users; no staged Railway patch.

## Not covered (stated plainly)
* **First Password hosted E2E: NOT RUN.** It needs an invitation-claim flow; covered by code audit, shared constants, typecheck, classifier selftest only.
* Dashboard toggle not read directly (no readable token); behaviour is proven, the setting screenshot is the owner's to attach if wanted.
* Login field has `minLength=6` (sign-in only, not a creation rule); left unchanged.
* Real-mailbox signup/recovery acceptance by the owner is still open; no recovery token was generated for any owner alias.
* Spec 60 leaves approved synthetic merchant/partner records in UAT (as in earlier runs).
