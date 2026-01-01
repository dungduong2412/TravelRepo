# Backfill and Profile Viewing Guide

## Overview
This document explains the backfill logic and profile viewing features implemented for existing approved merchants and collaborators.

## What Was Implemented

### 1. Backfill Logic for Existing Approved Users

**Purpose**: Create user profiles and Supabase Auth accounts for merchants and collaborators who were approved before the user management system was implemented.

**Endpoint**: `POST /user-profiles/backfill`

**How it works**:
1. Queries `merchant_details` table for all merchants where `merchant_verified = true`
2. Queries `collaborators` table for all collaborators where `collaborators_verified = true`
3. For each approved user:
   - Checks if user profile already exists (skip if yes)
   - Checks if Supabase Auth user exists
   - If no auth user exists, creates one with their password (from `owner_password` or `collaborators_password`)
   - Creates `user_profiles` entry with proper role and ID references

**Running the backfill**:
```bash
curl -X POST http://localhost:3000/user-profiles/backfill
```

**Response example**:
```json
{
  "merchants": {
    "created": 0,
    "skipped": 2,
    "errors": []
  },
  "collaborators": {
    "created": 0,
    "skipped": 2,
    "errors": []
  }
}
```

### 2. User Profile Viewing

**Endpoint**: `GET /user-profiles/me` (requires authentication)

**Profile Page**: `/profile`

**Features**:
- Displays user account information (email, role, last login, login count, created date)
- Shows role-specific details:
  - **Merchants**: Business name, owner name, contact phone, category, address, verification status
  - **Collaborators**: Name, phone, bank info, rating, verification status
- Automatically tracks login when page loads (increments login counter)

**Role-Specific Details**:

For Merchants:
```typescript
- merchant_name
- owner_name
- merchant_contact_phone
- merchant_category
- new_address_city, new_address_ward, new_address_line
- merchant_verified status
```

For Collaborators:
```typescript
- collaborators_name
- collaborators_phone
- collaborators_bank_name
- collaborators_bank_acc_name
- collaborators_bank_acc_number
- collaborators_rating
- collaborators_verified status
```

### 3. Login Tracking

**Endpoint**: `POST /user-profiles/track-login` (requires authentication)

**Tracked Fields**:
- `last_login_at`: Timestamp of last successful login
- `login_count`: Total number of successful logins (incremented on each login)

**Automatic Tracking**:
- Called automatically when user logs in (in login page)
- Called automatically when user views profile page
- Does not block user experience if tracking fails

### 4. Role-Based Redirect After Login

**Login Flow**:
1. User enters email and password at `/login`
2. Supabase Auth validates credentials
3. System calls `POST /user-profiles/track-login` to increment counter
4. System calls `GET /user-profiles/me` to fetch user role
5. Redirects based on role:
   - **Admin** → `/admin` (admin dashboard)
   - **Merchant/Collaborator** → `/profile` (personal profile page)

## Updated Services

### user-profiles.service.ts
- **`createOrUpdate()`**: Now creates Supabase Auth users if they don't exist
- **`backfillFromApprovedMerchantsAndCollaborators()`**: Scans both tables and creates profiles with auth accounts
- **`trackLogin()`**: Updates last_login_at and increments login_count

### merchants.service.ts
- **`approve()`**: Passes `owner_password` when creating user profile

### collaborators.service.ts
- **`approve()`**: Passes `collaborators_password` when creating user profile

## Database Tables Involved

### user_profiles
```sql
- id UUID (PK)
- user_id UUID (FK to auth.users) NOT NULL
- email TEXT NOT NULL
- role TEXT ('admin', 'merchant', 'collaborator')
- merchant_id UUID (FK to merchant_details.merchant_system_id, nullable)
- collaborator_id UUID (FK to collaborators.id, nullable)
- last_login_at TIMESTAMPTZ (nullable)
- login_count INTEGER (default 0)
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ
```

### merchant_details
```sql
- merchant_system_id UUID (PK)
- owner_email TEXT
- owner_password TEXT (hashed with bcrypt)
- merchant_verified BOOLEAN
- ... (other merchant fields)
```

### collaborators
```sql
- id UUID (PK)
- collaborators_email TEXT
- collaborators_password TEXT (hashed with bcrypt)
- collaborators_verified BOOLEAN
- ... (other collaborator fields)
```

## Testing

### Test Backfill
```bash
# Run backfill
curl -X POST http://localhost:3000/user-profiles/backfill

# Check results
curl http://localhost:3000/user-profiles
```

### Test Profile Viewing
1. Open browser at `http://localhost:3001/login`
2. Log in with merchant or collaborator credentials:
   - Merchant example: `owner@merchant.com` / `password123`
   - Collaborator example: `john@guide.com` / `password123`
3. Should redirect to `/profile` and show personal information
4. Check that login_count increments

### Test Admin Access
1. Log in with admin credentials
2. Should redirect to `/admin`
3. Navigate to `/admin/users` to see all users and their login statistics

## Important Notes

1. **Auth User Creation**: The backfill and approval workflows now automatically create Supabase Auth users with the passwords provided during registration. This means users can log in immediately after approval.

2. **Password Security**: Passwords are already hashed with bcrypt before being stored in `owner_password` and `collaborators_password`. They are used as-is when creating auth users.

3. **Error Handling**: If auth user creation fails, the error is logged but doesn't block the approval process. The user profile will be retried during next backfill.

4. **Email Confirmation**: Auth users are created with `email_confirm: true` to skip email verification, allowing immediate login after approval.

5. **Backward Compatibility**: The login page falls back to `/admin` if role detection fails, ensuring existing admin users can still access the system.

## Future Enhancements

- [ ] Email notifications when users are approved (see TODO comments in services)
- [ ] Password reset functionality
- [ ] User profile editing
- [ ] Admin ability to manually trigger backfill from UI
- [ ] Audit log for user activities
