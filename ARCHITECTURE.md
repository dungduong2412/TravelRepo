# Architecture Rules

## Non-Negotiable Rules
1. Controllers must not contain business logic
2. Services own all business behavior
3. Database access only via Supabase JS client
4. Supabase is used for:
   - Authentication
   - Database (PostgreSQL)
   - Storage
   - Realtime (if needed)

## Forbidden Patterns
- Business logic inside SQL
- Triggers with side effects
- Direct frontend-to-database writes
- Implicit authorization checks

## Design Goal
Any engineer can leave the project without blocking operations.

<!--
These architecture rules are mandatory.
All generated code must comply with this document.
-->
