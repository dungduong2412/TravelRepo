# VNO V2 — Merchant QR scan, customer-discount inquiry and payment (UAT, 2026-11-08)

**Source SHA** `0317df4d8c6bc7153bd41b0d08caa53621b00b34` (branch `codex/vno-phase-d4-security`).
**Deployed to UAT:** API deployment `f6f1b0eb-395d-4448-b02a-96aff261d5fe` (2026-11-08T09:58:41Z) and Web deployment `51b16e68-d6cf-43c2-ba9b-43b817ee56de` (10:00:26Z), both SUCCESS and read back from Railway at that SHA.
**Rollback:** re-stage both services to `9c7c09efbb823ea62346ad368eba1150eafd38d7` (`environmentStageChanges` + `environmentPatchCommitStaged`). No migration, no data change, no Auth/SMTP/Production change.

**Status: NOT declared PASS.** Everything that can be driven from this machine passes on the deployed hosted UAT (§5). The one thing that cannot be driven from here — **a physical iPhone, Safari opened through Zalo** — is not yet validated (§6). Per the brief, PASS is withheld until that is.

## 1. What was wrong (reproduced on hosted UAT before any change)
| Scenario (hosted UAT, previous release) | Result |
|---|---|
| Clean QR on a camera feed / clean screenshot upload | works (≈1.7 s) |
| **QR on another phone's screen** (blur + noise + tilt) on the live camera | **never identified in 20 s; the main thread was blocked for 20 002 ms of those 20 s** (66 long tasks) — on a phone the page is frozen |
| **Noisy 12-megapixel phone photo** uploaded | main thread blocked **7.5 s at a time, ~60 s in total**, then "Không tìm thấy mã QR" (a 12 MP photo costs the old engine ~35 s on a desktop CPU) |
| **Zalo-style in-app browser**, camera API missing / refused | dead end: "grant permission in browser settings" (impossible inside Zalo), no photo-capture fallback, no hint to open Safari |
| `/qr/resolve` with a lower-case code, a code pasted from a chat (zero-width character), a URL without scheme | 404 "Invalid or unverified collaborator code" — **in English, for every kind of failure** (unsupported QR, unknown code, inactive Partner all looked identical) |

**Root causes:** (1) the decoder (jsQR alone) cannot read screen-photo frames and has pathological runtime on failure; the photo path decoded at full resolution. (2) No fallback for browsers that block the live camera. (3) A brittle, case-sensitive resolver with one opaque error. Bench on 23 degraded scenes: jsQR 14/17 camera + 4/6 photo; ZXing 23/23, 3–6 ms per frame.

## 2. What changed
**Scanner** (`frontend/components/QrScanner.tsx`, `lib/qr/*`) — replaces `QrCameraScanner`.
* ZXing (WebAssembly, `zxing-wasm@2.2.4`, MIT, pinned) is the decoder; the `.wasm` ships as a hashed **same-origin static asset** (the library's default CDN is not used); jsQR remains only as a bounded fallback if WebAssembly cannot load.
* Camera frames are reduced to ≤960 px, photos to 1600 → 1000 → 2400 px before decoding; the page never decodes a 12 MP image.
* Camera lifecycle: relaxed-constraint retries (Overconstrained on older iPhones/WebViews), `playsinline`/muted/metadata-loaded start for iOS, stream stopped on Close, on page hide/`pagehide`, and after a scan; restart is explicit; one detection is reported once (3-s duplicate guard + parent in-flight guard).
* **In-app browsers** (Zalo, Facebook, Instagram, LINE, WeChat, TikTok, generic WebView) are detected; the screen says so, offers **"Chụp ảnh mã QR"** (`<input capture>` → the phone's own camera app, which works inside Zalo), **"Tải ảnh QR lên"**, a copy-link button and "open in Safari/Chrome" guidance. Camera errors are specific (denied / busy / none / insecure) and never a dead end.
* A collapsible "Thông tin kỹ thuật" panel shows what this phone reports (OS, in-app app, HTTPS, camera API, engine, last camera error, **session code**).
* **Closed-vocabulary diagnostics** (`POST /qr/diagnostics`, no identity, no payload, no image, schema-enforced, rate limited) land in the API log as `QrScan` lines, so a phone nobody can hold can be read remotely.

**API** (`modules/qr`, `transactions`, `media`):
* `POST /qr/resolve` (Merchant only, read-only): strict payload parser (URL `<any host>/c/<code>`, scheme-less URL, bare code; invisible characters, NBSP and case tolerated; everything else is "unsupported" and never looked up), structured Vietnamese errors (`QR_UNSUPPORTED` 400, `PARTNER_NOT_FOUND` 404, `PARTNER_NOT_ACTIVE` 409, `MERCHANT_NOT_ACTIVE` 403, `QR_RATE_LIMITED` 429), per-Merchant rate limit (90/min against code enumeration). Answers: `partner{id,code,name,avatar_url,verified,status}`, `association`, and `discount{available,kind,rate,label,reason}` from the Merchant's own policy — **no commission, phone, e-mail or bank data**. The established fields (`collaborator_*`, `association`, `financial_action_created`) are unchanged.
* **Discount rule:** shown only when the Partner is assigned to this Merchant and the policy is a reviewed fraction (0 < rate ≤ 1) — the same rule as the public catalog (`publicOffer`) and the transaction function. Legacy "points" values (`8`, `10`) and non-percentage policies yield **"Không có ưu đãi áp dụng"**. The label/rate cannot disagree across catalog, inquiry and payment.
* `POST /transactions/real/preview` (new, Merchant only, writes nothing): the same validations and arithmetic as `create_real_transaction`: `discount = round4(gross × discount rate)`, `final = gross − discount`, `commission = round4(gross × commission rate)` **on the original amount** (V1-verified 102/102 rows; documented in the D13 readiness record) and independent of the discount rate.
* `POST /transactions/real` + `…/:id/confirm` are unchanged (governed RPCs, idempotency keys, unique constraints, audit). `GET /transactions/:id/receipt` (new; Merchant own / Admin) returns amounts incl. `final_payable`, status and the ledger events.
* **Partner redaction:** a Partner's `GET /transactions/me`, `/transactions/me/report` (rows, **summary**, and the discount **sort key**) no longer carry `document_discount_percent` / `document_discount_amount`. Partner Portal: the "Tổng giảm giá" metric and every discount column/sort/detail are gone; earnings are unchanged.
* `GET /collaborators/me/qr-code` draws the on-screen image with a 4-module quiet zone and error-correction M (bigger modules, no blending into dark phone UIs) and returns `avatar_url`. **The payload is unchanged and no stored/printed code was regenerated**; the old-design image (margin 1, EC H) is covered by a test and still resolves.

**Merchant journey** (`/merchant/dashboard/new-transaction`): scan / upload / photo / typed code → Partner name, avatar (or initials), code, "Đã xác minh · Đang hoạt động" and **"Ưu đãi dành cho khách: Giảm x%" or "Không có ưu đãi áp dụng"** (nothing created; a visible note says so) → **Đóng** or **Tiếp tục thanh toán** (disabled for a Partner not assigned to this Merchant) → Partner retained, original amount typed → server-computed breakdown (original, discount, **customer pays**, Partner commission) → **one** "Xác nhận thanh toán" (create + confirm with stable idempotency keys that survive a reload for the same Partner+amount; a failed confirm after a successful create offers "Thử xác nhận lại"/"Huỷ", never a second transaction) → receipt. Partner Portal shows name, avatar, own QR, code; the QR card says discounts are not shown there.

## 3. Rules checked against the brief
| Brief | Where / how proven |
|---|---|
| Resolve against the existing Partner identity; validate status and QR validity | resolver; Q1, Q2, Q12 |
| Show name, avatar, code, verification status; discount or "Không có ưu đãi áp dụng" | UI; Q5, Q9; unit R3/R4 |
| Scan creates no transaction/commission/payment/ledger entry; no invoice amount needed | Q3, Q9 (counts, ledger events, transaction audit rows unchanged) |
| Don't expose commission configuration / sensitive Partner data on scan | unit R5, Q1 (response scanned for commission/phone/e-mail/bank) |
| Payment retains identity, applies the discount, shows original/discount/final, independent commission on the right base | Q10 against independent BigInt arithmetic |
| Exactly once, no duplicate commission accrual, audit, receipt | Q10 (double tap), Q11 (idempotent replays, 409 on different input, confirm replay), ledger events + audit rows |
| Partner cannot see Merchant-only discount data | Q4, Q15 |
| Admin management/audit preserved | Admin sees full summary; audit rows `transaction.real_recorded` / `transaction.real_confirmed`; Admin reverse used for clean-up |
| Existing QR compatibility; do not regenerate | payload unchanged; old-design QR image, bare codes, other-host URLs resolve (Q2, Q7, X10) |

## 4. Tests
* Backend `test:merchant-qr-flow` — **14 controls** (parser matrix, resolver rules, read-only, rate limit, Merchant-only, preview arithmetic vs an independent reference incl. half-up edges, Partner redaction); `test:partner-single-step` 29, `test:approve-unclaimed` 7, `test:auth-email-hook` 15, `test:public-catalog` 14, `test:invitation-guards` 3 — all pass.
* Frontend `lib/qr/qr.selftest.ts` — parser/in-app detection on real UA strings/money formatting + **46 degraded frames** (23 scenes × 2 QR designs: distance, blur, noise, tilt, perspective, glare, low contrast, 12 MP photos): all decoded, slowest 12 ms. `tsc`, eslint (0 errors) and a clean build pass.
* E2E `99-merchant-qr-scan.spec.ts` (16 steps, §5); `30-operational` updated to the new journey (its P03 now also reverses its own transaction); `40-experience` X10/X11 corrected (§7).

## 5. Hosted UAT evidence (deployed `0317df4`, run `20261108100231`, `e2e-uat/evidence/qr-scan-20261108100231.json`)
Spec 99 **16/16 PASS** on hosted UAT. Fixture: paired Merchant + Partner `COL-D600ABC8D5C2C528`, Merchant rates 0.0500 / 0.1000.
| Acceptance | Result |
|---|---|
| 1 Camera scan identifies a valid Partner | fake camera showing the Partner's real QR → identified in **1 358 ms**, 1 lookup, camera released |
| 1b Camera on a phone-screen feed (blur+noise+tilt) | identified in **1 343 ms, 0 long tasks** (before: not identified in 20 s, 20 002 ms blocked) |
| 2 Uploaded image identifies the same Partner | clean screenshot 879 ms; **noisy 12 MP photo 849 ms, longest block 64 ms** (before ≈60 s); old-design QR 847 ms |
| 3 Name and avatar | name/code/"Đã xác minh" + avatar image loaded (signed URL → 256×256 PNG) |
| 4 Discount for the Merchant only | "Giảm 5%" for the Merchant; Partner `resolve`/`preview`/`receipt` → **403**; anonymous 401 |
| 5 Inquiry creates no financial record | five lookups (incl. failures) and a manual inquiry: transactions 36→36, ledger events 63→63, transaction audit rows 63→63 |
| 6 Payment applies the correct discount | gross 1 222 958.2958 → discount **61 147.9148** (5 %), final **1 161 810.3810** |
| 7 Commission independent and correct | commission **122 295.8296** = round4(gross × 0.10) on the original amount; a 5 % vs 20 % discount policy yields the same commission (unit) |
| 8 Exactly once | double tap → 1 transaction `VNO261108-26AF9D107A` (`b016d1f7-22a0-49be-8220-ab46083dd353`), events `real_transaction_recorded@10:03:50.79Z` → `real_transaction_confirmed@10:03:51.36Z`, audit `transaction.real_recorded` + `transaction.real_confirmed`, 1 create + 1 confirm request; replayed key → same transaction; different input with the same key → 409; confirm replay idempotent; Partner confirmed commission moved by **exactly** 122 295.8296; Merchant totals = Admin totals |
| 9 Invalid QR is actionable | non-VNO QR → "Mã QR không hợp lệ" (no lookup sent); unknown code → "Không tìm thấy Đối tác"; inactive Partner → "Đối tác chưa hoạt động … liên hệ Admin VNO"; scanner restarts; nothing created |
| 10 Partner cannot reach Merchant-only discount data | Partner transaction list/report contain no "discount" at all (even when sorting by it); dashboard and reports show none; Merchant/Admin summaries keep it |
| Zalo in-app (iPhone UA), camera API missing **and** refused | in-app notice, "Chụp ảnh mã QR" + upload resolve the Partner; diagnostics (`page_open`, `camera_support inapp=zalo os=ios`, `fallback_shown`, `upload_decoded engine=zxing`, `resolve_ok`) are visible in the Railway API log |
| Real **WebKit** engine, iPhone viewport, Zalo UA | noisy 12 MP photo 983 ms, clean screenshot 910 ms, longest block 0 ms, manual entry ok |
| Lifecycle | one lookup per detection; stream released after a scan, on Close and when the page is hidden; restart works |
Test data: the two confirmed test transactions were **reversed by Admin** (governed, audited); the fixture Partner's confirmed commission is back to 152 568.9295 (its value before the run).

**Regression (hosted UAT, deployed build):** 00, 20, 30, 40, 95 — pass (spec 40 **22/22** after §7).

## 6. NOT validated here: a physical iPhone, Safari opened through Zalo
Chromium (fake camera), a real WebKit engine and the Zalo user agent were driven; an actual iPhone/Zalo WebView was not. Open questions only a phone answers: whether Zalo's WebView exposes `getUserMedia` at all, whether it asks for permission, and how an iPhone camera photo (HEIC→JPEG by Safari's file picker) decodes. The page is built so any answer gives a working path.
**Owner test (≈3 minutes):** 1) In Zalo on the iPhone open `https://vno-web-uat.up.railway.app/merchant/dashboard/new-transaction` (Merchant login). 2) Expect the orange "Bạn đang mở trang trong Zalo" notice. 3) Tap **Chụp ảnh mã QR** and photograph another phone showing the Partner QR (Partner Portal → Phóng to) → expect the Partner card with "Giảm 5%". 4) Tap **Thử mở camera trực tiếp** and note what happens. 5) Repeat in Safari with **Mở camera quét QR**. 6) Open "Thông tin kỹ thuật" and send the **Mã phiên** (or the time) — the server log (`QrScan` lines: OS, in-app app, camera API present, camera error name, engine, decode time, outcome) then shows exactly what the phone did. Only after this is the hosted mobile experience validated.

## 7. Test fixes made while verifying (stale expectations, not product changes)
* **X10** expected the QR to decode to the bare code; since the QR became a navigable URL the canonical payload is `<site>/c/<code>`. It now asserts the decoded value equals the API's `qr_payload`, and that both the URL and the bare code resolve to the same Partner.
* **X11** read a `collaboratorId` field and expected 403 from the public route; the customer landing page (D14) returns 404 "Partner not found" for a shared V1 code and `partner_code`/`partner_name` for a remapped one. It asserts that contract.
* **P01 (spec 30)** looked for an old audit row inside "the latest 500 events" (the API caps that at 250 and the test environment outgrew it); it now queries the specific event.

## 8. Unresolved / for awareness
1. **Physical iPhone + Zalo validation** (§6) — open; blocks PASS.
2. The public customer page `/c/<code>` (and the catalog) show the Merchant's offer to anyone by design (customer-facing). "Merchant-only" in this work means the authenticated scan/inquiry/payment APIs and every Partner view; if the public offer is to be hidden too, that is a product decision.
3. The payment step and receipt show the Partner commission to the Merchant (the Merchant owns that rate and sees it in its reports); the scan/inquiry result does not.
4. Pre-existing, not changed: `POST /transactions/:id/confirm|cancel|reverse` return 500 instead of 400 for a malformed id (the new `receipt` route validates it); the Merchant/Partner dashboard shell redirects to `/login` when its first data request is cancelled mid-load (surfaced by a test that navigated away early).
5. Rate limiters (resolve 90/min per Merchant, diagnostics 120/min per client) are in process memory (one API instance) and reset on deploy.
6. Camera frames are decoded on the main thread (3–15 ms each, 0 long tasks measured); a Web Worker would add headroom on very old phones.
