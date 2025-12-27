# Architecture Rules

## Non-Negotiable Rules
1. Controllers must not contain business logic
2. Services own all business behavior
3. Policies enforce permissions and ownership
4. Database access only via Prisma
5. Supabase is used only for:
   - Authentication
   - Storage
   - Realtime (if needed)

## Forbidden Patterns
- Business logic inside SQL
- Triggers with side effects
- Direct frontend-to-database writes
- Implicit authorization checks

## Design Goal
Any engineer can leave the project without blocking operations.
