"use client";
import RoleDashboardShell from '../../../components/RoleDashboardShell';
const menu = [
  { label: 'Trang chủ', path: '/merchant/dashboard', icon: '⌂' },
  { label: 'Đơn hàng', shortLabel: 'Đơn', path: '/merchant/dashboard/orders', icon: '▤' },
  { label: 'QR Scan', shortLabel: 'QR', path: '/merchant/dashboard/qr-scan', icon: '▦' },
  { label: 'Thanh toán', path: '/merchant/dashboard/payments', icon: '₫' },
  { label: 'Báo cáo', path: '/merchant/dashboard/reports', icon: '▥' },
  { label: 'Hồ sơ doanh nghiệp', shortLabel: 'Hồ sơ', path: '/merchant/dashboard/profile', icon: '●' },
  { label: 'Tài khoản', path: '/merchant/dashboard/settings', icon: '⚙' },
];
export default function MerchantDashboardLayout({ children }: { children: React.ReactNode }) { return <RoleDashboardShell role="merchant" roleLabel="Nhà cung cấp" menu={menu}>{children}</RoleDashboardShell>; }
