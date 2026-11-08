"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { PageHeader, Card } from '../../../components/ui/Brand';
import { ErrorState, Spinner } from '../../../components/ui/Feedback';
import { PENDING_LABEL } from '../../../lib/status-labels';

interface DashboardStats {
  activeCollaborators: number;
  pendingCollaborators: number;
  activeMerchants: number;
  pendingMerchants: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    activeCollaborators: 0,
    pendingCollaborators: 0,
    activeMerchants: 0,
    pendingMerchants: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const [collaborators, merchants] = await Promise.all([
        api.get('/collaborators'),
        api.get('/merchants'),
      ]);

      const collaboratorStatus = (item: any) =>
        item.collaborators_status?.toLowerCase() ||
        (item.collaborators_verified ? 'active' : 'pending');
      const merchantStatus = (item: any) =>
        item.merchants_status?.toLowerCase() ||
        (item.merchant_verified ? 'active' : 'pending');

      // Calculate statistics
      setStats({
        activeCollaborators: collaborators.filter((c: any) => collaboratorStatus(c) === 'active').length,
        pendingCollaborators: collaborators.filter((c: any) => collaboratorStatus(c) === 'pending').length,
        activeMerchants: merchants.filter((m: any) => merchantStatus(m) === 'active').length,
        pendingMerchants: merchants.filter((m: any) => merchantStatus(m) === 'pending').length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorState title="Không thể tải thống kê" onRetry={fetchStats}>{error}</ErrorState>;

  const tiles = [
    { label: 'Partner đang hoạt động', value: stats.activeCollaborators, href: '/admin/collaborators' },
    { label: `Partner ${PENDING_LABEL.toLowerCase()}`, value: stats.pendingCollaborators, href: '/admin/collaborators', attention: stats.pendingCollaborators > 0 },
    { label: 'Merchant đang hoạt động', value: stats.activeMerchants, href: '/admin/merchants' },
    { label: `Merchant ${PENDING_LABEL.toLowerCase()}`, value: stats.pendingMerchants, href: '/admin/merchants', attention: stats.pendingMerchants > 0 },
  ];
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Tổng quan" subtitle="Số lượng hồ sơ theo trạng thái. Nhấn vào một ô để xử lý." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="block rounded-card focus-visible:outline-offset-2">
            <Card className={`h-full p-4 transition hover:border-brand-500 ${t.attention ? 'border-warning-700/40 bg-warning-50' : ''}`}>
              <div className="text-xs font-medium text-ink-muted">{t.label}</div>
              <div className="mt-1 text-3xl font-extrabold tabular-nums" data-testid="admin-stat">{t.value}</div>
            </Card>
          </Link>
        ))}
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[['/admin/media-approvals', 'Duyệt hình ảnh'], ['/admin/financials', 'Tài chính'], ['/admin/users', 'Người dùng']].map(([href, label]) => (
          <Link key={href} href={href} className="flex min-h-14 items-center justify-between rounded-card border border-line bg-surface px-4 font-semibold shadow-card hover:border-brand-500">{label}<span aria-hidden="true">→</span></Link>
        ))}
      </div>
    </div>
  );
}
