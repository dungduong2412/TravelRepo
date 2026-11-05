"use client";
import { Home, ClipboardList, ScanLine, Wallet, BarChart3, Store, Settings, PlusCircle } from 'lucide-react';
import RoleDashboardShell from '../../../components/RoleDashboardShell';
const menu = [
  { label: 'Trang chủ', path: '/merchant/dashboard', icon: <Home /> },
  { label: 'Giao dịch mới', shortLabel: 'Mới', path: '/merchant/dashboard/new-transaction', icon: <PlusCircle /> },
  { label: 'Đơn hàng', shortLabel: 'Đơn', path: '/merchant/dashboard/orders', icon: <ClipboardList /> },
  { label: 'Quét QR (UAT)', shortLabel: 'UAT', path: '/merchant/dashboard/qr-scan', icon: <ScanLine /> },
  { label: 'Thanh toán', path: '/merchant/dashboard/payments', icon: <Wallet /> },
  { label: 'Báo cáo', path: '/merchant/dashboard/reports', icon: <BarChart3 /> },
  { label: 'Hồ sơ doanh nghiệp', shortLabel: 'Hồ sơ', path: '/merchant/dashboard/profile', icon: <Store /> },
  { label: 'Tài khoản', path: '/merchant/dashboard/settings', icon: <Settings /> },
];
export default function MerchantDashboardLayout({ children }: { children: React.ReactNode }) { return <RoleDashboardShell role="merchant" roleLabel="Nhà cung cấp" menu={menu}>{children}</RoleDashboardShell>; }
