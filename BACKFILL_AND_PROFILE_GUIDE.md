# Auth account and profile migration guide

This guide supersedes the legacy password-column backfill process.

## Approved migration model

For every active V1 identity in the accepted tenant snapshot:

1. Match exact legacy UUID, then case-insensitive email.
2. Reuse an existing Auth account only when its reviewed role and entity association agree. An unreviewed collision stops the import.
3. Otherwise create the Supabase Auth account with the stable legacy UUID, a random bootstrap password, role/legacy identity in `app_metadata`, and `password_reset_required=true`.
4. Create the linked `user_profiles` and `legacy_identity_map` records.
5. Do not import legacy password hashes, tokens, stamps, or domain-table passwords.
6. Do not send invite or recovery email during import. Password-reset onboarding starts only after SMTP and support approval.

Deleted or role-less source identities remain controlled archive records and do not become active Auth accounts.

## Runtime profile behavior

- `GET /user-profiles/me` returns only the authenticated user's profile under RLS.
- Admin-only collection and mutation endpoints require both a valid JWT and the active Admin profile.
- Merchant/collaborator routes enforce entity ownership.
- Direct Data API access to financial and migration tables remains denied to anonymous and authenticated client roles.

## Operational controls

- Use only sealed `snapshot-3` and verify all hashes before reading it.
- Run duplicate matching immediately before import. Any change from the reviewed zero-match result requires review.
- Use the restartable importer and deterministic batch ID; never use the legacy backfill scripts for migration.
- Validate Auth, role, entity, RLS, financial, media, and duplicate invariants in isolation before production authorization.

See `docs/V1_V2_PHASE_D2_READINESS_20261014.md` and the Phase D3 rollback runbook for evidence and release controls.
