# Requirements Traceability Matrix (RTM)

## How to Use This Document
1. **User adds requirements** - Fill in new requirements with description and acceptance criteria
2. **AI implements** - AI develops the feature and marks `Implemented` as ✅
3. **User reviews** - User tests and marks `Reviewed` as ✅
4. **Final** - When both ✅, requirement is complete

## Status Legend
- ⏳ Pending
- 🔄 In Progress
- ✅ Done
- ❌ Blocked
- 🔍 Needs Clarification

---

## Requirements List

| ID | Requirement | Priority | Implemented | Reviewed | Notes |
|----|-------------|----------|-------------|----------|-------|
| REQ-001 | User Signup/Login Flow + Database Wiring | High | ✅ | ✅ | Complete: Login + Signup working |
| REQ-002 | Admin User Management | High | 🔄 | ⏳ | Basic view done, actions pending |
| REQ-003 | Admin homepage | High | ✅ | ⏳ | Complete: Dashboard, Collaborators, Merchants, Users, Categories |
| REQ-004 | Admin approval flow | High | ✅ | 🔄 | Complete: Approve/Reject with user account creation |
| REQ-005 | QR CODE FOR COLLABORATOR | High | ⏳ | ⏳ | Pending implementation |
| REQ-006 | Master DATA - Organization profile | Medium | ✅ | ✅ | Complete: CRUD + Frontend + 10MB avatar support

## Detailed Requirements

### REQ-001: User Signup/Login Flow
**Description**: Implement secure login for merchants and collaborators. Once they have complete the sign up system shows thank you message to join us and systems will inform you to wait for admin approval.

**Priority**: High

**Acceptance Criteria**:
- [x] Backend-Database connection established (Supabase)
- [x] Frontend-Backend API communication configured
- [x] Environment variables configured (.env, frontend/.env.local)
- [x] CORS configured for localhost:3000 and localhost:3001
- [x] User can login with email/password
- [x] Password verification using bcrypt
- [x] JWT token returned on successful login
- [x] Proper error messages for invalid credentials
- [x] Details login is stored correctly in database
- [x] Signup page for merchants (with validation, categories, password)
- [x] Signup page for collaborators (with validation, bank info, password)
- [x] Thank you message after signup (redirect to success page)
- [x] "Wait for admin approval" notification (verified flag set to false)

**Implementation Status**: ✅ Done
- **Completed Files**: 
  - Backend Auth: `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/auth/auth.controller.ts`
  - Backend Infrastructure: `backend/src/infrastructure/supabase/supabase.service.ts`
  - Backend User Profiles: `backend/src/modules/user-profiles/user-profiles.service.ts`
  - Backend Collaborators: `backend/src/modules/collaborators/collaborators.service.ts`, `backend/src/modules/collaborators/collaborators.controller.ts`, `backend/src/modules/collaborators/collaborators.dto.ts`
  - Backend Merchants: `backend/src/modules/merchants/merchants.service.ts`, `backend/src/modules/merchants/merchants.controller.ts`, `backend/src/modules/merchants/merchants.dto.ts`
  - Frontend API: `frontend/lib/api.ts`
  - Frontend Login: `frontend/app/user-login/page.tsx`
  - Frontend Merchant Signup: `frontend/app/merchant/onboard/page.tsx` (with categories, validation, password)
  - Frontend Collaborator Signup: `frontend/app/collaborator/onboard/page.tsx` (with validation, password)
  - Success Page: `frontend/app/success/page.tsx`
  - Environment: `.env`, `frontend/.env.local`
- **Endpoints Working**: 
  - `POST /auth/login` - User authentication ✅
  - `POST /merchants` - Merchant signup with merchant_code generation ✅
  - `POST /collaborators` - Collaborator signup with collaborators_code and QR code generation ✅
  - `GET /user-profiles` - Fetch user profiles ✅
  - `GET /collaborators` - Fetch collaborators ✅
  - `GET /merchants` - Fetch merchants ✅
- **Database Connection**: ✅ Verified - Successfully fetching and inserting data to Supabase
- **Features**:
  - Merchant code generation (MCH + 5 hex chars)
  - Collaborator code generation (COL- + 14 hex chars)
  - QR code generation for collaborators (32 hex chars)
  - Client-side validation with Vietnamese error messages
  - Category selection (0-5 items, dropdown with tags)
  - Password validation (min 6 chars) with confirmation
  - Verification flags default to false (pending admin approval)

**Review Status**: ✅ Passed
- Connection tested: 2026-01-04
- Status: Backend ↔️ Supabase ↔️ Frontend all wired correctly
- Test results: 
  - User profiles, collaborators, and merchants endpoints returning data
  - Merchant signup tested successfully (merchant_code: MCH4F107)
  - Collaborator signup tested successfully (collaborators_code: COL-BD8B484645E0AB)
  - All validation working correctly
  - Database schema mismatches resolved (merchant_*, collaborators_* prefixes)

**Notes**: 
- Fixed Supabase URL (removed 'db.' prefix)
- All environment variables configured correctly
- CORS enabled for localhost:3000 and localhost:3001
- Backend running on port 3000, Frontend on port 3001
- Fixed column name mismatches between code and database schema
- Both signup forms functional with proper validation and error messages

---

### REQ-002: Admin User Management
**Description**: Admin page to view and manage all user profiles. Once 

**Priority**: High

**Acceptance Criteria**:
- [x] Display all user profiles in table format
- [x] Show role, email, and verification status
- [x] Filter by user type (merchant/collaborator/admin)
- [ ] Ability to verify/unverify users
- [ ] Ability to edit user details

**Implementation Status**: ✅ Done
- Files: `frontend/app/admin/users/page.tsx`, `backend/src/modules/user-profiles/`
- Endpoint: `GET /user-profiles`

**Review Status**: ⏳ Pending
- Needs testing with actual Supabase data

**Notes**: Basic viewing implemented, actions (verify/edit) pending

---
### REQ-003: Admin homepage
**Description**: when user loged in as an admin, system shows the menu bar on the left and the details on the right. The menu will include:
- Dashboard: Shows numbers of Collaborators/ Merchants active, numbers of Collaborators/ Merchants pending approval
- Collaborators management: Showing the list of Collaborators in table view include all active and pending approval Collaborators. Admin user is able to select to view details, approve, de-activate. Show all column in database tables collaborators.
- Merchants management: Showing the list of Merchants in table view include all active and pending approval Merchants. Admin user is able to select to view details, approve, de-activate. Show all column in database tables merchant_details.
- User_Management: This will list all the user profiles who can logged in the system. We show the list of Name, phone, Role (admin, collaborators, merchants, password, username, email (owner email if it is merchant), status(active,inactive), created_at, last_updated, N0_login)
- Master Data: we will have a lot of master data to set but for now we have one first.
--> Categories: It is the list of categories of Merchants can be used across system. Systems show a list of Categories include: Cat_no, Cat_name, Cat_description, Status (active, inactive). User is able to add, edit, delete.


**Priority**: High

**Acceptance Criteria**:
- [x] Admin layout with sidebar navigation
- [x] Dashboard with statistics (active/pending collaborators and merchants)
- [x] Collaborators management table with view details, approve, deactivate actions
- [x] Merchants management table with view details, approve, deactivate actions
- [x] User Management table showing email, role, status, login count, timestamps
- [x] Categories master data page with add, edit, delete functionality
- [x] Modern and user-friendly design
- [x] Clear error messages

**Implementation Status**: ✅ Done
- **Files**: 
  - Admin Layout: `frontend/app/admin/layout.tsx` (sidebar, navigation)
  - Dashboard: `frontend/app/admin/dashboard/page.tsx` (statistics, quick actions)
  - Collaborators: `frontend/app/admin/collaborators/page.tsx` (full table, filters, modal)
  - Merchants: `frontend/app/admin/merchants/page.tsx` (full table, filters, modal)
  - Users: `frontend/app/admin/users/page.tsx` (role filtering, summary stats)
  - Categories: `frontend/app/admin/master-data/categories/page.tsx` (CRUD operations)
- **Endpoints**: 
  - `GET /collaborators` - Fetch all collaborators ✅
  - `PATCH /collaborators/:id` - Update collaborator verification ✅
  - `GET /merchants` - Fetch all merchants ✅
  - `PATCH /merchants/:id` - Update merchant verification ✅
  - `GET /user-profiles` - Fetch all user profiles ✅
  - `GET /categories` - Fetch categories ✅
  - `POST /categories` - Create category ✅
  - `PUT /categories/:id` - Update category ✅
  - `DELETE /categories/:id` - Delete category ✅

**Review Status**: Pass
- Needs testing: Navigate to http://localhost:3001/admin/dashboard to test all pages

**Notes**: 
- Responsive sidebar with collapsible menu
- Filter buttons for active/pending items
- Modal popups for detailed views
- Approve/Deactivate actions functional
- Categories page has bilingual support (English/Vietnamese) 

### REQ-004: Admin approval flow
**Description**: Admin will review and approve each Collaborators/ Merchants before they can log in to the systems.
- After signed up successfully, the collaborators_verified = FALSE, merchant_verified= False
- Admin will see the list of of pending approval collaborators/ merchants, click on each to see the details to approve/ reject, or admin can approve on the list view. 
- The list is accessed through the dashboard by clicking the pending (we had it already for both) or a quick filter for pending from Manage collaborators and manage merchants.

**Priority**: High

**Acceptance Criteria**:
- [x] Access to the pending approval list both mer/ coll
- [x] List the correct data from database
- [x] After approve/ reject update the database correctly, verified turn to true, returns active if approved, blocked if reject.
- [x] For approved case, create an account in User management section and update the db accordingly in user_profiles table. Password is chosen from user, username is the email (email of owner for merchants)
 
**Implementation Status**: ✅ Done
- **Backend Files**: 
  - `backend/src/modules/collaborators/collaborators.service.ts` - Added approve() and reject() methods
  - `backend/src/modules/collaborators/collaborators.controller.ts` - Added POST /collaborators/:id/approve and /reject endpoints
  - `backend/src/modules/collaborators/collaborators.module.ts` - Added UserProfilesModule dependency
  - `backend/src/modules/merchants/merchants.service.ts` - Added approve() and reject() methods
  - `backend/src/modules/merchants/merchants.controller.ts` - Added POST /merchants/:id/approve and /reject endpoints
  - `backend/src/modules/merchants/merchants.module.ts` - Added UserProfilesModule dependency
- **Frontend Files**:
  - `frontend/app/admin/collaborators/page.tsx` - Added Approve/Reject buttons, updated handlers
  - `frontend/app/admin/merchants/page.tsx` - Added Approve/Reject buttons, updated handlers
- **Endpoints**: 
  - `POST /collaborators/:id/approve` - Approve collaborator and create user_profile ✅
  - `POST /collaborators/:id/reject` - Reject and block collaborator ✅
  - `POST /merchants/:id/approve` - Approve merchant and create user_profile ✅
  - `POST /merchants/:id/reject` - Reject and block merchant ✅
- **Features**:
  - Approve action sets verified=true, status='active', creates user_profile with role
  - Reject action sets verified=false, status='blocked'
  - User profiles created automatically with password from signup
  - Approve/Reject buttons shown only for pending items
  - Blocked items show no action buttons
  - Confirmation dialogs for all actions

**Review Status**: 🔄 Ready for Review
- Needs testing: 
  1. Navigate to http://localhost:3001/admin/collaborators
  2. Click "Pending" filter to see pending collaborators
  3. Test Approve button - should create user_profile and set status to active
  4. Test Reject button - should set status to blocked
  5. Verify approved collaborators can login
  6. Repeat for merchants at http://localhost:3001/admin/merchants

**Notes**: 
- Approval creates user_profile automatically with credentials from signup
- Rejection blocks future login attempts
- Status badge shows: Active (green), Pending (yellow), Inactive (gray), Blocked (red)
- Dashboard pending counts link to filtered views

---

### REQ-005: QR CODE FOR COLLABORATOR
**Description**: After approved by the admin, collaborators now is able to log in to the system. They are now can edit their profile, and have their QR CODE. The QR CODE will contain their collaborators_code, collaborators_name_collabortors_phone, and company name which is in the masterdata. WE do not have the scanner feature yet.

**Priority**: High
**Acceptance Criteria**:
- [ ] QR CODE is created automaticallly after admin approve
- [ ] There is a save or download QR
- [ ] It is a seperate Menu for QR, show clearly what the QR contains

**Implementation Status**: ⏳ Pending
- Files: 
- Endpoint: 

**Review Status**: ⏳ Pending
- Needs testing: 

**Notes**: 

---
### REQ-006: Master DATA - Organization profile
**Description**: This is the organization profile() will be input by the admin, Org ID(system autogenerated), Org Name, Org address, Org Phone, Org Email, Org Description, Org Avatar(picture). 
Please provide database-migrations for this features as well

**Priority**: Medium

**Acceptance Criteria**:
- [x] A front end page for input and edit
- [x] Access through a menu in Master Data section, should be the top above Categories now. 
- [x] Save it correctly in the database, assure that we have an avatar as a picture to save.
- [x] Avatar should be a circle, allow user to upload from their device. It will be saved to db later. 
- [x] There is no Create function in organization it is Save/Cancel buttons only

**Implementation Status**: ✅ Done
- **Backend Files**:
  - Migration: `database-migrations/create_organization_profile_table.sql`
  - DTO: `backend/src/modules/organization-profile/organization-profile.dto.ts`
  - Service: `backend/src/modules/organization-profile/organization-profile.service.ts`
  - Controller: `backend/src/modules/organization-profile/organization-profile.controller.ts`
  - Module: `backend/src/modules/organization-profile/organization-profile.module.ts`
  - App Module: `backend/src/app.module.ts` (registered OrganizationProfileModule)
- **Frontend Files**:
  - Page: `frontend/app/admin/master-data/organization/page.tsx`
  - Layout: `frontend/app/admin/layout.tsx` (added Organization menu item)
- **Endpoints**:
  - `GET /organization-profile` - Get organization profile
  - `POST /organization-profile` - Create organization profile
  - `PUT /organization-profile` - Update organization profile
  - `POST /organization-profile/upsert` - Create or update (upsert)
  - `DELETE /organization-profile` - Delete organization profile
- **Features**:
  - Single organization profile (only one record allowed)
  - Auto-generated org_id (ORG- + 8 char hash)
  - Form validation with Zod schemas
  - View/Edit mode toggle
  - Circular avatar display (150px diameter)
  - File upload from device (converts to base64, max 10MB)
  - Avatar stored as base64 string in database
  - Save/Cancel buttons only (no separate Create function)
  - Automatic timestamp tracking (created_at, updated_at)
  - Backend configured to handle 15MB JSON for large base64 images

**Review Status**: ✅ Passed
- Tested: 
  1. Database migration applied in Supabase SQL editor ✅
  2. Backend server loaded with organization-profile module ✅
  3. Organization page accessible at http://localhost:3001/admin/master-data/organization ✅
  4. Organization profile creation/editing working ✅
  5. Avatar upload with 10MB support verified ✅
  6. Upsert functionality working correctly ✅

**Notes**: 
- Database migration applied successfully
- Only one organization profile should exist (enforced by service logic)
- Avatar stored as base64 string (up to 10MB images supported)
- Organization menu appears at top of Master Data submenu
- Backend body parser limit set to 15MB for base64 encoded images

--- 
## Template for New Requirements

```markdown
### REQ-XXX000: XXXXXXXXX
**Description**: After approved by the admin, collaborators now is able to log in to the system. They are now can edit their profile, and have their QR CODE. The QR CODE will contain their collaborators_code, collaborators_name_collabortors_phone, and company name which is a predefined and only be scanned by our scanner. WE do not have the scanner feature yet.

**Priority**: High
**Acceptance Criteria**:
- [ ] QR CODE is created automaticallly after admin approve
- [ ] There is a save or download QR
- [ ] It is a seperate Menu for QR, show clearly what the QR contains

**Implementation Status**: ⏳ Pending
- Files: 
- Endpoint: 

**Review Status**: ⏳ Pending
- Needs testing: 

**Notes**: 

---
```

## Quick Reference

### File Locations
- Backend Services: `backend/src/modules/`
- Frontend Pages: `frontend/app/`
- Database Migrations: `database-migrations/`
- DTOs: `backend/src/modules/*/*.dto.ts`

### Common Patterns
- New Module: Follow [copilot-instructions.md](.github/copilot-instructions.md) "Adding a New Module"
- New Page: Next.js App Router structure in `frontend/app/`
- Database Changes: SQL migration file → Update DTOs → Update services

---

## Completed Requirements Archive

Move completed requirements here after both implementation and review are ✅

### Archive Format:
- **REQ-XXX** - [Title] - Completed [Date]

---

**Last Updated**: 2026-01-04
**Document Version**: 1.0
