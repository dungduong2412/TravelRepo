# Copilot Instructions for TravelRepo

## Architecture Overview

This is a **monorepo** with a single NestJS backend and Next.js frontend, enforcing strict separation of concerns:

### Backend (`backend/src/`)
- **NestJS** framework with **Supabase JS client** for database access
- **Controllers**: HTTP routing only, input validation with Zod schemas
- **Services**: All business logic lives here, inject `SupabaseService` for database queries
- **DTOs**: Validated with Zod schemas for type safety
- **Infrastructure**: SupabaseService provides configured Supabase client
- **Port**: Backend runs on port 3000

### Frontend (`frontend/`)
- **Next.js 14** (App Router) on port 3001
- Pages: merchant/collaborator onboarding, admin dashboards, user profiles, QR success
- Frontend NEVER accesses database directly - all via backend API

**Non-negotiable**: No business logic in controllers, no raw SQL, no DB triggers. See [ARCHITECTURE.md](ARCHITECTURE.md).

**Design goal**: Any engineer can leave the project without blocking operations - all code must be explicit, auditable, and replaceable.

## Database Schema

### Supabase Tables
- **user_profiles**: Links Supabase Auth users to roles (merchant/collaborator/admin), includes `merchant_id` or `collaborator_id`
- **merchant_details**: Merchant business information with `merchant_verified` flag
- **collaborators**: Collaborator (tour guide) profiles with `qr_code` for attribution, `collaborators_verified` flag
- **categories**: Master data for travel categories (bilingual: category_name, category_name_vi)

**Backfill workflow**: See [BACKFILL_AND_PROFILE_GUIDE.md](BACKFILL_AND_PROFILE_GUIDE.md) for migrating legacy approved users to user_profiles table.

## Critical Workflows

### Backend Setup (exact commands)
```bash
# From repository root
cd backend
npm install
npm run dev                   # Start backend (port 3000)
```

### Frontend Setup
```bash
# From repository root
cd frontend
npm install
npm run dev                   # Start frontend (port 3001)
# Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env
```

### Environment Variables
- **Backend**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **Frontend**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Adding a New Module
**Always use the [user-profiles module](backend/src/modules/user-profiles/) or [merchants module](backend/src/modules/merchants/) as a template.**
1. **DTO** (`*.dto.ts`): Zod schemas + inferred types
   ```typescript
   export const CreateMerchantSchema = z.object({
     business_name: z.string().min(1),
     commission_rate: z.number().min(0).max(100)
   });
   export type CreateMerchantDto = z.infer<typeof CreateMerchantSchema>;
   ```
2. **Service** (`*.service.ts`): Inject `SupabaseService`, implement all business logic
   ```typescript
   constructor(private readonly supabase: SupabaseService) {}
   
   async findAll() {
     const { data, error } = await this.supabase.getClient()
       .from('table_name')
       .select('*');
     if (error) throw new Error(error.message);
     return data || [];
   }
   ```
3. **Controller** (`*.controller.ts`): Use `ZodValidationPipe` for validation
   ```typescript
   @Post()
   async create(@Body(new ZodValidationPipe(CreateSchema)) dto: CreateDto) {
     return this.service.create(dto);
   }
   ```
4. **Module** (`*.module.ts`): Wire together, export service
5. Register module in [app.module.ts](backend/src/app.module.ts) imports array

## Key Patterns

### Authentication
- Login via `auth.service.ts`: verifies email/password against `user_profiles` + related tables
- Uses bcrypt for password comparison
- Returns custom JWT token
- Tracks login count in `user_profiles` table

### Validation
All endpoints use Zod validation:
```typescript
@Post()
create(
  @Body(new ZodValidationPipe(CreateMerchantSchema)) dto: CreateMerchantDto
) {
  return this.service.create(dto);
}
```

### Database Access Pattern
**Always use SupabaseService**:
- Inject `SupabaseService` into services
- Use Supabase JS client: `this.supabase.getClient().from('table').select()`
- Handle errors explicitly: check `error` property before returning `data`
- Example:
  ```typescript
  const { data, error } = await this.supabase.getClient()
    .from('merchants_details')
    .select('*')
    .eq('merchant_verified', true);
    
  if (error) {
    throw new Error(`Failed to fetch: ${error.message}`);
  }
  return data || [];
  ```

## Common Tasks

### Add New Field to Table
1. Update table schema in Supabase dashboard or via migration SQL
2. Update DTO schemas in `*.dto.ts`
3. Update service CRUD logic if needed

### Create Admin Endpoint
- Add method to appropriate service (e.g., `user-profiles.service.ts`)
- Add route to controller with admin-only logic
- Consider adding role-based authorization checks

## Modules Structure

### Existing Modules
- **auth**: Login/authentication with bcrypt password verification
- **user-profiles**: User account management, roles, backfill utilities
- **categories**: Travel category master data (bilingual)
- **merchants**: Merchant business profiles and verification
- **collaborators**: Tour guide profiles with QR code generation
- **qr**: Public QR code resolution endpoint (`/c/:qrToken`)

### Module Example: Collaborators
```typescript
// collaborators.service.ts
async create(dto: CreateCollaboratorDto) {
  const qrCode = randomBytes(16).toString('hex'); // 32-char hex
  
  const { data, error } = await this.supabase.getClient()
    .from('collaborators')
    .insert({
      ...dto,
      qr_code: qrCode,
      collaborators_verified: false,
    })
    .select()
    .single();
    
  if (error) throw new Error(error.message);
  return data;
}
```

## Testing & Scripts
```bash
# Backend
cd backend
npm run build        # Build for production
npm run typecheck    # TypeScript validation
npm run lint         # ESLint check

# Frontend
cd frontend
npm run build
npm run typecheck
npm run lint
```

## External Dependencies
- **Supabase**: Auth, database, storage
- **PostgreSQL**: Hosted on Supabase, accessed via Supabase JS client
- **NestJS**: Backend framework
- **Zod**: Runtime validation

## Troubleshooting
- Backend won't start: Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`
- Database errors: Verify table names match Supabase schema exactly
- Frontend API calls: Ensure backend is running on port 3000, frontend on 3001
- CORS issues: Backend CORS configured for localhost:3000 and localhost:3001

## Additional Context
- **QR Flow**: Short URLs at `/c/:qrToken` resolve to collaborators via 32-char hex token
- **Verification flags**: `merchant_verified` and `collaborators_verified` control access
- **Backfill**: POST `/user-profiles/backfill` creates auth users for approved merchants/collaborators
- **Manual user creation**: POST `/user-profiles/create` for admin-created accounts
