# VNO V2 — Business UAT UX & Core Experience Stabilization (2026-11-02)

**Status: implemented and tested LOCALLY. Nothing is committed, pushed or deployed. Hosted UAT still runs the previous build.**
Base commit `6bbf232` on `codex/vno-phase-d4-security` plus the uncommitted working tree described below. The validated Snapshot-5 batch, historical financial data, Production, V1, Auth/SMTP settings and Railway were not modified.

## 0. Urgent finding (live on hosted UAT today)

The anonymous endpoint `GET /merchants/verified` returns **every column of all 144 verified Merchants**, including owner name, owner phone, owner e-mail, tax code and all `legacy_*` fields (4.5 MB; 142 rows with an owner e-mail). The data is migrated V1 owner contact data. This is a privacy exposure on the deployed UAT API and would be in Production. The fix (allow-listed projection) is in this release; **until it is deployed the exposure remains**. Recommend deploying this release (or at minimum the backend part) first, after owner approval.

## 1. Root-cause findings (database → backend → frontend)

| Symptom | Root cause |
|---|---|
| Merchant cards do nothing; no detail page | `app/page.tsx` rendered 8 **hard-coded demo listings** (Unsplash photos, "Luxury Hotel Saigon"…) with `onClick`-less cards; no `/merchants/<id>` route and no public detail API existed |
| "Restaurant" shows 0 listings | The category filter compared the DB category name (`restaurant`) with the demo listings' own strings ("Fine Dining"). The database is fine: 36 verified Merchants are linked to `restaurant` |
| Broken category icons | `categories.category_icon` stores Font Awesome class strings (`fa-regular fa-shirt`) or junk (`Sing `); the UI printed them as text; the core categories have no icon at all |
| Real data could not be shown | No public API returned categories, images or offers per Merchant; `/media/approved/...` returns 5-minute signed URLs per owner (unusable for a grid) |
| Card images (once wired) were blank/slow | Approved originals average 1.2 MB (max 4.5 MB). Supabase Storage image transformation is enabled on UAT (4.4 MB → 31 KB), so the fix is server-side renditions, not client tricks |
| Partner QR hard to find | The working QR page was buried under `/collaborator/dashboard/qr-code`; the older `/collaborator/qr-code` page read `response.data`, which the API client never returns, so it could never show a QR |
| Pending accounts stuck on "Đang tải…" | `RoleDashboardShell` redirected a bound-but-unapproved user to the same page forever (e.g. right after claiming an invitation) |
| Invitation token exposure | The Supabase action link (a bearer credential) was stored in plaintext in `invitations.invite_link` and returned by the admin read endpoints. Revoking only flipped a status; the already issued link still created a signed-in Auth user |
| Claim page English/Vietnamese mix, no expired/revoked guidance | Single generic error string; claim page was the only English screen |

## 2. Implemented

**Backend**
* New `public-catalog` module (anonymous, read-only): `GET /public/categories` (only categories that have listings, with counts), `GET /public/merchants?category=&q=&page=`, `GET /public/merchants/:id`, `GET /public/media/:assetId?size=thumb|card|hero|original` (302 to a short-lived signed rendition; 404 unless the asset is approved + verified and its Merchant is publicly listed). Strict column allow-list: no owner identity, no `merchant_email`/`merchant_phone` (these equal the owner's personal e-mail/phone for 141/144 and 139/144 rows), no commission, no `legacy_*`. Markdown/HTML in descriptions flattened to text. Offers are customer discounts only; 0%/missing → no badge. Listings with an approved photo and an offer rank first (nothing hidden).
* `/merchants/verified` now uses the same allow-list (compatibility kept).
* Invitations: the link is never persisted or returned by read endpoints; it is shown **once** at creation (`INVITATION_DELIVERY=capture`, default). `INVITATION_DELIVERY=email` makes Supabase Auth send it, only to recipients in `INVITATION_EMAIL_ALLOWLIST` (exact addresses or `@domain`), refused before any Auth call otherwise. Revoking also deletes an invite-created Auth identity that never signed in, never confirmed and has no profile, which kills the emailed link. Migration `20261102000001_vno_invitation_link_hardening.sql` clears stored links (**not applied**).
* Partner QR image generated at 720 px (crisp download); still generated from the current code on every call.

**Frontend** (design system documented in `docs/VNO_V2_DESIGN_SYSTEM.md`)
* Tokens + shared components (`components/ui`, `components/public`); Lucide icons replace glyphs/emoji/Font Awesome text.
* Home: real listings, URL-driven category + search filters, "Xem thêm" pagination, skeleton/empty/error states (error ≠ empty), responsive images, offer badges.
* `/merchants/[id]`: gallery, categories, address + map link, description, offer and its condition text, business phone, "unavailable" states, 404 vs error.
* Partner Home: prominent QR card (enlarge dialog, PNG download, mobile layout, locked state before approval); legacy page redirects.
* Login (actionable messages: wrong credentials / pending approval / inactive / unconfirmed), signup selector, forgot/reset (invalid + expired link paths), claim (expired, revoked, used, wrong e-mail, already has account, retry), pending/inactive account status screen.
* Admin layout + dashboard, Merchant/Partner shells rebuilt on tokens (responsive menu, bottom tab bar). Deeper admin/merchant sub-pages keep their legacy inline styles (see gaps).

## 3. Test results (release candidate: local web `:3011` + local API `:3100` on hosted UAT data; E2E_TARGET=candidate)

`e2e-uat/tests/00-unauth.spec.ts` + new `tests/40-experience.spec.ts`: **27 passed, 0 failed, 0 skipped.** Backend: D6 28, D13A 37, media-lifecycle 9, invitation-guards 3, approve-unclaimed 7, public-catalog 9 — all PASS. Typecheck (backend, frontend, e2e) clean; frontend ESLint 0 errors; `next build` OK.

| # | Required coverage | Result | Evidence |
|---|---|---|---|
| 1 | Public detail + category navigation | PASS | X01–X05 (144 real listings, Restaurant = 36, card → detail, refresh + fresh-tab deep link) |
| 2 | Approved image identity and rendering | PASS | X07: public `size=original` bytes = governed admin object (SHA-256) + stored size for 12 listings; X07b card rendition 70 KB; X01b/X05/X09 decoded photos |
| 3 | Partner QR visibility, download, scan | PASS | X10: QR on Partner Home decodes (jsQR) to the canonical code, enlarge dialog, download `VNO-QR-<code>.png`, Merchant `POST /qr/resolve` → same Partner, `financial_action_created:false` |
| 4 | Login/signup/reset/invitation through **real test e-mails** | **NOT RUN** | No custom SMTP exists/approved; see §5 |
| 4' | Same flows, UI states without sending mail | PASS | X13 (invalid login, role routing), X15 (reset none/expired, claim expired/no session, forgot confirmation with Auth call stubbed), X16 (pending state) |
| 5 | Role navigation + isolation | PASS | X13, X14, X12 |
| 6 | Desktop and mobile | PASS | X09, X17 (admin/merchant/partner at 1366 and 390 px, no horizontal overflow) |
| 7 | Error / loading / empty / expired-link states | PASS | X06, X05 (404), X15 |
| 8 | No unexpected messages to migrated users | PASS (by construction) | No test sends e-mail; logins used only synthetic identities; invitation e-mail path is off by default and allow-listed |
| 9 | Historical financial records unchanged | PASS with one explained FAIL | Hosted read-only reconcile after all testing: C1–C16, C19, C20, C22, C23 PASS (105 transactions amount-for-amount, totals = V1, 602 media SHA-256, pre-existing rows byte-identical). **C21 FAIL**: compares to the pre-finalization state file; the two differences are `legacy_migration_batches.status` (`validated`, the authorized finalization) and `user_profiles` login tracking of 11 synthetic admin/merchant/partner profiles. 0 of 451 migrated users has any login. C17/C18 NOT_RUN (no DB password in this session) |

Other verified facts: anonymous `/public/*` and `/merchants/verified` contain no `owner_*`, `legacy_*`, commission, tax code or e-mail in structured fields (X08); the 4 remapped Partners resolve only by their new unique codes and `C2500228`/`C2500240` resolve to nobody (X11). Screenshots (desktop/mobile/QR/states) and traces: `e2e-uat/evidence/` (git-ignored). Reconcile evidence: `migration/v2/evidence/experience-release-20261102/`.

## 4. Proposed UAT release SHA

**None yet.** A SHA exists only after the working tree is committed, and no commit/push/deploy was requested. Proposal: after review, commit this tree on `codex/vno-phase-d4-security` (base `6bbf232`), re-run the candidate suite on that exact commit, then deploy that SHA to `vno-api-uat` and `vno-web-uat` together (the new frontend requires the new `/public/*` API). The currently deployed Railway SHA could not be read from this session; behaviour (demo home, full-row `/merchants/verified`) shows it predates this work.

## 5. Remaining business-acceptance gaps

1. **Real-email onboarding is untested.** Needs the owner to approve a UAT-only custom SMTP (separate sender/credentials), the tester allowlist, and a read of the hosted Auth templates, redirect URLs and hooks (not exposed by the API; still unverified). Then run signup → confirmation → login → forgot/reset → admin invitation → claim with real tester mailboxes. Keep `INVITATION_DELIVERY=capture` until then; never enable it without the allowlist.
2. Deploy needed to close the §0 exposure on hosted UAT.
3. Migration `20261102000001` (clear stored invite links) is not applied. Hosted UAT holds 4 invitations, all `accepted` (their links already consumed) and none pending, so the migration affects no live Auth link.
4. Discount **conditions** do not exist in the imported data; the page states the generic QR rule. Merchant-specific conditions need a business-defined field. No coordinates exist (map link is built from the address); only the business contact phone is public (no e-mail/website).
5. Data quality: many imported Merchants have names like `1-39`, unaddressed or imageless records (115 Merchants in the whole table have an approved photo; listings without one show a category placeholder). Content cleanup is a business task.
6. Merchant/Admin **sub-pages** (orders, payments, reports, master data, approvals) and onboarding forms still use legacy inline styles; shells and dashboards are done. Dead files `app/page_old.tsx`, `app/page_backup.tsx` and the legacy `/user-login` remain.
7. Partner QR was exercised in a real browser with the synthetic verified fixture Partner only (migrated Partners' logins are out of scope by policy); the 4 remapped Partners are verified at API level (X11) and by the code path (QR is generated from the current code). Physical cards for `C2500228`/`C2500240` must still be replaced (Snapshot-5 closure note).
8. Money displays keep 4-decimal stored precision (`11.889,5936 ₫`); a display-rounding policy is a business decision.
9. Public endpoints have no rate limiting (the whole API has none); `/public/media` creates signed URLs on demand.
10. Existing suites `10-onboarding`, `20-regression`, `30-operational` were not re-run (they create records in hosted UAT). Only one assertion in `10-onboarding` changed (claim success text now Vietnamese); it needs a run with a fresh identity pair.
11. Optional DB hardening from earlier closures (UNIQUE `collaborators_code`, `completed_at` on the validated batch) is still open.

## 6. How to re-run

```
# local candidate (hosted UAT data, read-only for discovery)
cd backend && PORT=3100 CORS_ORIGINS=http://localhost:3011 npx ts-node --transpile-only src/main.ts
cd frontend && NEXT_PUBLIC_API_URL=http://localhost:3100 npx next build && npx next start -p 3011
cd e2e-uat && npm run test:e2e:candidate
```
Candidate mode only relaxes the web/API hosts to loopback; the Supabase host stays pinned to UAT and the default (hosted) mode is unchanged.
