"use client";
import { Home, ClipboardList, ScanLine, Wallet, BarChart3, Store, Settings } from 'lucide-react';
import RoleDashboardShell from '../../../components/RoleDashboardShell';
const menu = [
  { label: 'Trang chủ', path: '/merchant/dashboard', icon: <Home /> },
  { label: 'Đơn hàng', shortLabel: 'Đơn', path: '/merchant/dashboard/orders', icon: <ClipboardList /> },
  { label: 'Quét QR', shortLabel: 'QR', path: '/merchant/dashboard/qr-scan', icon: <ScanLine /> },
  { label: 'Thanh toán', path: '/merchant/dashboard/payments', icon: <Wallet /> },
  { label: 'Báo cáo', path: '/merchant/dashboard/reports', icon: <BarChart3 /> },
  { label: 'Hồ sơ doanh nghiệp', shortLabel: 'Hồ sơ', path: '/merchant/dashboard/profile', icon: <Store /> },
  { label: 'Tài khoản', path: '/merchant/dashboard/settings', icon: <Settings /> },
];
export default function MerchantDashboardLayout({ children }: { children: React.ReactNode }) { return <RoleDashboardShell role="merchant" roleLabel="Nhà cung cấp" menu={menu}>{children}</RoleDashboardShell>; }
