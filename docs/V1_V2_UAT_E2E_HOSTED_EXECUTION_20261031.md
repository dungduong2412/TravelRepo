# VNO V2 — Hosted UAT E2E execution (2026-10-31)

Target: Railway UAT at `e3b87982be915dad09220b1cdf35e040ce437247`. Suite: `e2e-uat/` (`npm run test:e2e:uat`). Evidence: `e2e-uat/evidence/` (git-ignored, redacted).

## Result matrix

| Run | Mode | PASS | FAIL | SKIP |
|---|---|---|---|---|
| Fresh-claim run (unclaimed pool identities) | first-time claim | J00–J12 all pass (10/10 journey tests) | 0 | 0 |
| Final full run | replay (pool exhausted) | 22 | 1 (R08, real defect) | 2 (J00 no unclaimed identities; J09–J12 identities not paired) |

Fresh-claim run proved on hosted UAT: Admin UI login; governed rate correction of `UAT-M-D5-20261016-A4722D` to 0.0500/0.1000 with stored values and `merchant.updated` audit; Merchant and Partner creation with generated images; invitation → verified identity claim (UI) → pending profile → Admin approval; owner logins; Partner QR; Merchant scan; transaction with exact 4-decimal discount/commission; admin = merchant = partner totals; idempotent replay returning the same transaction.

Not covered or weak: in replay mode J05/J06 only verify that a second claim is refused; J08 checks that an image element renders, not that it is the approved image; R02 partner side saw 0 collaborator ids (no transaction under that Partner yet); invitation expiry is not tested end to end; email-dependent flows are out of scope (SMTP deferred).

## Confirmed application defects

1. **Approving an unclaimed Merchant (and Partner) returns HTTP 500 instead of a clean 4xx** (`POST /merchants/:id/approve`, R08). No data changes; the refusal is correct but the error is not.
2. (From the earlier gate, unchanged) invite link stored in plaintext; revoke does not invalidate the Auth link.

## Test-data state left on UAT (synthetic, intentionally kept)

Several `UAT-E2E-*` Merchant/Partner records, one `UAT-E2E-MERCHANT` pending-unclaimed record (used by R08), uploaded generated images, and simulation transactions with their audit trail. The D5 merchant now holds 0.0500/0.1000. All four base identities and both pool identities are now claimed; **a new unclaimed Merchant+Partner pair is needed for the next first-claim run** (see `e2e-uat/README.md`).
