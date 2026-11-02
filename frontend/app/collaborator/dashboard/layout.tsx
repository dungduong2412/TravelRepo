"use client";
import { Home, QrCode, Wallet, Users, UserRound, Settings } from 'lucide-react';
import RoleDashboardShell from '../../../components/RoleDashboardShell';
const menu = [
  { label: 'Trang chủ', path: '/collaborator/dashboard', icon: <Home /> },
  { label: 'Mã giới thiệu', shortLabel: 'Mã QR', path: '/collaborator/dashboard/qr-code', icon: <QrCode /> },
  { label: 'Hoa hồng', path: '/collaborator/dashboard/reports', icon: <Wallet /> },
  { label: 'Giới thiệu', path: '/collaborator/dashboard/members', icon: <Users /> },
  { label: 'Hồ sơ & ngân hàng', shortLabel: 'Hồ sơ', path: '/collaborator/dashboard/profile', icon: <UserRound /> },
  { label: 'Tài khoản', path: '/collaborator/dashboard/settings', icon: <Settings /> },
];
export default function CollaboratorDashboardLayout({ children }: { children: React.ReactNode }) { return <RoleDashboardShell role="collaborator" roleLabel="Đối tác" menu={menu}>{children}</RoleDashboardShell>; }
