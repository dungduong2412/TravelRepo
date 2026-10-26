# VNO V2 — Priority Media Visibility Verification

Date: 2026-10-26

Railway UAT application SHA: `1d6198369d9dd4fa9253c2a11a24bf6a991e36d5`

Supabase UAT project: `hsezyogfxgnkpweoqqny`
Result: **Backend/storage lifecycle PASS; Collaborator and Admin rendering PASS; Merchant recovery-session rendering FAIL on the deployed D11 UI; D12 remains undeployed**

No V1 system was accessed. No historical media was imported into shared UAT. No migration, Git push, Railway change or deployment was performed.

## 1. Initial live-UAT diagnosis

Read-only inspection before the controlled test found both expected private buckets, but no UAT media content:

| Scope | Initial result | Diagnosis |
|---|---:|---|
| `merchant-media` | Private; 0 root objects | Bucket existed, but there was no Merchant image to display |
| `partner-media` | Private; 0 root objects | Bucket existed, but there was no Collaborator avatar to display |
| `media_assets` | 0 rows | No database reference existed |
| `media_approval_requests` | 0 rows | No pending or decided proposal existed |
| Merchant effective-media API | HTTP 200, 0 items | Correct empty state |
| Collaborator effective-media API | HTTP 200, 0 items | Correct empty state |

The immediate reason the owner could not see a historical Merchant picture or Collaborator avatar in shared UAT was **absence of objects and metadata**, not a failed hash check or an approval-state/rendering defect. Local rehearsal evidence never established that those 618 historical files existed in shared UAT.

The buckets are private. The hosted bucket MIME allowlist includes JPEG, PNG, WebP and GIF, while the application accepts only JPEG, PNG and WebP and enforces 5 MiB. Bucket-level `file_size_limit` remains unset.

## 2. Controlled synthetic lifecycle results

The test used only the previously authorized synthetic Merchant and Collaborator identities. Passwords, tokens and signed URLs were not logged. Admin decisions were made through the deployed API. The approved synthetic originals are intentionally retained for owner inspection; the rejected replacement remains private as workflow history.

### Merchant main image

| Check | Evidence | Result |
|---|---|---|
| Bucket/object | `merchant-media`; object `d9b5ead6-0ce5-40a9-ae9a-cc5e9aecd325`; object exists | PASS |
| Metadata | `transfer_status=verified`; initially `publication_status=pending`, then `approved`; `is_hero=true`; order 0 | PASS |
| API while pending | Upload HTTP 201; owner `/media/me` included it; effective/public API returned 0 | PASS |
| Signed URL while pending | Owner HTTP 200; Collaborator HTTP 403; anonymous public-bucket URL HTTP 400 | PASS |
| Admin approval | Request `f704e9e0-0172-4cd3-be89-a2a13a26effe`; approval HTTP 201 | PASS |
| Effective API after approval | HTTP 200; exactly the approved main asset returned | PASS |
| Signed bytes | HTTP 200; `image/png`; 68 bytes; SHA-256 `fd3c01165183c6373353f1ab82ab875999f95dc6aba0f08623372fbffdf222b9`; exact metadata/payload match | PASS |
| Admin UI rendering | `<img>` completed; natural size 1×1; rendered 555×220 | PASS |
| Merchant profile UI | Authenticated recovery/magic-link session reached the profile, but deployed page reported missing login information and rendered no media | **FAIL** |
| Exact UI failure point | Deployed Merchant profile reads `localStorage.merchant` populated only by password-login response; recovery/magic-link session does not populate it. Local D12 replaces this with `/user-profiles/me`, but D12 is not deployed | **FAIL / code absent** |

### Collaborator avatar

| Check | Evidence | Result |
|---|---|---|
| Bucket/object | `partner-media`; object `2d6bca4b-3f39-41b2-a0d7-9688171c8dbb`; object exists | PASS |
| Metadata | `transfer_status=verified`; initially `publication_status=pending`, then `approved`; `is_hero=true`; order 0 | PASS |
| API while pending | Upload HTTP 201; owner `/media/me` included it; effective/public API returned 0 | PASS |
| Signed URL while pending | Owner HTTP 200; Merchant HTTP 403; anonymous public-bucket URL HTTP 400 | PASS |
| Admin approval | Request `4970cf5b-03df-476f-8ba2-53551fce26f8`; approval HTTP 201 | PASS |
| Effective API after approval | HTTP 200; exactly the approved avatar returned | PASS |
| Signed bytes | HTTP 200; `image/png`; 69 bytes; SHA-256 `e5059f038d9fca969225dc6c67602478a34e2e518b0188edf11ef7ac4c88674b`; exact metadata/payload match | PASS |
| Collaborator profile UI | Approved card present; `<img>` completed; natural size 1×1; rendered 222×130 | PASS |
| Admin UI rendering | Approved queue showed owner, filename, hash prefix and decision; `<img>` completed; rendered 555×220 | PASS |

### Merchant replacement/rejection invariant

| Check | Evidence | Result |
|---|---|---|
| Proposed replacement | `merchant-media` object `65c5903a-6502-4df1-bc92-ac4ff33a4e8d`; `verified/pending` before decision | PASS |
| Pending visibility | Owner list showed old approved image and new pending proposal; effective API continued to return only the old image | PASS |
| Cross-owner/public access | The established cross-owner and anonymous denials remained in force | PASS |
| Rejection | Request `7ab079d6-a780-40c3-852d-1f06c709541b`; rejection HTTP 201 with UAT-only reason | PASS |
| Post-rejection publication | Replacement became `rejected`; original `d9b5ead6-...` remained the sole effective main image | PASS |
| Storage state | Rejected object remains in the private bucket for approval history/retention; it is not returned by the effective/public API | PASS |

No pending request remained after the test. Final shared-UAT synthetic media state is two approved assets and one rejected private replacement, backed by three matching Storage objects and three decided approval requests.

## 3. Failure classification

| Possible cause | Finding |
|---|---|
| Missing Storage objects | **Confirmed initial cause in shared UAT**: both buckets had zero objects before this test |
| Missing database references | **Confirmed initial cause**: `media_assets` and approval requests were empty |
| Pending approval | Correctly private; pending assets were absent from effective APIs and unrelated users received 403 |
| Signed URL failure | Not reproduced; owner and effective signed URLs returned exact bytes and MIME types |
| API publication failure | Not reproduced; approved assets appeared in effective endpoints, rejected replacement did not |
| Collaborator UI rendering failure | Not reproduced after approved synthetic avatar existed |
| Admin preview failure | Not reproduced; both approved images decoded and rendered |
| Merchant UI rendering failure | Reproduced for a valid recovery/magic-link session because deployed profile initialization depends on password-login-only local storage |

The test images are deliberately minimal 1×1 PNG fixtures, so their visible panels appear blank/solid even though browser decoding succeeded. Browser `complete`, natural dimensions and rendered dimensions were checked directly; byte and SHA-256 equality were also verified independently.

## 4. Isolated migrated-V1 media acceptance

The preserved D11 rehearsal volume was read only. The import was not repeated.

| Control | Result |
|---|---:|
| Media records/files | 618 / 618 |
| Storage bytes | 416,329,553 |
| SHA-256 checks | 618/618 PASS |
| Merchant/Collaborator files | 542 / 76 |
| Publication state | 618 `legacy_effective` + `verified` |
| Application Merchant gallery | HTTP 200 with signed legacy-effective asset |
| Application Collaborator avatar | HTTP 200 with signed legacy-effective asset |
| Sample application-served asset | 543,087 bytes; exact SHA-256 match |
| Tenant rows | 148 Merchants; 270 Collaborators; 102 transactions; 272 category links |
| Financial totals | `377705162.0000` / `24077880.8000` / `27466958.1000` |
| Historical orphan | 1; no invented Merchant assignment |

This proves the isolated application can read actual migrated V1 media and that the preserved files are intact. It does not imply those files exist in shared UAT.

## 5. D12 work absent from Railway

Railway API deployment `66ef249a-8164-4cf1-beb7-f24948663e18` and Web deployment `87b623f9-def2-4706-97e9-f9113275d702` remain at D11 SHA `1d6198369d9dd4fa9253c2a11a24bf6a991e36d5`. There is no staged Railway patch.

The following local D12 changes are therefore absent:

- Merchant profile resolution through `/user-profiles/me`, eliminating dependence on `localStorage.merchant` after recovery/magic-link authentication.
- Effective main-image and ordered-gallery presentation separated from pending/rejected proposal history.
- Responsive shared role shell and Merchant mobile routes for home, orders, QR scan, payment reporting and account settings.
- Collaborator responsive home/settings refinements and code-only QR behavior.
- Merchant-only `POST /qr/resolve` and the privacy/idempotency controls around referral identity lookup.
- Responsive financial-history cards and mobile overflow/accessibility improvements.
- PostgreSQL GUID-compatible request validation for preserved legacy identifiers.

The core D10B media upload, private Storage, signed URL, Admin approval and atomic publication logic is already deployed and passed this live test. D12 improves profile/session robustness and presentation; it does not require a new database migration.

## 6. Recommendation

**GO** to prepare the existing local D12 work for a separate reviewed release candidate. The immediate shared-UAT “no pictures” diagnosis is resolved with evidence: there were no objects or media rows before the test, and approved synthetic media now works through Storage, database, API, signed URL, Collaborator UI and Admin UI.

**NO-GO** to claim complete Merchant media acceptance on the current Railway build. The recovery/magic-link Merchant profile path still fails on the deployed D11 frontend and the D12 fix is not deployed. Also keep production import/cutover blocked; no historical media should be copied into shared UAT merely to demonstrate UI rendering.

Next action: review and commit the bounded D12 application diff, then request a separate push/staging/deployment gate. After deployment, rerun the Merchant recovery-session profile test and verify the approved main image plus ordered gallery in the actual Railway UI.
