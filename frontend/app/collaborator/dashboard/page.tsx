"use client";
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { PartnerQrCard } from '../../../components/PartnerQrCard';
import { PageHeader, Card } from '../../../components/ui/Brand';
import { Alert, Spinner } from '../../../components/ui/Feedback';

export default function CollaboratorDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([apiFetch('/collaborators/me'), apiFetch('/transactions/me/report?page=1&page_size=1')])
      .then(([collaborator, report]) => setData({ collaborator, report }))
      .catch((err) => setError(err.message || 'Không thể tải trang chủ'));
  }, []);
  if (error) return <Alert tone="danger" title="Không thể tải trang chủ">{error}</Alert>;
  if (!data) return <Spinner />;
  const { collaborator, report } = data;
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title={`Xin chào, ${collaborator.collaborators_name}`} subtitle={`Mã đối tác ${collaborator.collaborators_code}`} />
      <PartnerQrCard verified={collaborator.collaborators_verified === true} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Giao dịch" value={String(report.summary.transaction_count)} />
        <Metric label="Tổng chứng từ" value={money(report.summary.document_total)} />
        <Metric label="Tổng giảm giá" value={money(report.summary.document_discount_amount)} />
        <Metric label="Hoa hồng" value={money(report.summary.commission_amount)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Quick href="/collaborator/dashboard/reports" title="Hoa hồng" text="Lọc giao dịch và xem số liệu chính xác" />
        <Quick href="/collaborator/dashboard/profile" title="Hồ sơ & ảnh" text="Thông tin ngân hàng riêng tư và ảnh đại diện đã duyệt" />
      </div>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) { return <Card className="p-4"><div className="text-xs font-medium text-ink-muted">{label}</div><div className="mt-1 break-words text-lg font-bold">{value}</div></Card>; }
function Quick({ href, title, text }: { href: string; title: string; text: string }) {
  return <Link href={href} className="flex min-h-20 items-center justify-between gap-3 rounded-card border border-line bg-surface p-4 shadow-card hover:border-brand-500"><span><span className="block font-semibold">{title}</span><span className="mt-0.5 block text-sm text-ink-muted">{text}</span></span><ChevronRight aria-hidden="true" className="size-5 shrink-0 text-ink-muted" /></Link>;
}
function money(value: unknown) { return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 4 }).format(Number(value || 0))} ₫`; }
