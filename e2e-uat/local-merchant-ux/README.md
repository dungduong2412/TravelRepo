# Merchant Management UX — local acceptance harness

Runs against a **local** Supabase stack only (every script refuses a non-loopback `SUPABASE_URL`) — never against hosted UAT.
Synthetic merchants are prefixed `UXIMG`; `cleanup.mjs` removes them (rows, Storage objects, users, audit rows).

1. Start a local stack restored from a UAT snapshot, the API (`:3100`, `npm run dev` in `backend/`) and the web app (`:3011`, `next dev -p 3011` in `frontend/`) pointed at it.
2. Write an env file with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (loopback values).
3. `node fixtures.mjs <env> <fixtures.json>` — admin, two merchant owners, three synthetic merchants, four images.
4. `node api-acceptance.mjs <env> <fixtures.json>` — RBAC, tenant isolation, set-main persistence, public parity (also read-only over all published real merchants).
5. `node ui-acceptance.mjs <fixtures.json>` — desktop/mobile layout, View/Edit/Save/Cancel, Set as main, public pages, broken images; screenshots go to `docs/screenshots/merchant-ux/`.
6. `node real-readonly.mjs <fixtures.json>` — read-only walk through migrated merchants (no write control is clicked).
7. `node cleanup.mjs <env>`.
