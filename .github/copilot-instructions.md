# Copilot Instructions for TravelRepo

## Architecture Overview

This is a **monorepo** with NestJS backend (port 3000) and Next.js frontend (port 3001), enforcing strict separation of concerns:

### Backend (`src/`)
- **Controllers**: HTTP routing only, extract user context from `@User()` decorator. **No business logic here.**
- **Services**: All business logic lives here. **Never put business logic in controllers or policies.**
- **Policies**: Authorization checks only (e.g., [merchants.policy.ts](src/modules/merchants/merchants.policy.ts))
- **DTOs**: Validated with Zod schemas (see [merchants.dto.ts](src/modules/merchants/merchants.dto.ts))

### Frontend (`frontend/`)
- **Next.js 14** (App Router) on port 3001
- **Supabase client** in [lib/supabase.ts](frontend/lib/supabase.ts) for auth
- Pages: merchant/collaborator onboarding, admin dashboards, QR success page
- Frontend NEVER accesses database directly - all via backend API

**Non-negotiable**: No business logic in controllers or policies, no raw SQL, no DB triggers. See [ARCHITECTURE.md](ARCHITECTURE.md).

**Design goal**: Any engineer can leave the project without blocking operations - all code must be explicit, auditable, and replaceable.

## Domain Model (Prisma Schema)
- **User**: Auth identity from Supabase (id is Supabase user UUID)
- **Merchant**: Travel merchants owned by users
- **Collaborator**: Tour guides with QR tokens for attribution (auto-generated 32-char hex token on creation)
- **Attribution**: Links collaborators to merchants via QR codes

Status lifecycles:
- Merchant: `DRAFT` → `ACTIVE`
- Collaborator: `DRAFT` → `ACTIVE` or `SUSPENDED`
- Attribution: `ACTIVE` or `DISABLED`

Ownership pattern: All domain entities have `ownerUserId` matching the creating user's Supabase ID.

## Critical Workflows

### Backend Setup (exact commands)
```bash
# From repository root
cp .env.example .env          # Configure DATABASE_URL, SUPABASE_*
npm install
npx prisma generate           # Generate Prisma client
npx prisma migrate dev        # Run migrations
npm run dev                   # Start backend (port 3000)
```

### Frontend Setup
```bash
# From repository root or frontend/
cd frontend
npm install
npm run dev                   # Start frontend (port 3001)
# Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env
```

### Environment Variables
- **Backend**: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_ISSUER`, `JWT_AUDIENCE`
- **Frontend**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Schema Changes
1. Edit [prisma/schema.prisma](prisma/schema.prisma)
2. Run `npx prisma migrate dev --name descriptive_name`
3. Commit both schema and migration files
4. Run `npx prisma generate` to update client types

### Adding a New Module
**Always use the [merchants module](src/modules/merchants/) as a template.**
1. **DTO** (`*.dto.ts`): Zod schemas + inferred types
   ```typescript
   export const CreateMerchantSchema = z.object({
     name: z.string().min(1),
     commissionRate: z.number().min(0).max(100)
   });
   export type CreateMerchantDto = z.infer<typeof CreateMerchantSchema>;
   ```
2. **Policy** (`*.policy.ts`): `canCreate()`, `canUpdate()`, etc. (no business logic)
3. **Service** (`*.service.ts`): Inject `PrismaService`, implement all business logic
4. **Controller** (`*.controller.ts`): Use `@UseGuards(JwtGuard)`, validate with `ZodValidationPipe`
5. **Module** (`*.module.ts`): Wire together, export service
6. Register module in [app.module.ts](src/app.module.ts) imports array

Example: [collaborators module](src/modules/collaborators/) shows QR token generation pattern using `crypto.randomBytes(16).toString('hex')`.

## Key Patterns

### Authentication
- All routes protected by [JwtGuard](src/common/auth/jwt.guard.ts) unless marked `@Public()`
- Extract user: `@User() actor: any` (contains `id`, `email` from Supabase JWT)
- Pass `actor.id` to services as `ownerUserId`
- Guard validates JWT via Supabase `/auth/v1/user` endpoint (network call per request - acceptable for v1)
- Attaches `req.user` (SupabaseUser) and `req.context` (requestId, userId) to request

### Validation
```typescript
@Post()
create(
  @Body(new ZodValidationPipe(CreateMerchantSchema)) dto: CreateMerchantDto,
  @User() actor: any
) {
  return this.service.create(actor.id, dto);
}
```

### Database Access
- Always inject `PrismaService` into services
- Use Prisma's type-safe client: `this.prisma.merchant.create(...)`
- Throw `NotFoundException` when entity missing
- PrismaService connects on module init, disconnects on destroy
- Enums from schema auto-generated: `CollaboratorStatus`, `MerchantStatus`, `CollaboratorTier`, etc.

### Authorization
```typescript
// In service before update/delete
const canUpdate = this.policy.canUpdate(actor, merchant.id);
if (!canUpdate) throw new ForbiddenException('Not authorized');
```

## Common Tasks

### Add New Field to Merchant
1. Update `model Merchant` in [schema.prisma](prisma/schema.prisma)
2. Run migration: `npx prisma migrate dev --name add_merchant_field`
3. Update [merchants.dto.ts](src/modules/merchants/merchants.dto.ts) schemas
4. Update [merchants.service.ts](src/modules/merchants/merchants.service.ts) CRUD logic

### Create Admin Endpoint
- Place in [src/modules/admin/](src/modules/admin/)
- Use stricter policy checks or separate admin guard
- Example: [admin-collaborators.controller.ts](src/modules/admin/admin-collaborators.controller.ts)

## Testing & Scripts
```bash
npm run build        # Build for production
npm run typecheck    # TypeScript validation
npm run lint         # ESLint check
npm test             # Run Jest tests
```

## External Dependencies
- **Supabase**: Auth (JWT issuer), config in [supabase.config.ts](src/config/supabase.config.ts)
- **PostgreSQL**: via `DATABASE_URL`, hosted on Supabase
- **Prisma**: ORM, client generated to `node_modules/@prisma/client`

## Troubleshooting
- "Cannot find module @prisma/client": Run `npx prisma generate`
- Auth 401 errors: Check JWT_ISSUER/JWT_AUDIENCE in `.env`
- Migration conflicts: Review [prisma/migrations/](prisma/migrations/)
- Frontend API calls: Ensure backend is running on port 3000, frontend on 3001
- CORS issues: Backend configured for local dev, check [main.ts](src/main.ts)

## Additional Context
- **QR Flow**: Short URLs at `/c/:qrToken` resolve to collaborators (see [qr.controller.ts](src/modules/public/qr.controller.ts))
- **No PrismaService in services yet**: Some services have TODOs to replace mock data with real Prisma calls
- **Migrations**: Named with timestamp prefix (e.g., `20251227_add_merchant/`), committed with schema changes
