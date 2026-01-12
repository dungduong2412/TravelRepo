# Password Storage & Authentication Guide

## How Passwords Are Stored

The system uses **different password storage** for each user type:

### 1. **Collaborators**
- **Table**: `collaborators`
- **Password Column**: `collaborators_password`
- **Storage**: bcrypt hash (10 rounds)
- Created during collaborator signup

### 2. **Merchants**
- **Table**: `merchant_details`
- **Password Column**: `owner_password`
- **Storage**: bcrypt hash (10 rounds)
- Created during merchant signup

### 3. **Admin Users**
- **Table**: Supabase Auth (built-in)
- **Password Column**: Managed by Supabase Auth
- **Storage**: Supabase's secure password hashing
- Created via `create-admin.js` script

### 4. **User Profiles Table**
- **Table**: `user_profiles`
- **Password Column**: ❌ NO PASSWORD STORED HERE
- **Purpose**: Links email → role → specific user record
- Maps to collaborator_id, merchant_id, or user_id (for admin)

## Authentication Flow

### Login Process:
1. User enters email/password at `/login`
2. Backend looks up `user_profiles` table by email
3. Finds role (admin/merchant/collaborator)
4. Routes to appropriate login handler:
   - **Admin**: Uses Supabase Auth
   - **Merchant**: Checks `merchant_details.owner_password`
   - **Collaborator**: Checks `collaborators.collaborators_password`
5. Verifies password matches
6. Returns JWT token + user data

## Testing Admin Access

### Admin Credentials:
```
Email: admin@travelrepo.com
Password: admin123
```

### Access Points:
- **Login**: http://localhost:3001/login
- **Admin Dashboard**: http://localhost:3001/admin/dashboard

### Why Site Was Unreachable:
- Frontend server wasn't running on port 3001
- Both servers are now running:
  - Backend: http://localhost:3000 ✅
  - Frontend: http://localhost:3001 ✅

## Creating Additional Admin Users

Run this script:
```bash
cd /workspaces/TravelRepo/backend
node scripts/create-admin.js
```

This will:
1. Create Supabase Auth user
2. Create user_profiles entry with role='admin'
3. Return login credentials

## Database Schema Summary

```
user_profiles (links all users)
├── role: 'admin' → Supabase Auth password
├── role: 'merchant' → merchant_details.owner_password
└── role: 'collaborator' → collaborators.collaborators_password
```

## Security Notes

- All passwords are bcrypt hashed (except admin which uses Supabase's hashing)
- JWT tokens expire and require refresh
- Admin passwords should be changed after first login
- Service role key is only used server-side (backend)
