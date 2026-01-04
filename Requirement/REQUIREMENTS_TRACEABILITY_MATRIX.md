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
| REQ-004 | Admin approval flow | - | ⏳ | ⏳ | |

---

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
**Description**: Admin page to view and manage all user profiles. 

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
**Description**: There are 2 seperated section in the 

**Priority**: [High/Medium/Low]

**Acceptance Criteria**:
- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

**Implementation Status**: ⏳ Pending
- Files: 
- Endpoint: 

**Review Status**: ⏳ Pending
- Needs testing: 

**Notes**: 

---

## Template for New Requirements

```markdown
### REQ-XXX: [Requirement Title]
**Description**: [Detailed description of the requirement]

**Priority**: [High/Medium/Low]

**Acceptance Criteria**:
- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

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
