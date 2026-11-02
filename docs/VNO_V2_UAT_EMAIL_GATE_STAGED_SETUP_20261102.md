# VNO V2 — Gate A closed, Gate B staged (2026-11-02)

Deployed API/Web is still `f89dfb909c230abae28579568c2e9249d96522af`. Nothing was deployed. **No Auth, SMTP, hook or Railway setting was changed and no email was sent.** The only hosted write is the approved migration below. Evidence: `migration/v2/evidence/gate-a-20261102/`.

| Gate | Result |
|---|---|
| A — invitation migration | **PASS** (applied, verified) |
| B — real-email UAT | **PREPARED, NOT ENABLED** (security verification PASS on a real Auth stack; provider/deploy steps await owner inputs) |

## Gate A — result

Connectivity: Postgres on 5432/6543 is unreachable from this machine, so the script runs through `supabase db query --linked` (Management API over HTTPS, the owner's CLI login). Project verified as `hsezyogfxgnkpweoqqny` (linked ref and pooler user), migration file sha256 `cc7be772c185a4e06ad11667d1dfdfba3dca48ee5df72478b7084b7963f5c0cb` (committed, unmodified).

* Hosted dry-run: PASS, nothing persisted (read-back: 4 links still present, history target absent).
* Apply (`apply-invitation-hardening.sh apply <sha256>`, single transaction): PASS.
* Independent read-back: stored links 4 → **0**; 4 invitations unchanged (all `accepted`, every other column identical); history 12 → 13 rows, latest `20261102000001`, no duplicates; RLS on, one `service_role_only` policy, `anon`/`authenticated`/`PUBLIC` privileges 0, `service_role` grants intact; column comment set.
* Preserved data: all 25 other public tables identical by row count **and** content hash (16 934 rows), `auth.users` 475, `storage.objects` 616, `legacy_identity_map` 451, batch still `validated`. Read-only reconcile afterwards: 20 PASS / 0 FAIL / 2 NOT_RUN (C17/C18 need SQL over 5432; they passed earlier today and this change touches only `invitations`).
* Backend invitation suites: guards 3/3, approve-unclaimed 7/7 (local). **Not run:** live hosted create/claim/revoke/replay (needs fresh identity pair and a mailbox; it belongs to the Gate B mailbox E2E).

## Gate B — security verification (PASS)

Hosted cannot test the hook before it is enabled, so it was verified on a throwaway real stack: GoTrue v2.197.0 (same major line as the clone) with the Send Email hook enabled → the real gateway code → a local STARTTLS sink, over a database copy holding the 451 real migrated identities. 12/12 PASS: allowlisted signup/recovery send exactly one message; non-allowlisted signup/recovery send nothing and Auth still answers 200 (no existence leak); a plus alias does not widen; a **migrated user is never mailed even when its address is deliberately allowlisted**; delivery `disabled` sends nothing; gateway down = Auth error and nothing sent; unsigned or wrong-secret calls get 401. Full list in `hook-e2e-results.txt`. Rig and copy were deleted afterwards. Unit suite 12/12.

Correction of an earlier statement of mine: the original migrated-identity lookup was **not** broken. `legacy_user_id` equals `auth_user_id` for all 451 rows (checked on hosted too), and the previous code also blocked the migrated user. The new lookup (`auth_user_id` **or** `source_email_sha256`, fail closed) is defence in depth only.

### Reviewed API delta (minimal, API only)
Backend-only changes since the deployed SHA; the web service is not touched:

| File | Change |
|---|---|
| `backend/src/modules/auth-email-hook/*` | new module (controller, service, policy, templates) from commit `93f701c` + hardening below |
| `backend/src/app.module.ts` | registers the module |
| `backend/src/main.ts` | keeps `rawBody` only for `/auth/hooks/*` (needed for signature verification) |
| `backend/package.json`, `package-lock.json` | `nodemailer` (+ types) |
| `backend/scripts/test-auth-email-hook.ts` | 12 tests |

Hardening since `93f701c`: migrated lookup by id **or** e-mail hash; STARTTLS required on 587 and 3/3/4 s SMTP timeouts (Auth abandons a slow hook); bilingual branded templates with plain-text part; `rawBody` scoped. The route is inert without `AUTH_EMAIL_HOOK_SECRET` (503) and sends nothing unless `AUTH_EMAIL_DELIVERY=enabled`.

**Known limit:** `email_change` is mailed only to the user's current address, never to a non-allowlisted new one; confirming a *new* address is out of scope for UAT.

### Templates and mobile acceptance (PASS locally)
Vietnamese first, English second, in one message; brand header, 16 px text, full-width button ≥ 48 px, visible copy-able fallback link, plain-text part, UAT notice, `[UAT]` subject prefix; types: signup, invite, magic link, recovery, email change, reauthentication. Chromium render at 320/360/390 px for recovery, signup and invite: 9/9, no horizontal overflow (screenshots in the evidence folder). **Still to do on real devices** (needs real delivery): tap the button from the Gmail app on iOS and Android and from desktop Gmail; the link must open the right web screen (reset-password / claim), a second tap must show the expired state, and dark-mode rendering must stay readable.

## Deployment plan (API only, needs your approval)
1. Commit exactly the files in the table above (plus the new migration tooling and docs if you want them recorded); never `backend/dist`, `.env` or evidence PNGs/JSON you do not want in Git. Push the branch.
2. Stage only the **API** service's `source.commitSha` to that commit with the Railway `environmentStageChanges` mutation (as in the 2026-11-02 release); review the staged patch; commit it. Do not stage the web service.
3. Verify after deploy: `/health` 200; `POST /auth/hooks/send-email` unsigned → **503** (no secret yet; never 200); anonymous privacy suite 9/9; `00-unauth` + `20-regression` hosted suites unchanged.
4. Rollback: re-stage API `source.commitSha = f89dfb909c230abae28579568c2e9249d96522af`.

## Provider and secrets — superseded

**Owner decision (2026-11-02): AWS SES is not used.** The existing VNO e-mail service will be reused. The provider-neutral SMTP integration, the complete environment-variable matrix (host, port, security mode, credentials, sender, hook secret, exact tester allowlist), the Auth review, the activation steps, the rollback and the troubleshooting are in **`VNO_V2_UAT_EMAIL_GATE_B_RUNBOOK_20261102.md`**. The Railway-secrets table and the "Order after approval" list below are kept only as the earlier outline; where they differ (single `AUTH_EMAIL_ALLOWLIST` instead of two lists, `SMTP_SECURITY`, hook enabled only after the secret is in Railway), the new runbook wins.

## Order after approval (each step reversible; stop at the first failure)
1. Deploy the API (above). Set Railway variables with `AUTH_EMAIL_DELIVERY=disabled`.
2. Enable the Send Email hook. With delivery disabled, signup/forgot-password for an allowlisted alias **and** an owner-controlled non-allowlisted mailbox must both log `suppressed delivery_disabled` and deliver nothing (**G1**: the hook is the only sender). Never submit a migrated V1 address to the live forms (**G3** is proven on the real-stack rig above).
3. Provider-side proof if the provider supports a recipient restriction, otherwise gateway-only accepted by the owner (**G2**).
4. Only now set `AUTH_EMAIL_DELIVERY=enabled`: allowlisted aliases get exactly one message per action (**G4**); the non-allowlisted mailbox still gets nothing; `legacy_identity_map` count 451 and `last_sign_in_at` unchanged (**G6**).
5. Mailbox E2E: signup verify → login → forgot/reset (second use expired) → invitation to a `+merchant`/`+partner` alias (wrong-mailbox negative) → pending approval → admin approval → role redirect, plus the on-device link and dark-mode check above; then `INVITATION_DELIVERY=email`.
6. Emergency stop: disable the hook in Auth (immediate); `AUTH_EMAIL_DELIVERY=disabled` takes effect after the Railway redeploy (≈ 1–3 min).

## Remaining owner inputs
See section 3 of `VNO_V2_UAT_EMAIL_GATE_B_RUNBOOK_20261102.md` (VNO e-mail service SMTP facts, tester addresses, sign-up decision, approvals).

Not blockers for this gate but still open for business UAT: discount conditions/coordinates absent in the data, admin/merchant sub-pages on legacy styles, money display precision, public rate limiting, physical QR cards for `C2500228`/`C2500240`.
