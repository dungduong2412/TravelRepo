# VNO V2 — Merchant profile save and Partner–Merchant association (2026-11-08)

> **SUPERSEDED IN PART (2026-11-09).** Issue 1 (Merchant profile save) stands. **Issue 2 (§2) and its acceptance rows 4–8 are superseded**: the Partner-to-Merchant assignment this release treated as a prerequisite was an incorrect business restriction. Every active Partner works with every active Merchant. See `docs/VNO_V2_GLOBAL_PARTNER_NETWORK_UAT_RELEASE_20261109.md`. The old spec `100-merchant-profile-and-association` is now `100-merchant-profile` (profile scenarios only).


**Source SHA** `5af1d86aabd77dac9f4786135f8b4c763cb6c6b2` (branch `codex/vno-phase-d4-security`, pushed to `origin` 2026-11-09; parent `831e249`).
**Deployment status: DEPLOYED to hosted UAT on 2026-11-09 (the branch was pushed as part of the owner's instruction to deploy to UAT; an earlier push attempt on 2026-11-08 had been denied by the session's permission classifier).** API deployment `ee0a8062-8763-4171-99b6-cf1b8c8744c6` SUCCESS, Web deployment `29fc4986-7585-4675-812e-c0a7f8f5e02b` SUCCESS; the deployed `commitHash` was read back for both = `5af1d86…`. Hosted verification: see §3 and §4.
**Rollback target (previous deployment):** `0317df4d8c6bc7153bd41b0d08caa53621b00b34` (API `f6f1b0eb-395d-4448-b02a-96aff261d5fe`, Web `51b16e68-d6cf-43c2-ba9b-43b817ee56de`) — re-stage both services to that SHA. No migration, no Auth/SMTP/Production change, no change to real or V1 data.

## 1. Issue 1 — Merchant cannot save profile ("Validation failed")
**Root cause (reproduced with real UAT data).** The profile page re-sends *every* field on Save, including legacy values the Merchant never touched — a V1 e-mail with a typo (`nhakhoavinhan.@gmail.com`, Merchant M2500052) and an empty phone (MCH1F1DC shape). The strict update schema rejected those untouched values, and the global validation pipe collapsed the zod issues into one English message, so neither the user nor support could tell which field failed. A pending change proposal is **not** a blocker: no code path consults it on a profile save. What was missing there was protection against *duplicate* proposals.

**Rules (existing business rules, now explicit on the page and enforced by the API)**
| Kind | Fields | Behaviour |
|---|---|---|
| Direct, audited (`merchant.profile_updated` with `changed_fields`) | name, contact/e-mail/phones, owner name/phone/tax code, description, address, categories (≤3), discount/commission rates | saved immediately |
| Admin approval | images (media proposals, `media_approval_requests`) | unchanged workflow |
| Admin only | owner e-mail, code, verification/status | refused (400) |

**Changes**
* `merchants.service.updateForActor`: compares the submission with the stored profile and validates **only changed fields**; a blank optional field is a clear (NULL); a blank rate means "unchanged"; rates are checked against the *stored* type; a submission with no change writes nothing; a per-merchant lock makes repeated or double-click submissions produce one change and one audit row.
* Validation errors: HTTP 400, `message` still `Validation failed` (compatibility) plus `code: VALIDATION_FAILED` and `errors: [{ field, code, message }]` with Vietnamese, actionable text (`common/validation/field-errors.ts`, used by the global pipe, so every endpoint benefits).
* Profile page (`/merchant/dashboard/profile`): field-level errors under each input, a "what saves now / needs approval / Admin only" panel, warnings (never blocks) for legacy values, "Đã lưu N thay đổi: …" / "Không có thay đổi nào để lưu.", pending-proposal banner stating it does not affect the save.
* Images: MIME whitelist, ≤5 MB, magic bytes **and parsed dimensions** (32–12 000 px), per-owner sha256 duplicate refusal (`MEDIA_DUPLICATE`, 409), pending-target conflict, ownership bound to the signed-in profile (`merchants/<id>/` in `merchant-media`); distinct Vietnamese codes (`MEDIA_CORRUPT`, `MEDIA_TOO_SMALL`, `MEDIA_SIGNATURE`, `MEDIA_SIZE_MISMATCH`, …).

## 2. Issue 2 — Partner recognised but not linked to a Merchant
**Root cause.** Nothing is broken in QR resolution. The Partner→Merchant link is `collaborators.merchant_system_id` (one Merchant per Partner). Partners created by the registration flow have **no Merchant by design** (41 of 44 active Partners at the time of the check), so the scan correctly says "recognised, not associated, no discount". The gap was operational: `PATCH /collaborators/:id/admin` could assign a Merchant but **the Admin UI had no way to do it**, and nothing counted valid scans that did not end in a payment.

**Changes**
* Admin › Partners › detail drawer: **Merchant association** panel (search Merchant, Assign, Remove). Audited as `collaborator.merchant_association_changed` `{previous_merchant_id, merchant_id, change}`. Unknown Merchant → structured 404 `MERCHANT_NOT_FOUND`.
* Walk-in counting (no migration): a valid scan (active, verified Partner looked up by an active Merchant) is recorded **once** as an `audit_events` row `merchant.partner_qr_scanned`; dedupe key = scan id sent by the phone, or (Merchant, Partner, minute) when none is sent. Counts are independent of an invoice amount and of whether the Partner is assigned. `GET /qr/scans/summary?days=&merchant_id=` (Merchant: own only; Admin: any; Partner 403; anonymous 401) powers the new walk-in cards on the Merchant dashboard (per day in Vietnam time, split assigned / not assigned).
* Unchanged on purpose: a scan **never** creates an association, transaction or commission; `create_real_transaction` and the preview still refuse an unassigned Partner (403 `PARTNER_NOT_ASSIGNED`); the customer discount is returned only for a Partner assigned to the scanning Merchant and only when the rate is a reviewed fraction (0 < rate ≤ 1).

## 3. Acceptance
| # | Criterion | Evidence (spec `100-…`: local candidate 13/13 before deploy; **hosted UAT 13/13 after deploy**, same steps) |
|---|---|---|
| 1 | Merchant can save valid changes | M1 (page-shaped payload with legacy invalid e-mail + blank phone → 200, only `new_address_line` written, audited once; repeat → `changed_fields: []`), M2 (UI: "Đã lưu 1 thay đổi: Phường / Xã", 1 PATCH), M4 (clear a legacy e-mail → NULL) |
| 2 | Invalid data → specific, actionable errors | M3 (UI: errors under Email / Số điện thoại / Tên doanh nghiệp, **0 requests sent**; API: 400 `VALIDATION_FAILED` with `merchant_email`, `merchant_phone`, `owner_tax_code`, Vietnamese messages, nothing written), M4 (rate `5` → `merchant_discount_value`) |
| 3 | Pending proposals keep approval behaviour | M5 (pending proposal does not block the save; same upload again → 409 `MEDIA_DUPLICATE`; still exactly one pending), M6 (stored rows owned by this Merchant, own folder, correct bucket) |
| 4 | QR resolves active Partner identity | A1 (`COL-2080D9075717B7D8`, synthetic) |
| 5 | Merchant association resolves | A4 (Admin assigns in the UI → DB + audit `assigned`; resolve → `assigned_to_this_merchant`) |
| 6 | Discount only to the authorised Merchant | A4 (`Giảm 5%`, rate `0.0500`; preview gross 1 000 000 → discount 50 000, final 950 000, commission 100 000), A6 (Partner 403, Admin 403, anonymous 401; Partner views carry no discount) |
| 7 | Unassociated Partner cannot transact | A1, A5 (after Remove: preview 403, `POST /transactions/real` 403, ledger unchanged) |
| 8 | Scan-only creates no commission | A2 (8 lookups → 2 counted; ledger total 40 and Partner earnings 152 568.9295 unchanged; Partner still unassigned; invalid scan not counted) |
| 9 | Isolation still enforced | M4 (Partner/Admin on the Merchant route 403; forbidden fields 400), M6 (other merchant/partner target 403), A3 (summary RBAC) |

Test data: the fixture Merchant's temporarily altered columns were restored (verified by read-back); the synthetic Partner was left unassigned; pending proposals cancelled; **Partner3 `COL-986A45914FA0BF7E` was never scanned or modified** (0 scan rows; still unassigned). Audit rows written by the tests are append-only and remain.

## 4. Tests
| Suite | Result |
|---|---|
| backend `tsc --noEmit`, eslint on touched modules | clean (1 pre-existing warning in `partner-qr-payload.ts`) |
| `test:merchant-profile-update` (new) / `test:merchant-qr-flow` / `test:media-lifecycle` | 10 / 18 / 18 controls PASS |
| `test:partner-single-step` 29, `approve-unclaimed` 7, `main-media` 13, `public-catalog` 14, `anonymous-privacy` 3, `d6-contracts` 28, `invitation-guards` 3, `auth-email-hook` 15 | PASS |
| frontend `tsc`, eslint, selftests (merchant-profile, qr, partner-registration, auth-errors) | clean / PASS |
| e2e-uat on the local candidate: 00, 20, 30, 40, 95, 98, 99, **100** | 91 passed in the combined run; one transient transport failure in 98 (`ECONNRESET` from the API to Supabase), then 98 re-run on a fresh API process **15/15**; 100 **13/13** |

**Hosted UAT after deploy (2026-11-09, `railway run --service vno-api`, deployed SHA `5af1d86`):**
| Run | Result |
|---|---|
| `100-merchant-profile-and-association` (M1–M7, A1–A6) | **13 / 13 PASS** (1.6 min) |
| Regression: `00` (7), `20` (9), `30` (4), `40` (22), `95` (9), `98` (15), `99` (16) | **82 / 82 PASS**, 0 failed, 0 skipped (6.2 min) |
| Anonymous smoke | API `/health` 200, Web `/login` 200, `GET /qr/scans/summary` anonymous 401 |
| Partner3 `COL-986A45914FA0BF7E` read-only check after the runs | still `active` + verified, `merchant_system_id` NULL, 0 audit rows mention it |

## 5. Failures not caused by this change
* `test:d13a-contracts` — asserts `qr_payload_format: 'collaborator_code'`, but `collaborators.service.ts` has emitted `'url'` since before this work (HEAD already). Stale test; not modified here.
* `test:email-delivery` — 2 failures in the hook signup/recovery bilingual-message checks (known, pre-existing).
* Spec 98 is sensitive to the in-process registration rate limiter: three runs against one API process in a few minutes produce HTTP 429 in S11. Restarting the API clears it.

## 6. Unresolved / for awareness
1. ~~Hosted UAT verification~~ — done 2026-11-09 (§4): spec 100 13/13 and regression 82/82 on the deployed `5af1d86`.
2. **Partner3 (`COL-986A45914FA0BF7E`) remains unassigned.** That is the correct state: it was never given a Merchant. An Admin can now assign it from Admin › Partners › drawer; which Merchant is the owner's decision and nothing was assigned.
3. Walk-in counts live in `audit_events` (no migration allowed). A dedicated table would be cleaner and cheaper to aggregate (the report reads up to 10 000 rows per query); recommended for the next migration window.
4. The profile lock and scan-dedupe lock are in-process (one API instance), like the existing rate limiters; the database-side backstops are the audit `request_id` check and the existing unique constraints.
5. Still open from earlier releases: real iPhone-in-Zalo QR validation; Partner3 activation-link click; `POST /transactions/:id/confirm|cancel|reverse` return 500 for a malformed id; the dashboard-shell redirect race.

## 7. Deployment record (2026-11-09)
1. `git push origin codex/vno-phase-d4-security` → `831e249..5af1d86`.
2. Railway API mutation (stage + patch) for API `4fc48af8-08a4-4040-8938-a2f75223f8ee` → deployment `ee0a8062-8763-4171-99b6-cf1b8c8744c6` SUCCESS; Web `f23dacf5-e25d-4c9d-a9a1-dd37128d3264` → `29fc4986-7585-4675-812e-c0a7f8f5e02b` SUCCESS. Read-back `commitHash` for both = `5af1d86aabd77dac9f4786135f8b4c763cb6c6b2`.
3. Hosted verification as in §4.
4. Rollback (if ever needed): re-stage both services to `0317df4d8c6bc7153bd41b0d08caa53621b00b34`; no data/migration to undo.
