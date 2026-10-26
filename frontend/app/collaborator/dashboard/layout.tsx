"use client";
import RoleDashboardShell from '../../../components/RoleDashboardShell';
const menu = [
  { label: 'Trang chủ', path: '/collaborator/dashboard', icon: '⌂' },
  { label: 'Mã giới thiệu', shortLabel: 'Mã QR', path: '/collaborator/dashboard/qr-code', icon: '▦' },
  { label: 'Hoa hồng', path: '/collaborator/dashboard/reports', icon: '₫' },
  { label: 'Giới thiệu', path: '/collaborator/dashboard/members', icon: '♙' },
  { label: 'Hồ sơ & ngân hàng', shortLabel: 'Hồ sơ', path: '/collaborator/dashboard/profile', icon: '●' },
  { label: 'Tài khoản', path: '/collaborator/dashboard/settings', icon: '⚙' },
];
export default function CollaboratorDashboardLayout({ children }: { children: React.ReactNode }) { return <RoleDashboardShell role="collaborator" roleLabel="Cộng tác viên" menu={menu}>{children}</RoleDashboardShell>; }
