# VNO V2 — D10 + D10B Combined Release Candidate

Date: 2026-10-21
Branch: `codex/vno-phase-d4-security`

## Scope

This local release candidate combines the committed D10 Financial and Merchant
parity baseline (`e4876cb7b0402ab7adb16a35aca6dc8492ca4f82`) with the D10B
Merchant Details, governed media approval, and three-category application
changes. No Supabase migration, Git push, Railway staging, or deployment was
performed during release-candidate preparation.

## Database compatibility

- Approved D10B migration checksum: `6cb9a6e3f65db0fd991d9ee01e9efdca10e2509c0c4ef9893b69347bf0c47d8f`.
- Direct UAT PostgREST OpenAPI inspection resolved project
  `hsezyogfxgnkpweoqqny` and confirmed the five Merchant Details columns, seven
  media-publication columns, `media_approval_requests`, its required contract
  fields, and the four application RPC paths.
- The owner-confirmed migration-history repair remains the authority for remote
  version `20261018021253`. The six unrelated history discrepancies were not
  modified.
- A disposable local Supabase stack applied the complete repository migration
  chain through `20261018021253`; schema lint reported no errors and local
  history contained the D10B version exactly once.

## Review correction

The media cleanup fallback now persists both `transfer_status = 'failed'` and
`publication_status = 'failed'` when an uploaded object cannot be removed after
metadata persistence fails. The media-lifecycle regression asserts both fields,
so an object retained for reconciliation cannot remain mislabeled as a pending
publication proposal.

## Verification

| Gate | Result |
|---|---:|
| Authorization | 35/35 PASS |
| D6 functional | 22/22 PASS |
| D10 financial and Merchant | 14/14 PASS |
| D10B media approval | 22/22 PASS |
| D10B category rule | 11/11 PASS |
| Backend contracts | 28/28 PASS |
| D9 media lifecycle and cleanup | 8/8 PASS |
| Backend typecheck, lint, production build | PASS |
| Frontend typecheck and production build | PASS |
| Frontend lint | PASS with 15 warnings and zero errors |
| Backend runtime dependency audit | 0 vulnerabilities |
| Frontend runtime dependency audit | 0 vulnerabilities |
| Secret-pattern scan of candidate files | PASS |

The 15 frontend warnings are the documented image-optimization and legacy
client-navigation warnings; two apply to D10B image previews. They are not build
or runtime-security failures.

## Release boundary

Pre-existing D7–D9 reports, prior migration-history evidence, and the D10B
execution-attempt reports remain outside this application release commit. They
are operational evidence, include superseded gate states, and are not required
at runtime. No generated artifact outside the repository's already tracked
backend `dist/` convention is included.

## Recommendation

**GO** for a normal fast-forward Git push and non-destructive Railway UAT
staging at the exact release-candidate SHA, subject to a separate explicit owner
authorization. Production import and cutover remain out of scope.
