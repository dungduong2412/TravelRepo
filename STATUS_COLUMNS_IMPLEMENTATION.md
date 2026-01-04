# Status Columns Implementation

## Overview
Added status tracking columns to three main tables: `collaborators`, `merchant_details`, and `user_profiles`.

## Database Changes

### New Columns Added:
1. **collaborators.collaborators_status** - Default: 'pending'
   - Values: pending, active, inactive, blocked
   
2. **merchant_details.merchants_status** - Default: 'pending'
   - Values: pending, active, inactive, blocked
   
3. **user_profiles.user_profiles_status** - Default: 'active'
   - Values: active, inactive, suspended

### Migration File
Location: `database-migrations/add_status_columns.sql`

### To Apply Migration:
1. Open Supabase SQL Editor
2. Copy contents from `database-migrations/add_status_columns.sql`
3. Execute the SQL script
4. Verify columns are created with correct defaults

## Backend Changes

### DTOs Updated:
1. **backend/src/modules/collaborators/collaborators.dto.ts**
   - Added `collaborators_status` to CollaboratorSchema
   - Added `collaborators_status` to UpdateCollaboratorSchema

2. **backend/src/modules/merchants/merchants.dto.ts**
   - Added `merchants_status` to UpdateMerchantSchema

3. **backend/src/modules/user-profiles/user-profiles.dto.ts**
   - Added `user_profiles_status` to UserProfileSchema
   - Added `user_profiles_status` to CreateUserProfileSchema

### Services Updated:
1. **backend/src/modules/collaborators/collaborators.service.ts**
   - `create()` method now sets `collaborators_status: 'pending'`

2. **backend/src/modules/merchants/merchants.service.ts**
   - `create()` method now sets `merchants_status: 'pending'`

3. **backend/src/modules/user-profiles/user-profiles.service.ts**
   - `createOrUpdate()` method now sets `user_profiles_status: 'active'`

## Frontend Changes

### Admin Pages Updated:
1. **frontend/app/admin/collaborators/page.tsx**
   - Added `collaborators_status` to interface
   - Updated status badge to show status with color coding:
     - Active: Green
     - Pending: Yellow/Orange
     - Inactive: Gray
     - Blocked: Red

2. **frontend/app/admin/merchants/page.tsx**
   - Added `merchants_status` to interface
   - Updated status badge with same color coding

3. **frontend/app/admin/users/page.tsx**
   - Added `user_profiles_status` to interface
   - Updated status badge to show status with color coding:
     - Active: Green
     - Inactive: Gray
     - Suspended: Red
   - Updated data processing to use `user_profiles_status` column

## Testing Checklist

### Database:
- [ ] Run migration SQL successfully
- [ ] Verify columns exist in tables
- [ ] Check default values are set correctly

### Backend:
- [ ] Start backend server (`cd backend && npm run dev`)
- [ ] Test creating new collaborator - should have status='pending'
- [ ] Test creating new merchant - should have status='pending'
- [ ] Test creating new user profile - should have status='active'
- [ ] Verify API responses include status fields

### Frontend:
- [ ] Start frontend server (`cd frontend && npm run dev`)
- [ ] Navigate to http://localhost:3001/admin/collaborators
  - Verify status column displays correctly
  - Check color coding for different statuses
- [ ] Navigate to http://localhost:3001/admin/merchants
  - Verify status column displays correctly
  - Check color coding for different statuses
- [ ] Navigate to http://localhost:3001/admin/users
  - Verify status column displays correctly
  - Check color coding for different statuses

### Integration Testing:
- [ ] Create new collaborator via signup form
  - Verify status is 'pending' in admin panel
- [ ] Create new merchant via signup form
  - Verify status is 'pending' in admin panel
- [ ] Check existing records show fallback values if status is null

## Files Modified

### Database:
- `database-migrations/add_status_columns.sql` (NEW)

### Backend:
- `backend/src/modules/collaborators/collaborators.dto.ts`
- `backend/src/modules/collaborators/collaborators.service.ts`
- `backend/src/modules/merchants/merchants.dto.ts`
- `backend/src/modules/merchants/merchants.service.ts`
- `backend/src/modules/user-profiles/user-profiles.dto.ts`
- `backend/src/modules/user-profiles/user-profiles.service.ts`

### Frontend:
- `frontend/app/admin/collaborators/page.tsx`
- `frontend/app/admin/merchants/page.tsx`
- `frontend/app/admin/users/page.tsx`
- `frontend/app/merchant/onboard/page.tsx` (TypeScript fix)

## Status Color Legend

### Collaborators & Merchants:
- 🟢 **Active** - Green (#d1fae5 / #065f46)
- 🟡 **Pending** - Yellow/Orange (#fef3c7 / #92400e)
- ⚪ **Inactive** - Gray (#e5e7eb / #374151)
- 🔴 **Blocked** - Red (#fee2e2 / #991b1b)

### User Profiles:
- 🟢 **Active** - Green (#d1fae5 / #065f46)
- ⚪ **Inactive** - Gray (#e5e7eb / #374151)
- 🔴 **Suspended** - Red (#fee2e2 / #991b1b)

## Next Steps
1. Apply database migration via Supabase SQL Editor
2. Test backend endpoints
3. Test frontend admin pages
4. Commit all changes
5. Update REQ-004 in RTM if this relates to approval flow
