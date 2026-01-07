# End-to-End Testing Guide

## System Overview
This guide covers complete end-to-end testing for all user roles: **Collaborator**, **Merchant**, and **Admin**.

## Prerequisites
- Backend running on `http://localhost:3000`
- Frontend running on `http://localhost:3001`
- Supabase database configured

---

## Testing Flow Summary

```
1. New Users Sign Up → 2. Admin Approves → 3. Users Login → 4. Access Dashboard
```

---

## 🧪 Test Scenario 1: Collaborator Complete Flow

### Step 1: Collaborator Signup
**URL**: `http://localhost:3001/collaborator/onboard`

**Actions**:
1. Fill in the form:
   - Name: "Test Collaborator"
   - Phone: "0901234567"
   - Email: "testcollaborator@example.com"
   - Bank Name: "Vietcombank"
   - Bank Account Name: "Test Collaborator"
   - Bank Account Number: "1234567890"
   - Password: "password123"
   - Confirm Password: "password123"

2. Click "Đăng Ký"

**Expected Results**:
- ✅ Redirect to success page
- ✅ Message: "Cảm ơn bạn đã đăng ký"
- ✅ Info: "Vui lòng đợi admin phê duyệt"
- ✅ Database: `collaborators` table has new record with `collaborators_verified=false`, `collaborators_status='pending'`

---

### Step 2: Admin Reviews and Approves
**URL**: `http://localhost:3001/admin/dashboard`

**Actions**:
1. Login as admin (if not already logged in)
2. Click "Pending Collaborators" card or navigate to "Quản Lý Collaborators"
3. Click "Pending" filter button
4. Find the new collaborator "Test Collaborator"
5. Click "✓ Phê Duyệt" button
6. Confirm approval

**Expected Results**:
- ✅ Status changes to "Active" (green badge)
- ✅ QR code generated automatically
- ✅ `user_profiles` table has new record with `role='collaborator'`
- ✅ Database: `collaborators_verified=true`, `collaborators_status='active'`
- ✅ Collaborator can now login

---

### Step 3: Collaborator Login
**URL**: `http://localhost:3001/login`

**Actions**:
1. Enter email: "testcollaborator@example.com"
2. Enter password: "password123"
3. Click "Đăng Nhập"

**Expected Results**:
- ✅ Auto-detected as collaborator
- ✅ Redirect to `/collaborator/dashboard`
- ✅ See dashboard with menu items

---

### Step 4: Collaborator Dashboard Features
**Base URL**: `http://localhost:3001/collaborator/dashboard`

#### 4A. Profile Management
**URL**: `/collaborator/dashboard/profile`

**Actions**:
1. View current profile information
2. Upload avatar (click "📷 Chọn Ảnh")
3. Update personal information
4. Update bank information
5. Click "Lưu Thay Đổi"

**Expected Results**:
- ✅ Avatar preview displays in circular format
- ✅ Success message: "✓ Cập nhật thành công!"
- ✅ Changes saved to database

#### 4B. QR Code Access
**URL**: `/collaborator/dashboard/qr-code`

**Actions**:
1. Navigate to "Mã QR" menu
2. View QR code
3. Click "📥 Tải Mã QR" to download

**Expected Results**:
- ✅ QR code displays with collaborator code
- ✅ Shows: Collaborator name, phone, organization
- ✅ Download saves PNG file: `QR_COL-XXXXXXXXXXXXXX.png`
- ✅ QR contains only collaborator_code string

---

## 🧪 Test Scenario 2: Merchant Complete Flow

### Step 1: Merchant Signup
**URL**: `http://localhost:3001/merchant/onboard`

**Actions**:
1. Fill in the form:
   - Business Name: "Test Restaurant"
   - Business Email: "testmerchant@example.com"
   - Business Phone: "0987654321"
   - Description: "A test restaurant"
   - Categories: Select 1-5 categories
   - Contact Phone: "0987654321"
   - City: "Ho Chi Minh City"
   - Ward: "District 1"
   - Address Line: "123 Test Street"
   - Commission Type: "Percentage"
   - Commission Value: "10"
   - Discount Type: "Percentage"
   - Discount Value: "5"
   - Owner Name: "Test Owner"
   - Owner Email: "owner@example.com"
   - Owner Phone: "0912345678"
   - Password: "password123"
   - Confirm Password: "password123"

2. Click "Đăng Ký"

**Expected Results**:
- ✅ Redirect to success page
- ✅ Message: "Cảm ơn bạn đã đăng ký"
- ✅ Database: `merchant_details` table has new record with `merchant_verified=false`, `merchants_status='pending'`
- ✅ `merchant_code` generated (format: MCH + 5 hex chars)

---

### Step 2: Admin Reviews and Approves
**URL**: `http://localhost:3001/admin/dashboard`

**Actions**:
1. Click "Pending Merchants" card or navigate to "Quản Lý Merchants"
2. Click "Pending" filter button
3. Find "Test Restaurant"
4. Click "✓ Phê Duyệt" button
5. Confirm approval

**Expected Results**:
- ✅ Status changes to "Active"
- ✅ `user_profiles` table has new record with `role='merchant'`
- ✅ Database: `merchant_verified=true`, `merchants_status='active'`
- ✅ Merchant can now login

---

### Step 3: Merchant Login
**URL**: `http://localhost:3001/login`

**Actions**:
1. Enter email: "owner@example.com" (owner email, not business email)
2. Enter password: "password123"
3. Click "Đăng Nhập"

**Expected Results**:
- ✅ Auto-detected as merchant
- ✅ Redirect to `/merchant/dashboard`
- ✅ Auto-redirect to `/merchant/dashboard/profile`

---

### Step 4: Merchant Profile Management
**URL**: `/merchant/dashboard/profile`

**Actions**:
1. View merchant information
2. Update business details
3. Change commission/discount settings
4. Update owner information
5. Click "Lưu Thay Đổi"

**Expected Results**:
- ✅ All merchant info displayed correctly
- ✅ Categories loaded from database
- ✅ Success message after save
- ✅ Changes persisted to database

---

## 🧪 Test Scenario 3: Admin Complete Flow

### Step 1: Admin Login
**URL**: `http://localhost:3001/login`

**Actions**:
1. Enter admin email
2. Enter admin password
3. Click "Đăng Nhập"

**Expected Results**:
- ✅ Auto-detected as admin
- ✅ Redirect to `/admin/dashboard`

---

### Step 2: Admin Dashboard Features

#### 2A. Dashboard Overview
**URL**: `/admin/dashboard`

**Expected Display**:
- ✅ Active Collaborators count (clickable)
- ✅ Pending Collaborators count (clickable)
- ✅ Active Merchants count (clickable)
- ✅ Pending Merchants count (clickable)
- ✅ Quick action buttons

---

#### 2B. Collaborators Management
**URL**: `/admin/collaborators`

**Actions**:
1. View all collaborators
2. Test filters: "All", "Active", "Pending"
3. Click on a collaborator to view details
4. Test approve/reject actions

**Expected Results**:
- ✅ Table shows all collaborator data
- ✅ Filters work correctly
- ✅ Modal shows detailed information
- ✅ Approve button only shows for pending
- ✅ Status badges color-coded

---

#### 2C. Merchants Management
**URL**: `/admin/merchants`

**Actions**:
1. View all merchants
2. Test filters: "All", "Active", "Pending"
3. Click on a merchant to view details
4. Test approve/reject actions

**Expected Results**:
- ✅ Table shows all merchant data
- ✅ Filters work correctly
- ✅ Modal shows detailed information
- ✅ Categories displayed correctly
- ✅ Approve button only shows for pending

---

#### 2D. User Management
**URL**: `/admin/users`

**Actions**:
1. View all user profiles
2. Test role filters: "All", "Admin", "Merchant", "Collaborator"
3. View login counts and timestamps

**Expected Results**:
- ✅ Shows all users from `user_profiles`
- ✅ Displays role, email, status
- ✅ Shows login tracking data
- ✅ Summary stats at top

---

#### 2E. Master Data - Categories
**URL**: `/admin/master-data/categories`

**Actions**:
1. View all categories
2. Click "Thêm Danh Mục Mới"
3. Fill in English and Vietnamese names
4. Save new category
5. Edit existing category
6. Delete a category

**Expected Results**:
- ✅ Categories listed with bilingual names
- ✅ Create form works
- ✅ Edit form pre-fills data
- ✅ Delete shows confirmation
- ✅ Status toggles (Active/Inactive)

---

#### 2F. Master Data - Organization Profile
**URL**: `/admin/master-data/organization`

**Actions**:
1. View organization profile
2. Click "Chỉnh Sửa"
3. Update organization name
4. Upload organization avatar (circular, max 10MB)
5. Update address, phone, email
6. Click "Lưu"

**Expected Results**:
- ✅ Single organization profile (only one allowed)
- ✅ Avatar displays in circular format
- ✅ Avatar upload supports up to 10MB
- ✅ All fields saved correctly
- ✅ Organization ID auto-generated (ORG-XXXXXXXX)

---

## 🔄 Cross-Role Testing Scenarios

### Scenario A: Rejection Flow

**Test Steps**:
1. New collaborator/merchant signs up
2. Admin clicks "✗ Từ Chối" instead of approve
3. Try to login with rejected account

**Expected Results**:
- ✅ Status changes to "Blocked" (red badge)
- ✅ No user_profile created
- ✅ Login fails with error message
- ✅ Database: `verified=false`, `status='blocked'`

---

### Scenario B: Multiple Role Testing

**Test Steps**:
1. Have 3 browser windows/tabs
2. Login as collaborator in tab 1
3. Login as merchant in tab 2
4. Login as admin in tab 3
5. Navigate between features in each role

**Expected Results**:
- ✅ Each role sees only their dashboard
- ✅ Menu items specific to each role
- ✅ No access to other role's features
- ✅ Sessions maintained independently

---

### Scenario C: QR Code Workflow

**Test Steps**:
1. Collaborator downloads QR code
2. Admin/Merchant scans QR code (using phone)
3. System resolves to collaborator profile

**Expected Results**:
- ✅ QR code contains only collaborator_code
- ✅ QR code is readable by standard scanners
- ✅ Code format: COL-XXXXXXXXXXXXXX (14 hex chars after COL-)
- ✅ Backend endpoint `/c/:qrToken` resolves correctly

---

## 📋 Database Verification Checklist

After each test scenario, verify in Supabase:

### Tables to Check:
- `collaborators`: New records, verified flags, status
- `merchant_details`: New records, verified flags, status
- `user_profiles`: Created on approval, role assigned, email matches
- `categories`: Used in merchant signup
- `organization_profile`: Single record, avatar stored

### Key Fields:
- `collaborators_verified` / `merchant_verified`: Should be `true` after approval
- `collaborators_status` / `merchants_status`: Should be `'active'` after approval
- `qr_code`: Generated automatically for collaborators (32 hex chars)
- `collaborators_code` / `merchant_code`: Auto-generated unique codes
- `collaborators_password` / `owner_password`: Bcrypt hashed
- `user_profiles.role`: Must match ('collaborator', 'merchant', 'admin')

---

## 🐛 Common Issues & Solutions

### Issue: Login fails after signup
**Solution**: Check if admin approved the account. Only approved accounts can login.

### Issue: "Email not found" error on login
**Solution**: Ensure account is approved and `user_profiles` entry exists.

### Issue: QR code shows "Internal Server Error"
**Solution**: Ensure collaborator is verified. QR generation requires verified status.

### Issue: Avatar upload fails
**Solution**: Check file size (max 10MB). Ensure file is an image type.

### Issue: Dashboard shows no data
**Solution**: Check localStorage for user data. Ensure user is logged in correctly.

### Issue: Validation errors on signup
**Solution**: Ensure all required fields filled. Password must be min 6 chars.

---

## ✅ Complete Test Checklist

### Pre-Testing Setup
- [ ] Backend running on port 3000
- [ ] Frontend running on port 3001
- [ ] Supabase credentials configured
- [ ] Database tables exist and are accessible
- [ ] At least one admin account exists

### Collaborator Tests
- [ ] Signup flow completes successfully
- [ ] Admin can see pending collaborator
- [ ] Admin approval creates user_profile
- [ ] Collaborator can login
- [ ] Collaborator dashboard loads
- [ ] Profile page displays correctly
- [ ] Avatar upload works
- [ ] QR code displays and downloads
- [ ] Profile updates save correctly

### Merchant Tests
- [ ] Signup flow completes successfully
- [ ] Categories load in signup form
- [ ] Admin can see pending merchant
- [ ] Admin approval creates user_profile
- [ ] Merchant can login
- [ ] Merchant dashboard loads
- [ ] Profile page displays all fields
- [ ] Profile updates save correctly

### Admin Tests
- [ ] Admin login works
- [ ] Dashboard statistics display
- [ ] Collaborators page shows all records
- [ ] Merchants page shows all records
- [ ] Users page shows all profiles
- [ ] Approve/Reject actions work
- [ ] Categories CRUD works
- [ ] Organization profile CRUD works
- [ ] Filters work on all list pages

### Integration Tests
- [ ] Rejected accounts cannot login
- [ ] Multiple users can be logged in simultaneously
- [ ] Auto-detection works for all roles
- [ ] QR codes are unique per collaborator
- [ ] Database constraints enforced

---

## 📊 Test Data Preparation

### Create Test Admin (if not exists)
```sql
-- Run in Supabase SQL Editor
INSERT INTO user_profiles (email, role, password)
VALUES ('admin@test.com', 'admin', '$2a$10$...');  -- Hash password with bcrypt
```

### Sample Test Accounts

| Role | Email | Password | Status |
|------|-------|----------|--------|
| Admin | admin@test.com | admin123 | Active |
| Collaborator | testctv01@gmail.com | 123456 | Pending → Active |
| Merchant | merchant@test.com | merchant123 | Pending → Active |

---

## 🎯 Success Criteria

The system is ready for production when:
- ✅ All 3 roles can sign up, get approved, and login
- ✅ All dashboard features work without errors
- ✅ Profile updates persist correctly
- ✅ QR codes generate and download successfully
- ✅ Admin can manage all users and master data
- ✅ Database integrity maintained (no orphaned records)
- ✅ Authentication works reliably
- ✅ File uploads (avatars) work up to 10MB

---

**Last Updated**: 2026-01-07  
**Version**: 1.0  
**Status**: Ready for Testing
