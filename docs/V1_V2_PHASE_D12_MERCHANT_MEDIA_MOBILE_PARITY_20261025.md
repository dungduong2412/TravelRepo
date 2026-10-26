# VNO V2 — Phase D12 Merchant Media and Mobile Functional Parity

Date: 2026-10-25

Branch: `codex/vno-phase-d4-security`

Local base SHA: `1d6198369d9dd4fa9253c2a11a24bf6a991e36d5`
Result: **GO for local release-candidate review; NO-GO for production import/cutover**

No V1 system was accessed. No shared UAT row, Storage object, Auth identity, schema, migration history, Git remote or Railway configuration was changed.

## 1. Environment and media diagnosis

Railway read-only inspection confirmed that `vno-api` deployment `66ef249a-8164-4cf1-beb7-f24948663e18` and `vno-web` deployment `87b623f9-def2-4706-97e9-f9113275d702` are healthy and both run SHA `1d6198369d9dd4fa9253c2a11a24bf6a991e36d5`.

The UAT Supabase project hostname was independently confirmed as `hsezyogfxgnkpweoqqny.supabase.co`. Aggregate-only, read-only checks found:

| Item | UAT result | Diagnosis |
|---|---:|---|
| `merchant-media` bucket | private; 0 objects | Bucket exists; no historical/shared-UAT media was imported |
| `partner-media` bucket | private; 0 objects | Bucket exists; no historical/shared-UAT media was imported |
| `media_assets` | 0 rows | Empty state, not a signing/render failure |
| `media_approval_requests` | 0 rows | No pending/shared-UAT proposal |

The API continues to enforce JPEG/PNG/WebP and 5 MiB even though the hosted bucket configuration does not yet declare a bucket-level size limit and still permits GIF. This is a configuration-hardening item, not a D12 application failure.

The completed UI now separates effective media (`approved`, `legacy_effective`, `preexisting_effective`) from pending/rejected history, renders one main image plus an ordered gallery, and never selects pending/rejected media as effective. Existing D10B atomic approval, stale-version, duplicate-decision, ownership, signed-URL and compensating-cleanup controls remain in use.

## 2. Merchant mobile parity matrix

| V1 capability | V2 D12 implementation | Verification | Status |
|---|---|---|---|
| Trang chủ | Mobile overview with exact scoped transaction, document, discount and commission totals | Synthetic merchant dashboard at 390 px | PASS |
| Đơn hàng | Scoped `/transactions/me/report`, original document number/date/status, merchant/collaborator labels, filters, sorting, pagination and full-filter totals | D10 14/14; mobile card view at 320 px | PASS |
| QR Scan | Authenticated merchant-only `POST /qr/resolve`; accepts raw collaborator code or `/c/{code}` URL; returns sanitized identity/association | D12 mobile 14/14 | PASS for identity verification |
| Duplicate scan handling | Resolver is read-only and idempotent; repeated scans leave transaction count unchanged | 102 before / 102 after | PASS |
| Thanh toán | Read-only payment/commission report; source status, V2 lifecycle and V2 payment state remain distinct | D10 exact reconciliation | PASS for reporting |
| Settlement/payment execution | No mutation was added because V1 state transitions and settlement authority are not proven | No invented transition | BLOCKED by business semantics |
| Báo cáo | Date/status/search filters, pagination, precise totals over more than 1,000 synthetic rows | 1,008-row D10 scale test | PASS |
| Merchant profile | Owner/business/contact/categories/geography/description/commercial read-only terms | D10B owner contract and category tests | PASS |
| Approved media/gallery | Main image, ordered thumbnails, `legacy_effective` support, proposal status/history | Migrated-data application test and D10B media suite | PASS |
| Governed update behavior | Owner-scoped profile edits; media add/replace/remove/reorder require Admin approval | D6/D10B authorization suites | PASS |
| Account settings | Supabase Auth password update; role/entity assignment is not exposed | Route and build verification | PASS |

## 3. Collaborator mobile parity matrix

| V1 capability | V2 D12 implementation | Verification | Status |
|---|---|---|---|
| Personal referral QR | Generated on demand from `collaborators_code` only; downloadable PNG | Code-only payload assertion | PASS |
| QR privacy | No email, phone or bank data in QR payload/resolver response | D12 mobile privacy assertions | PASS |
| Commission report | Scoped transaction report with date/status filters, precise discount/commission amounts and status grouping | D10 and 768 px report | PASS |
| Transaction history | Collaborator sees only linked records, including the preserved linked orphan rule | D6/D10/D12 migrated checks | PASS |
| Profile and avatar | Owner profile plus effective avatar; pending/rejected proposals shown separately | D10B media 22/22 | PASS |
| Avatar approval | Upload remains private until Admin approval; rejection preserves effective avatar | D10B media suite | PASS |
| Banking information | Available only to the owning collaborator and Platform Admin; excluded from public referral and merchant scan contracts | D12 mobile + migrated-data assertions | PASS |
| Email/account settings | Profile email is read-only; identity changes stay under Supabase Auth verification. Password update uses current Auth session | UI/type/build checks | PASS |
| Merchant/referral association | Scoped members endpoints and sanitized merchant scan association (`this merchant`, `other`, `unassigned`) | D6 and D12 tests | PASS |
| Historical referral identity | V1 `RestaurantMiddleman.Code` is preserved directly as `collaborators_code` | Snapshot field matrix and 270-row source inspection | PASS |

## 4. QR evidence and bounded interpretation

The sealed snapshot contains 270 `RestaurantMiddleman` rows. Every source `Code` is eight characters; no separate QR-payload column exists. The accepted field matrix maps that source field directly to `collaborators.collaborators_code`. The previous V2 code also documented code-only QR generation, while the old implementation inconsistently stored a QR image data URL as the resolver token and embedded name/phone/email JSON in the image.

D12 corrects that inconsistency: QR data contains only the stable collaborator code. The resolver also accepts a URL wrapper ending in `/c/{code}` for compatibility. The exact historical V1 wrapper/URI representation remains unverified because no V1 application source or QR screenshot payload was available, so no payment or settlement rule was inferred from QR use.

## 5. Schema/API changes and compatibility

No database migration is required for the implemented D12 scope.

Application/API additions:

- `POST /qr/resolve` — authenticated active Merchant only; sanitized, read-only collaborator lookup.
- `/collaborators/me/qr-code` — on-demand code-only QR with explicit payload format.
- Shared responsive role shell and Merchant order, QR, payment, settings routes.
- Collaborator settings route and guarded identity-email behavior.
- Responsive financial cards below the tablet table breakpoint.
- Effective main/gallery presentation and separate media proposal history.

Zod 4 regression closure:

- Zod 4 `z.guid()` rejected valid PostgreSQL/V1 GUID strings that do not carry RFC version/variant bits.
- D12 adds a strict PostgreSQL UUID syntax schema and uses it for legacy merchant, collaborator, category and filtering identities.
- This restores lossless historical GUID compatibility without accepting non-UUID text.

## 6. Isolated migrated-data application acceptance

The preserved D11 volume was reused; no full import was repeated and no imported customer identity was connected to authentication.

| Control | Result |
|---|---:|
| Migrated-data application assertions | 11/11 PASS |
| Tenant merchants/collaborators/transactions/category links | 148 / 270 / 102 / 272 |
| Scoped relational rows | 11,726 |
| Merchant/collaborator media | 542 / 76 |
| Media integrity | 618/618 SHA-256 PASS; 416,329,553 bytes |
| Effective legacy media | 618 `legacy_effective` + `verified` |
| Document total | `377705162.0000` |
| Discount total | `24077880.8000` |
| Commission total | `27466958.1000` |
| Source statuses | `0=2`, `1=37`, `2=2`, `3=61` |
| Historical orphan | 1, still has no invented Merchant relationship |

One original merchant asset was also retrieved through the application-generated signed URL; its 543,087 bytes and SHA-256 matched the stored metadata. Original merchant gallery and collaborator avatar endpoints both returned `legacy_effective` assets. Admin could inspect historical banking metadata, while the public referral contract did not expose it.

## 7. Regression, build and security evidence

| Gate | Result |
|---|---:|
| Authorization / tenant-owner boundaries | 35/35 PASS |
| D6 business workflows | 22/22 PASS |
| D10 financial/Merchant Details | 14/14 PASS |
| D10B category/history | 11/11 PASS |
| D10B media approval | 22/22 PASS |
| D6 backend contracts | 28/28 PASS |
| Existing D11 total | **132/132 PASS** |
| Media failure/cleanup | 8/8 PASS |
| New D12 QR/mobile/privacy | 14/14 PASS |
| New migrated-data application checks | 11/11 PASS |
| Password/magic-link/recovery media sessions | 30/30 PASS |
| Backend typecheck/lint/build | PASS |
| Frontend typecheck/lint/build | PASS; 36/36 routes generated; warnings only from known raw-image usage |
| Production dependency audits | backend 0; frontend 0 vulnerabilities |
| API/Web Docker builds | PASS; 0 runtime vulnerabilities during API image install |
| Container smoke | API `/health` 200; Web `/login` 200 |
| Runtime identity/command | both non-root `node`; `node dist/main.js` / `node server.js` |

Responsive checks at 320, 375, 390, 430, 768 and 1440 px found `scrollWidth === innerWidth`, no positive `tabindex`, and no visible interactive target below 40 px on the inspected profile surface. Keyboard Tab moved in source order from collaborator name to phone.

Final release-candidate verification on 2026-10-26 exercised Merchant and Collaborator identities through password, magic-link and recovery sessions. For all six role/session combinations, `/user-profiles/me` resolved the expected business assignment, the effective-media endpoint returned only the approved asset, the signed object returned an image response, and refresh-token rotation retained profile and media access. The Merchant password-session browser check also rendered the approved main image before and after a full page refresh. No shared-UAT identity, row or Storage object was used or modified by this test.

## 8. Screenshots

All screenshots use synthetic local personas; no customer records or historical media are shown.

- `docs/d12-screenshots/merchant-orders-320.jpg`
- `docs/d12-screenshots/collaborator-home-375.jpg`
- `docs/d12-screenshots/collaborator-qr-375.jpg`
- `docs/d12-screenshots/merchant-home-390.jpg`
- `docs/d12-screenshots/merchant-qr-430.jpg`
- `docs/d12-screenshots/collaborator-report-tablet-768.jpg`
- `docs/d12-screenshots/collaborator-profile-desktop-1440.jpg`

## 9. Changed-file inventory

Source files:

- `backend/src/common/validation/postgres-uuid.ts`
- `backend/src/modules/categories/categories.dto.ts`
- `backend/src/modules/collaborators/collaborators.dto.ts`
- `backend/src/modules/collaborators/collaborators.service.ts`
- `backend/src/modules/media/media.dto.ts`
- `backend/src/modules/merchants/merchants.dto.ts`
- `backend/src/modules/qr/merchant-qr.controller.ts`
- `backend/src/modules/qr/qr.dto.ts`
- `backend/src/modules/qr/qr.module.ts`
- `backend/src/modules/transactions/transactions.dto.ts`
- `backend/src/modules/user-profiles/user-profiles.dto.ts`
- `frontend/app/layout.tsx`
- `frontend/app/merchant/dashboard/{layout,page}.tsx`
- `frontend/app/merchant/dashboard/profile/page.tsx`
- `frontend/app/merchant/dashboard/{orders,payments,qr-scan,settings}/page.tsx`
- `frontend/app/collaborator/dashboard/{layout,page}.tsx`
- `frontend/app/collaborator/dashboard/profile/page.tsx`
- `frontend/app/collaborator/dashboard/qr-code/page.tsx`
- `frontend/app/collaborator/dashboard/settings/page.tsx`
- `frontend/components/AccountSettings.tsx`
- `frontend/components/FinancialHistory.tsx`
- `frontend/components/MediaManager.tsx`
- `frontend/components/RoleDashboardShell.tsx`
- `migration/v2/test-d12-mobile.mjs`
- `migration/v2/test-d12-migrated-application.mjs`
- `migration/v2/test-d12-auth-media-sessions.mjs`
- this report and seven synthetic screenshots.

The repository tracks backend `dist/`; the local build refreshed the corresponding generated DTO/service/module artifacts. These must be reviewed as generated output in the later release-candidate gate. Pre-existing unrelated untracked reports, `docs/screenshots/`, `migration/v2/evidence/` and `frontend/AGENTS.md` were not modified or included in D12 scope.

## 10. Remaining blockers and recommendation

1. **Payment execution remains blocked.** V1 scan/payment state transitions, durable duplicate key and settlement authority are not sufficiently evidenced. D12 implements only permission-checked, idempotent identity verification and read-only reporting.
2. **Exact historical QR wrapper remains uncertain.** Code identity is proven; any V1 URL prefix is not. Raw code and `/c/{code}` are accepted.
3. **Shared UAT has no media test data.** A later approved deployment should run the synthetic upload → approval → rendering scenario in shared UAT; historical media must not be imported merely for UI testing.
4. **Bucket-level hardening remains pending.** Align allowed MIME types with the API and set a 5 MiB bucket limit through a separately approved UAT configuration change.
5. **Imported Auth onboarding remains unproven.** The 417 mappings remain password-reset onboarding records only; no imported customer account was activated.
6. **Owner screenshot pixel acceptance remains manual.** The functional routes and Vietnamese labels are implemented, but exact visual comparison requires the original owner screenshots to be available in the release-review context.

**Recommendation: GO for a separate D12 local release-candidate review, then controlled Git push/Railway UAT staging only after approval. NO-GO for production import, financial execution, cutover or customer activation.**
