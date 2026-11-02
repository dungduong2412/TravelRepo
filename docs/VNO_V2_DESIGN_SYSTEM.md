# VNO V2 Design System

Status: introduced in the Business-UAT stabilization release (2026-11-02). Source of truth is the code: tokens in `frontend/app/globals.css`, components in `frontend/components/ui/` and `frontend/components/public/`. This document explains how to use them; if the two disagree, the code wins and this file is wrong.

## 1. Principles

1. **Simple like Airbnb, recognisably VNO.** Image-led cards, generous but not wasteful spacing, one strong accent (coral/rose) used for the primary action and offers only.
2. **Real data or an honest state.** Never demo content in an acceptance path. Every data view has four states: loading, ready, **empty** (the request succeeded, there is nothing) and **error** (the request failed, with Retry). Empty and error never share copy.
3. **Mobile first.** Partners show a QR on a phone at a counter; Merchants scan on a phone. Design at 390 px, then enlarge. No horizontal page scroll at any width.
4. **Accessible by default.** Text contrast >= 4.5:1, visible focus ring, 44 px minimum touch target, labels bound to inputs, errors announced, no information carried by colour alone, `prefers-reduced-motion` respected.
5. **Private data stays private.** Public components may only render fields from the public catalog projection (section 8). Commission, owner identity and legacy fields never appear on a public screen.

## 2. Tokens (`@theme` in `app/globals.css`)

Use the Tailwind utility generated from a token (`bg-brand-600`, `text-ink-muted`, `border-line`, `rounded-card`, `shadow-card`). Do not write hex values, `slate-*`, `gray-*` or `rose-*` in new code.

| Group | Tokens | Use |
|---|---|---|
| Brand | `brand-50/100/500/600/700` | `brand-600` primary buttons and offer badges (white text = 4.96:1). `brand-500` decorative only (3.5:1: never behind small white text). `brand-50/700` selected nav item, soft badge |
| Neutral | `ink`, `ink-muted`, `line`, `surface`, `canvas` | body text, secondary text, borders/dividers, cards, page background |
| Feedback | `success-/warning-/danger-/info-` `50` and `700` | Alert and Badge backgrounds/text pairs; always with an icon and a title |
| Radius | `rounded-card` (1 rem), `rounded-control` (0.75 rem) | cards and dialogs / buttons and inputs |
| Elevation | `shadow-card`, `shadow-pop` | resting cards / menus and dialogs |

### Typography
System UI stack (`--font-sans`); Vietnamese diacritics render natively. Scale: page title `text-2xl sm:text-3xl font-bold tracking-tight`; section title `text-lg font-semibold`; body `text-sm`/`text-base` (inputs are `text-base` on mobile to prevent iOS zoom); helper/meta `text-xs text-ink-muted`. Codes (Partner code) use `font-mono`.

### Spacing
4 px scale via Tailwind. Page gutter `px-4 sm:px-6`; max content width `max-w-7xl` (catalog), `max-w-5xl` (detail/workspace), `max-w-md` (auth). Vertical rhythm: `space-y-4` inside cards and forms, `gap-3`/`gap-5` between cards, `py-5/py-6` page padding. Avoid stacking more than one `py-8+` block (the previous UI wasted a full screen above the fold).

## 3. Components

| Component | File | Notes |
|---|---|---|
| `Button`, `ButtonLink`, `buttonClass()` | `ui/Button.tsx` | variants `primary`, `secondary`, `ghost`, `danger`; min height 44 px. One primary button per view region |
| `Field` | `ui/Form.tsx` | label + input + hint + error wired with `htmlFor`/`aria-describedby`; use for every form input |
| `Alert` | `ui/Feedback.tsx` | `tone` success/warning/danger/info; `danger` is `role="alert"`; always give a `title` that says what happened and a body that says what to do |
| `Spinner`, `EmptyState`, `ErrorState`, `Badge` | `ui/Feedback.tsx` | `EmptyState`/`ErrorState` expose `data-state="empty|error"` for tests |
| `Wordmark`, `PageHeader`, `Card` | `ui/Brand.tsx` | page chrome |
| `AuthShell` | `ui/AuthShell.tsx` | frame for login, recovery, claim and account-status screens |
| `CategoryIcon` | `ui/Icon.tsx` | maps API icon slugs and category names to Lucide icons. **Never print `category_icon` as text** (the database holds Font Awesome class strings) |
| `SiteHeader`, `CategoryBar`, `ListingCard`, `ListingSkeletons` | `public/` | public discovery |
| `PartnerQrCard` | `components/PartnerQrCard.tsx` | the Partner QR (display, enlarge, download) |
| `RoleDashboardShell` | `components/RoleDashboardShell.tsx` | Merchant/Partner workspace: sidebar (>= lg), top bar + bottom tab bar (< lg), account-status screen |

Icons: Lucide only (`lucide-react`), `aria-hidden="true"` when decorative, 16/20/24 px. No emoji and no icon fonts in the UI.

## 4. Navigation

* Public: top bar (wordmark, "become a supplier", sign in / workspace), search, category bar. Filters live in the URL (`?category=<id>&q=`), so every state is shareable and survives refresh.
* Detail pages live at `/merchants/<id>`; cards are real links (open in new tab, share, deep-link).
* Workspaces: sidebar on desktop; on mobile a top bar plus a 5-item bottom tab bar (`shortLabel` is used so labels fit). Active item has `aria-current="page"`.
* Role redirects: after sign-in Admin -> `/admin/dashboard`, Merchant -> `/merchant/dashboard`, Partner -> `/collaborator/dashboard`. A signed-in role never sees another role's workspace; an unapproved account sees its status, not a spinner.

## 5. Responsive breakpoints

Tailwind defaults: `sm` 640, `md` 768, `lg` 1024 (sidebar appears), `xl` 1280. Catalog grid: 1 column < 640, 2 at `sm`, 3 at `lg`, 4 at `xl`. Verify at 390 x 844 and 1366 x 800.

## 6. Content guidelines

* Vietnamese first, short sentences, sentence case, no jargon ("nhà cung cấp" = Merchant, "Đối tác" = Partner; never show "Collaborator" in UI).
* Errors say what happened and what to do next. Never expose raw API/status text. Do not reveal whether an e-mail has an account (recovery and login copy stay generic).
* Offers: show the customer discount only (`Giảm 5%`); hide the badge when there is no offer. **Never show commission on a public page.**
* Unavailable data is stated plainly ("Nhà cung cấp chưa cập nhật phần giới thiệu"), in a muted style, and is distinct from errors.
* Money: Vietnamese grouping; amounts keep the platform's stored precision.

## 7. Accessibility checklist (for every new page)

- [ ] One `h1`; landmarks (`header`, `nav` with `aria-label`, `main`)
- [ ] Every control reachable and operable by keyboard; focus ring visible; dialogs use `<dialog>` (focus trap, Esc)
- [ ] Inputs use `Field`; errors are text, not colour only
- [ ] Images have meaningful `alt`; decorative icons `aria-hidden`
- [ ] Touch targets >= 44 px; no horizontal scroll at 390 px
- [ ] Loading, empty and error states implemented and tested

## 8. Implementation conventions

* **Public data contract.** Anonymous screens call only `/public/*` (`public-catalog` module). Its projection allow-list (`public-catalog.projection.ts`) is the single gate: owner name/phone/e-mail, tax code, commission and all `legacy_*` fields are not selectable. Add a field only after a privacy review and a test in `backend/scripts/test-public-catalog.ts`.
* **Images.** Use `imageSrc(path, 'thumb'|'card'|'hero')`; the API returns a short-lived redirect to a resized rendition (~30-70 KB instead of 1-4.5 MB originals). `size=original` exists for integrity checks only.
* **Partner QR.** QR content is the canonical Partner code (the contract Merchants scan with `POST /qr/resolve`). The image is generated from the current code on every request; never cache or print a QR from a previously stored image.
* **Data-fetch components** own their `loading | error | ready` state and render `ErrorState` with a Retry callback on failure.
* **Styling.** Tailwind utilities with tokens; no new inline `style={{}}` objects. Legacy admin sub-pages still contain inline styles and are migrated opportunistically when touched.
* **Tests.** New screens get a Playwright spec in `e2e-uat/tests/` with stable `data-testid`s for lists/cards and `getByRole`/`getByLabel` for controls. Screenshots (desktop + 390 px) are part of the evidence.
