# Manual User Creation Feature

## Overview
Added the ability to manually create users directly from the User Management page.

## How to Use

### From the UI (Admin Dashboard)

1. Navigate to **User Management** page at `/admin/users`
2. Click the **"+ Thêm Người Dùng"** (Add User) button in the top right
3. Fill in the form:
   - **Email**: User's email address (required)
   - **Password**: User's password, minimum 6 characters (required)
   - **Role**: Select from dropdown (required):
     - Quản Trị Viên (Admin)
     - Nhà Cung Cấp (Merchant)
     - Cộng Tác Viên (Collaborator)
4. Click **"Tạo Người Dùng"** (Create User) to submit
5. The user will be created and appear in the user list immediately

### API Endpoint

**POST** `/user-profiles/create`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "role": "merchant",
  "merchant_id": null,
  "collaborator_id": null
}
```

**Response:**
```json
{
  "id": "uuid",
  "user_id": "auth-user-uuid",
  "email": "user@example.com",
  "role": "merchant",
  "merchant_id": null,
  "collaborator_id": null,
  "login_count": 0,
  "created_at": "2025-12-31T...",
  "updated_at": "2025-12-31T..."
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/user-profiles/create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "securepass123",
    "role": "collaborator"
  }'
```

## What Happens Behind the Scenes

1. **Validation**: Zod schema validates the request (email format, password min 6 chars, valid role)
2. **Check Existing**: System checks if user profile already exists by email
3. **Create Auth User**: If no Supabase Auth user exists for the email:
   - Creates a new auth user with provided password
   - Sets `email_confirm: true` to skip email verification
4. **Create Profile**: Creates user_profile entry with:
   - `user_id` linked to auth user
   - Selected role
   - Initial `login_count` of 0
   - Auto-generated timestamps
5. **Return**: Returns the created user profile

## Important Notes

### For Merchants and Collaborators
- Users created manually will NOT have associated merchant or collaborator details
- `merchant_id` and `collaborator_id` will be null
- To create full merchant/collaborator accounts, use the onboarding pages:
  - Merchants: `/merchant/onboard`
  - Collaborators: `/collaborator/onboard`

### For Admins
- Admin users can be created directly with this feature
- They will have access to the admin dashboard immediately after creation

### Authentication
- User can log in immediately with the created email and password
- No email verification required (auto-confirmed)
- Password must be at least 6 characters

### Existing Users
- If email already exists in user_profiles: Updates the role
- If email exists in Supabase Auth but not profiles: Creates profile linked to existing auth user
- Prevents duplicate user_profiles for the same email

## Use Cases

### 1. Quick Admin Creation
Create admin users without going through the onboarding process:
```json
{
  "email": "admin@company.com",
  "password": "AdminPass123!",
  "role": "admin"
}
```

### 2. Test Account Creation
Quickly create test accounts for different roles:
```json
{
  "email": "test.merchant@test.com",
  "password": "test123",
  "role": "merchant"
}
```

### 3. Emergency Access
Create emergency access accounts when needed:
```json
{
  "email": "emergency@support.com",
  "password": "EmergencyPass456",
  "role": "admin"
}
```

## Security Considerations

1. **Password Hashing**: Passwords are hashed by Supabase Auth before storage
2. **Access Control**: TODO - Add role-based access control (change from @Public() to @Roles('admin'))
3. **Password Strength**: Currently requires minimum 6 characters (enforced by Zod validation)
4. **Email Validation**: Email format validated by Zod schema

## Future Enhancements

- [ ] Add role-based access control (only admins can create users)
- [ ] Add option to send welcome email to new user
- [ ] Add password strength indicator in UI
- [ ] Add ability to link merchant_id or collaborator_id during creation
- [ ] Add bulk user import feature
- [ ] Add option to require email verification
- [ ] Add audit log for user creation events

## Technical Implementation

### Backend Files Modified
- `backend/src/modules/user-profiles/user-profiles.controller.ts`
  - Added POST /create endpoint with validation

### Frontend Files Modified
- `frontend/app/admin/users/page.tsx`
  - Added state management for modal and form
  - Added modal UI component
  - Added form submission handler
  - Added styles for modal, buttons, form elements

### Dependencies
- Zod validation schema from `user-profiles.dto.ts`
- Supabase Auth admin API for user creation
- Existing `createOrUpdate` service method
