# VNO V2 — Members security hardening (2026-11-10)

**Status: built and verified LOCALLY ONLY. Nothing is deployed, migrated or pushed. The running Railway environment was not touched.**

> **Environment note (owner correction, 2026-11-10).** The Railway project `vno-v2-uat` (environment `uat`) and the Supabase project it uses are the **live VNO production**; there is no separate Production. Every deployment of this change is therefore a *controlled production release* that needs its own explicit deployment decision. No hosted test of this change was run, and none that creates financial records is proposed.

## 1. What this change does
| # | Requirement | Result |
|---|---|---|
| 1 | Retire `POST /collaborators/members` with an explicit feature-retired response | Every **authenticated** caller (Partner, Merchant, Admin) gets **`410 Gone`** `{ "code": "FEATURE_RETIRED", "message": "<Vietnamese>" }`. Anonymous callers are still refused by the JWT guard (`401`). The body is neither read nor validated and **nothing is written**. The service method and its DTO were deleted (dead code). |
| 2 | Preserve historical records and audit logs | No migration, no delete, no update of existing rows. `collaborators.merchant_system_id`, the old `collaborator.member_application_created` audit rows and every Partner row are untouched. `GET /collaborators/members` stays (history). |
| 3 | Keep `POST /merchants/members` operational | Unchanged route and body shape for valid input; the page works as before. |
| 4 | Rate limiting, idempotency, duplicate e-mail, input validation for Merchant Members | See §3. |
| 5 | No unauthorized access to personal or banking information | See §4. |
| 6 | Regression locally before proposing deployment | See §5. |
| 7 | No change to the running environment | Honoured. See §7 for the deployment proposal. |

## 2. Findings that motivated it (from the review in `VNO_V2_GLOBAL_PARTNER_NETWORK_UAT_RELEASE_20261109.md` §10.4, plus what was found while hardening)
* `POST /collaborators/members` let a Partner with a historical assignment create pending Partner applications stamped with that assignment (opposite of the global-network rule), storing third-party personal and bank data.
* `POST /merchants/members` had: a loose schema (phone = any 7–20 characters, bank account = free text up to 100, nothing trimmed or normalised, e-mail case-sensitive), **no rate limit, no idempotency, no duplicate handling beyond "an account already exists"**, the database error text echoed to the caller on failure, and it returned the **whole inserted row — including the bank account number — in the response**.
* Both list routes returned other people's full phone number and e-mail (the Partners tagged to a Merchant are real people, some of them approved Partners).
* A Merchant whose own application was still pending (`merchants_status != active` or not verified) could add members.

## 3. `POST /merchants/members` — the hardened behaviour
**Validation (one schema, strict keys, field-level Vietnamese errors through the existing `ZodValidationPipe`).** All text is NFC-normalised, trimmed and has inner whitespace collapsed.
| Field | Rule |
|---|---|
| `collaborators_name` | 2–120 characters; no control characters and no `<` `>` |
| `collaborators_phone` | separators (`space . - ( )`) removed, then `+?` and 8–15 digits; stored without separators |
| `collaborators_email` | trimmed and **lower-cased**; ≤ 254; valid e-mail; no `..`, no dot before `@`, no leading dot |
| `collaborators_bank_name` | optional; 2–100; letters, digits, space and `. , & ( ) / ' -`; blank = not provided |
| `collaborators_bank_acc_number` | optional; spaces and `-` removed, then 6–20 digits; blank = not provided |
| any other key | rejected (`status`, `verified`, `merchant_system_id`, `code`, `idempotency_key` … cannot be sent) |

**Authorization before anything else:** active Merchant profile (`403` otherwise) **and** the Merchant itself must be `active` + `verified` (`403 MERCHANT_NOT_ACTIVE`; before, a still-pending Merchant could add members).

**Rate limiting (per Merchant, `429`).** Hour window `MEMBER_RATE_LIMITED`, day window `MEMBER_DAILY_LIMIT`; the body carries `limit` and `window`. In-process (the codebase documents that one API instance runs per environment). A replay counts as a request; a request rejected by validation does not reach the limiter.
**Durable cap (`409 MEMBER_LIMIT_REACHED`).** At most N *pending* applications per Merchant, counted in the database, so a restart or a second instance cannot lift it. Approved Partners do not count.
**Policy values (proposal — need the owner's confirmation; overridable by environment without a code change):**
| Setting | Default | Environment variable |
|---|---|---|
| creations per hour per Merchant | 10 | `MERCHANT_MEMBER_CREATES_PER_HOUR` |
| creations per day per Merchant | 40 | `MERCHANT_MEMBER_CREATES_PER_DAY` |
| pending applications per Merchant | 50 | `MERCHANT_MEMBER_PENDING_CAP` |

**Idempotency and duplicates (natural key = the normalised e-mail; no migration).**
* The *same submission again* (same Merchant, row still pending, same normalised name / phone / e-mail / bank data) → `201` with the original row and **`idempotent_replay: true`**; no second row, no second audit entry.
* *Anything else* that holds the e-mail — different details, another Merchant, an approved Partner, an existing account or an Auth-only identity — → **`409 MEMBER_EMAIL_UNAVAILABLE`**, one generic Vietnamese message, body `{code, message}` only. All those cases look identical to the caller, so the route does not reveal whether, where or by whom an e-mail is used.
* Serialised per (Merchant, e-mail) with the existing `KeyedLock`, so a double click or retry storm produces one row; after the insert the request re-checks and, if another instance inserted the same e-mail first, **removes only its own just-created row** (earliest registration wins) and answers replay / 409.
* ILIKE wildcards in an e-mail (`_`, `%`) are escaped, so `x_y@…` and `xzy@…` are different addresses.
* **Residual limit, stated plainly:** the post-insert check is defence in depth, not a database guarantee. With several API instances racing within a few milliseconds a duplicate *pending* row could still survive. The strict guarantee needs a unique index, which needs a migration (existing duplicate rows must be cleaned first) — a proposal is in §8; it is not part of this change.
* The database error text is never returned (`500 MEMBER_CREATE_FAILED` with a Vietnamese message); a collision of the generated code is retried.

## 4. Personal and banking data
| Route | Before | After |
|---|---|---|
| `POST /merchants/members` answer | the entire inserted row (bank account number included) | `id`, `collaborators_code`, `collaborators_name`, `collaborators_status`, `collaborators_verified`, `collaborators_registered_date`, `idempotent_replay` — no phone, e-mail or bank data |
| `GET /merchants/members` | full phone and e-mail of every tagged Partner | same rows, **phone and e-mail masked** (`*******678`, `a***@domain`), exact key set, no bank data, no code |
| `GET /collaborators/members` (legacy team list) | full phone and e-mail | masked, same projection |
| audit entry of a creation | merchant id + flag | unchanged: **no name, phone, e-mail or bank data** (verified by test) |
Bank fields are never selected by any list route. A Merchant sees only Partners tagged to **its own** `merchant_system_id`. Masking is a **behaviour change the owner should confirm** (the Merchant Members table now shows masked values).

## 5. Verification — local only
Rehearsal = disposable Postgres 17 + PostgREST v14.5 built from the repo baseline and **every** migration (Docker containers, loopback; never the hosted environment).

| Check | Result |
|---|---|
| `npm run test:merchant-members` (pure rules: normalisation, 18 rejection cases with Vietnamese field errors, strict keys, duplicate comparison, masks, projections, limits parsing, route metadata) | **33 controls PASS** |
| `npm run test:rehearsal-merchant-members` — a **real Nest app** (real `JwtGuard`, `AdminGuard`, controllers, pipes) → real services → real supabase-js → PostgREST → migrated Postgres. Only Supabase Auth's `getUser` and the account-existence lookup are stood in for | **18 controls PASS** |
| mutation checks (planted regressions): unit — e-mail not lower-cased, list leaks bank number, `strict` removed → **each caught**; integration — retired route returns 201, list unmasked, cap not enforced, no lock + no convergence, conflict discloses the existing id, unapproved Merchant allowed → **each of 6 caught**; sources restored byte-for-byte | ✔ |
| regression: `test:rehearsal-global-network` 9, `test:merchant-qr-flow` 23, `test:merchant-profile-update` 10, `test:d6-contracts` 28, `test:media-lifecycle` 18, `test:invitation-guards` 3, `test:partner-single-step` 29, `test:approve-unclaimed` 7, `test:main-media` 13, `test:public-catalog` 14, `test:anonymous-privacy` 3, `test:auth-email-hook` 15 | all PASS |
| backend `tsc`, eslint (0 errors; 1 existing warning), `npm run build` | clean |
| frontend `tsc`, eslint (0 errors; existing `<img>` warnings), `next build`, self-tests (auth-errors, merchant-profile, partner-registration, QR: 46 frames) | clean / PASS |
| e2e project `tsc` (spec 102 gains N5, N6) | clean |

What the integration test proves, in short: 401 for anonymous and bad tokens on both routes; `410` for Partner, Partner-without-team, Merchant, Admin and pending Merchant on the retired route with garbage, empty and privileged-key bodies and **no row, audit entry or profile written**; Merchant create → normalised pending row for the right Merchant, minimal answer, audit without personal data; replay; the five conflict kinds are byte-identical; LIKE safety; 8 parallel identical requests → one row and one audit entry; simulated cross-instance race (older competing row by another Merchant → 409 and the competing row intact; by the same Merchant with the same data → replay); validation over HTTP with Vietnamese field errors and no write; Partner / Admin / inactive profile → 403; pending Merchant → GET ok, POST `MERCHANT_NOT_ACTIVE`; hour limit, day limit, separate buckets per Merchant; pending cap including after a "restart" (new service instance); lists masked, key sets exact, no bank data in any output, Merchant B sees none of Merchant A's Partners; legacy rows, their bank data in the database and the old audit row untouched; no member application ever gets a sign-in, a link or an assignment.

**Failures that are not caused by this change (unchanged, documented since before):** `test:d13a-contracts` (stale QR-payload assertion) and `test:email-delivery` (37 passed, 2 failed: the hook's signup and recovery message checks). Not hidden, not fixed here.

## 6. Risks and behaviour changes visible to users (live environment)
1. Merchants now see **masked** phone/e-mail in the Members table (and Partners in the legacy list).
2. A Merchant that is not `active` + `verified` can no longer add members (`403`).
3. More than 10 creations/hour or 40/day, or more than 50 pending applications, is refused (`429` / `409`). Values are proposals.
4. Invalid input is refused with field-level Vietnamese messages instead of a generic error; previously accepted loose values (e.g. letters in an account number, 7-digit phones, markup in a name) are now rejected. Existing rows are not re-validated.
5. Newly stored phone numbers have no separators and e-mails are lower-case; old rows keep their original form (the duplicate comparison normalises both sides).
6. `POST /collaborators/members` answers `410` to every authenticated caller, including roles that previously got `403`.
7. The Members page change is cosmetic (shows the Vietnamese field/conflict/limit messages). It is safe to ship the API first: with the old Web the same messages arrive in the page's error line, only validation errors read as "Validation failed".

## 7. Deployment proposal (NOT executed — needs the owner's separate deployment decision)
* **Scope:** API + Web, **no migration, no data change.** Order: API → Web.
* **Rollback targets:** API `50fce891-7d9c-4677-9415-9ab473b130d2` (`4763394`), Web `76204cba-a731-47de-838b-e0827a40bfe1` (`bcd6e60`) — re-stage those SHAs. Nothing in the database changes, so rollback is application-only.
* **Pre-deploy:** the owner confirms the policy values (§3) and the user-visible changes (§6); the commit is pushed and its SHA pinned.
* **Post-deploy verification — read-only or write-safe only (no synthetic financial transactions, no temporary Merchants):** `tests/102-partner-members-retired.spec.ts` N1–N6 (N5 sends an *empty* body, which cannot create a row on either version; N6 sends an *invalid* body), `00-unauth`, `95-onboarding-identity`. **Do not run** specs 99 or 101 on the live environment. A real Members creation is not exercised hosted; it is covered by the rehearsal integration test.
* **Watch after deploy:** 429/409 responses on `/merchants/members`, any 500 `MEMBER_*`, and that `collaborators` rows with `collaborators_status = 'pending'` per Merchant stay well under the cap.

## 8. Optional follow-up (separate release, separate decision): strict uniqueness in the database
A unique index makes the duplicate guarantee independent of the number of API instances. It cannot be created while duplicate rows exist, so it needs a data review first. Read-only query to find them, then a *proposed* index limited to applications (not applied, not in `supabase/migrations`):

    -- how many e-mails are held by more than one Partner row?
    select lower(collaborators_email) as email, count(*) from public.collaborators
     where collaborators_email is not null group by 1 having count(*) > 1;

    -- proposal, only after the duplicates above are resolved by an owner decision:
    create unique index concurrently collaborators_email_lower_uq
      on public.collaborators (lower(collaborators_email)) where collaborators_email is not null;

## 9. Not done / open
* The Merchant Members **page** still offers an avatar picker that the API has never stored (existing behaviour, untouched).
* Merchant-created applications still carry `merchant_system_id` of the Merchant (that column is how the Merchant's own list works); nothing consults it for QR, discounts or transactions.
* The Partner-side `GET /collaborators/members` is kept (masked) for history; whether to retire it too is an owner decision.
* Business acceptance of real-device QR scanning and Merchant payment remains open and is not affected by this change.
