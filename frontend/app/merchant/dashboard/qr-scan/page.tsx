"use client";

import { FormEvent, useState } from 'react';
import { apiFetch } from '../../../../lib/api';

type Result = { collaborator_code: string; collaborator_name: string; verified: boolean; status: string; association: string; idempotent: boolean; financial_action_created: boolean };

export default function MerchantQrScanPage() {
  const [payload, setPayload] = useState(''); const [result, setResult] = useState<Result | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function resolve(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); setResult(null); try { setResult(await apiFetch('/qr/resolve', { method: 'POST', body: JSON.stringify({ payload }) })); } catch (err: any) { setError(err.message || 'Mã không hợp lệ'); } finally { setBusy(false); } }
  return <div className="mx-auto max-w-2xl"><h1 className="text-2xl font-bold sm:text-3xl">Quét mã cộng tác viên</h1><p className="mt-2 text-slate-600">Xác minh mã giới thiệu trước khi đối chiếu giao dịch.</p>
    <div className="my-5 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">Thao tác này chỉ xác minh danh tính. Quét lặp lại là an toàn và không tạo đơn hàng, thanh toán hoặc hoa hồng.</div>
    <form onSubmit={resolve} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><label className="block text-sm font-semibold">Mã QR / mã cộng tác viên<input value={payload} onChange={(event) => setPayload(event.target.value)} autoCapitalize="characters" autoComplete="off" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base" placeholder="Nhập mã 8 ký tự hoặc nội dung QR" required /></label><button disabled={busy} className="mt-4 min-h-12 w-full rounded-xl bg-rose-600 px-5 font-semibold text-white disabled:opacity-60">{busy ? 'Đang xác minh…' : 'Xác minh mã'}</button></form>
    {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-4 text-rose-800">{error}</p>}
    {result && <section className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="font-bold text-emerald-900">Mã hợp lệ · {result.collaborator_code}</div><div className="mt-2 text-emerald-950">{result.collaborator_name}</div><dl className="mt-4 grid grid-cols-2 gap-2 text-sm"><dt>Trạng thái</dt><dd className="font-semibold">{result.status}</dd><dt>Liên kết</dt><dd className="font-semibold">{associationLabel(result.association)}</dd><dt>Tạo tài chính</dt><dd className="font-semibold">Không</dd></dl></section>}
  </div>;
}
function associationLabel(value: string) { return value === 'assigned_to_this_merchant' ? 'Thuộc merchant này' : value === 'assigned_elsewhere' ? 'Đã liên kết merchant khác' : 'Chưa liên kết merchant'; }
