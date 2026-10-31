# VNO V2 UAT end-to-end suite

Playwright suite for the hosted Railway UAT (`vno-web-uat` / `vno-api-uat` / Supabase `hsezyogfxgnkpweoqqny`).
The target is hard-pinned: any other host makes the suite refuse to start.

```
cd e2e-uat && npm install && npx playwright install chromium
npm run test:e2e:uat           # everything; tests without credentials report SKIP, never PASS
npm run test:e2e:uat:smoke     # credential-free checks only (@unauth)
```

Evidence (git-ignored) is written to `e2e-uat/evidence/`: `report-<run>.md`, `steps-<run>.jsonl`, `html-report/`, and screenshots/traces for failures. Passwords, JWTs, claim links and bank fields are redacted before anything is written. Video is disabled on purpose.

## One-time identity setup (owner action, no SMTP needed)

The suite logs in through the normal Supabase password login. It never uses the service-role key and never mints sessions. You provide four dedicated synthetic users:

1. **Create the Auth users** in Supabase Dashboard → Authentication → Users → *Add user* → *Create new user*, tick **Auto Confirm User**. Use synthetic addresses you control (e.g. `uat-e2e-admin@…`, `uat-e2e-merchant@…`, `uat-e2e-partner@…`, optional `uat-e2e-outsider@…`). Email verification stays enabled for everyone else.
2. **Make only the admin an application Admin.** The app decides Admin from `public.user_profiles` (`AdminGuard`: `role='admin'` and `user_profiles_status='active'`). The shape below is the exact insert the application itself performs (`UserProfilesService.createOrUpdate`); an admin has no tenant, so `merchant_id` and `collaborator_id` must be NULL. Run it once in the Dashboard SQL editor with the admin's Auth user id:
   ```sql
   insert into public.user_profiles (user_id, email, role, merchant_id, collaborator_id, login_count, user_profiles_status)
   values ('<admin auth user id>', '<admin email>', 'admin', null, null, 0, 'active');
   ```
   Login does not depend on Auth metadata. If the insert reports a missing required column, stop and report it rather than guessing: the table DDL is not in the repo. Do **not** create profiles for the Merchant, Partner or outsider users; they get profiles through the invitation claim, which is what is tested.
3. `cp env.uat.example .env.uat.local` and fill in the emails and passwords. The file is git-ignored; never paste it into chat or logs.

## Test lifecycle (fixture rules)

| Layer | Files | Creates/claims identities? | Runs when |
|---|---|---|---|
| Credential-free | `00-unauth` | no | always |
| **First-time onboarding** | `10-onboarding` | **yes: consumes one unclaimed Merchant + one unclaimed Partner** | only if the pool has an unclaimed pair; otherwise every test SKIPs (O00). Claimed identities are never reused to imitate a fresh claim |
| Authorization regression | `20-regression` | no | owner-role tests use only the paired fixture; otherwise SKIP |
| **Reusable operational** | `30-operational` | no | needs `.auth/fixture.json`; verified on every run (same-run records, both active, app reports `assigned_to_this_merchant`) or BLOCKED. Never substitutes other identities |

A successful onboarding run writes `.auth/fixture.json` (git-ignored; contains credentials). `npm run fixture:adopt` can adopt an already-claimed pair, but only if it proves a same-run pair (`UAT-E2E-M-<run>` + `UAT-E2E-P-<run>`, both bound and active, app-confirmed pairing); otherwise it refuses.

Fresh pair for a new first-time run: create two Auto-Confirmed Auth users (no profile) and add them to `.auth/identity-pool.json` as `{"merchant":[{"email","password"}],"partner":[{"email","password"}]}`. Consumed identities are tracked in `.auth/consumed.json`.

## Behaviour notes

- **Run id**: every run has a unique `RUN_ID` used in names, image seeds and evidence; operational tests use a fresh idempotency key.
- **Image identity**: the suite hashes the bytes served by the approved-media feed and by the owner's browser and compares them with the generated upload (SHA-256), before and after reload.
- **No cleanup of financial records**: simulation transactions and audit rows are intentionally kept.
- **Email-dependent scenarios** (self-service recovery, emailed invitations) are out of scope until SMTP exists.
- The onboarding spec (O01–O09) needs a fresh pair and has not yet executed against hosted UAT; the hosted operational and regression specs have.
