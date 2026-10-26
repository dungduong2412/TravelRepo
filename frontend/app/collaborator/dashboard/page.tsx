"use client";
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
export default function CollaboratorDashboardPage() {
  const [data, setData] = useState<any>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { Promise.all([apiFetch('/collaborators/me'), apiFetch('/transactions/me/report?page=1&page_size=1')]).then(([collaborator, report]) => setData({ collaborator, report })).catch((err) => setError(err.message || 'Không thể tải trang chủ')); }, []);
  if (error) return <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-800">{error}</p>;
  if (!data) return <p className="text-slate-500">Đang tải…</p>;
  return <div><h1 className="text-2xl font-bold sm:text-3xl">Xin chào, {data.collaborator.collaborators_name}</h1><p className="mt-2 text-slate-600">Mã cộng tác viên · {data.collaborator.collaborators_code}</p>
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Giao dịch" value={String(data.report.summary.transaction_count)} /><Metric label="Tổng chứng từ" value={money(data.report.summary.document_total)} /><Metric label="Tổng giảm giá" value={money(data.report.summary.document_discount_amount)} /><Metric label="Hoa hồng" value={money(data.report.summary.commission_amount)} /></div>
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Quick href="/collaborator/dashboard/qr-code" title="Mã giới thiệu" text="Hiển thị hoặc tải QR chỉ chứa mã cộng tác viên" /><Quick href="/collaborator/dashboard/reports" title="Hoa hồng" text="Lọc giao dịch và xem số liệu chính xác" /><Quick href="/collaborator/dashboard/profile" title="Hồ sơ & ảnh" text="Thông tin ngân hàng riêng tư và avatar đã duyệt" /></div>
  </div>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5"><div className="text-sm text-slate-500">{label}</div><div className="mt-2 text-xl font-bold">{value}</div></div>; }
function Quick({ href, title, text }: { href: string; title: string; text: string }) { return <Link href={href} className="min-h-28 rounded-2xl border border-slate-200 bg-white p-5 hover:border-rose-300"><div className="font-bold text-rose-700">{title} →</div><div className="mt-2 text-sm text-slate-600">{text}</div></Link>; }
function money(value: unknown) { return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 4 }).format(Number(value || 0))} VND`; }
