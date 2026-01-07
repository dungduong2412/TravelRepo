# Quick Start Guide - TravelRepo System

## 🚀 Start the System

### 1. Start Backend Server
```bash
cd /workspaces/TravelRepo/backend
npm run dev
```
**Expected**: Backend running on `http://localhost:3000`

### 2. Start Frontend Server (New Terminal)
```bash
cd /workspaces/TravelRepo/frontend
npm run dev
```
**Expected**: Frontend running on `http://localhost:3001`

---

## 🧪 Quick Test Flow

### Option 1: Test with Existing User
**URL**: `http://localhost:3001/login`

**Test Account**:
- Email: `testctv03@gmail.com`
- Password: `123456`
- Role: Collaborator (auto-detected)

**Expected**: Login → Redirect to `/collaborator/dashboard`

---

### Option 2: Complete New User Flow

#### Step 1: Sign Up as Collaborator
**URL**: `http://localhost:3001/collaborator/onboard`

Fill form and submit → Success page

#### Step 2: Login as Admin and Approve
**URL**: `http://localhost:3001/login`

Login as admin → Go to "Quản Lý Collaborators" → Click "Pending" → Approve new user

#### Step 3: Login as New Collaborator
**URL**: `http://localhost:3001/login`

Login with new credentials → Access dashboard

---

## 📋 Key URLs

| Page | URL | Access |
|------|-----|--------|
| Home | http://localhost:3001 | Public |
| Login | http://localhost:3001/login | Public |
| Collaborator Signup | http://localhost:3001/collaborator/onboard | Public |
| Merchant Signup | http://localhost:3001/merchant/onboard | Public |
| Admin Dashboard | http://localhost:3001/admin/dashboard | Admin only |
| Collaborator Dashboard | http://localhost:3001/collaborator/dashboard | Collaborator only |
| Merchant Dashboard | http://localhost:3001/merchant/dashboard | Merchant only |
| QR Code | http://localhost:3001/collaborator/dashboard/qr-code | Approved Collaborator |

---

## 🎯 Quick Feature Tests

### Test Avatar Upload
1. Login as collaborator or merchant
2. Go to Profile page
3. Click "📷 Chọn Ảnh"
4. Select image (max 10MB)
5. Click "Lưu Thay Đổi"

### Test QR Code
1. Login as approved collaborator
2. Navigate to "Mã QR" menu
3. View QR code
4. Click "📥 Tải Mã QR"

### Test Admin Approval
1. Create new collaborator account
2. Login as admin
3. Go to "Quản Lý Collaborators"
4. Click "Pending" filter
5. Click "✓ Phê Duyệt"

---

## 🔍 Verify Backend is Running

```bash
curl http://localhost:3000/categories
```
**Expected**: JSON response with categories

---

## 🛠️ Troubleshooting

### Backend won't start
```bash
# Kill any process on port 3000
lsof -ti:3000 | xargs kill -9

# Restart
cd /workspaces/TravelRepo/backend && npm run dev
```

### Frontend won't start
```bash
# Kill any process on port 3001
lsof -ti:3001 | xargs kill -9

# Restart
cd /workspaces/TravelRepo/frontend && npm run dev
```

### Check Environment Variables
```bash
# Backend
cat /workspaces/TravelRepo/.env

# Frontend
cat /workspaces/TravelRepo/frontend/.env.local
```

---

## 📖 Full Documentation

- **End-to-End Testing**: See [E2E_TESTING_GUIDE.md](E2E_TESTING_GUIDE.md)
- **Requirements**: See [REQUIREMENTS_TRACEABILITY_MATRIX.md](Requirement/REQUIREMENTS_TRACEABILITY_MATRIX.md)
- **Architecture**: See [ARCHITECTURE.md](ARCHITECTURE.md)
- **Development Guide**: See [.github/copilot-instructions.md](.github/copilot-instructions.md)

---

## ✅ System Health Check

Run these commands to verify system is ready:

```bash
# 1. Backend health
curl http://localhost:3000/categories

# 2. Frontend accessible
curl http://localhost:3001

# 3. Database connection (from backend)
cd /workspaces/TravelRepo/backend
node scripts/test-query.js
```

---

**Last Updated**: 2026-01-07  
**Status**: System Ready for Testing ✅
