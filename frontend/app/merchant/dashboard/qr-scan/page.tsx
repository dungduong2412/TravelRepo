"use client";

import { FormEvent, useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { fractionToPercentagePoints } from '../../../../lib/rates';

type QrResult = {
  collaborator_id: string;
  collaborator_code: string;
  collaborator_name: string;
  verified: boolean;
  status: string;
  association: 'assigned_to_this_merchant' | 'assigned_elsewhere' | 'unassigned';
  idempotent: boolean;
  financial_action_created: boolean;
};

type SimulationResult = {
  transaction_id: string;
  document_number: string;
  merchant_id: string;
  collaborator_id: string;
  gross_amount: string;
  discount_rate: string;
  discount_amount: string;
  commission_rate: string;
  commission_amount: string;
  simulation_status: 'OPEN';
  idempotent_replay: boolean;
  external_settlement_enabled: false;
};

export default function MerchantQrScanPage() {
  const [payload, setPayload] = useState('');
  const [result, setResult] = useState<QrResult | null>(null);
  const [grossAmount, setGrossAmount] = useState('');
  const [requestKey, setRequestKey] = useState('');
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function resolve(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null); setResult(null); setSimulation(null);
    try {
      const resolved = await apiFetch('/qr/resolve', { method: 'POST', body: JSON.stringify({ payload }) });
      setResult(resolved); setRequestKey(crypto.randomUUID());
    } catch (err: any) {
      setError(err.message || 'Mã không hợp lệ');
    } finally { setBusy(false); }
  }

  async function createSimulation(event: FormEvent) {
    event.preventDefault();
    if (!result || result.association !== 'assigned_to_this_merchant') return;
    setBusy(true); setError(null);
    try {
      setSimulation(await apiFetch('/transactions/simulation', {
        method: 'POST',
        body: JSON.stringify({ collaborator_code: result.collaborator_code, gross_amount: grossAmount, idempotency_key: requestKey }),
      }));
    } catch (err: any) {
      setError(err.message || 'Không thể ghi giao dịch mô phỏng');
    } finally { setBusy(false); }
  }

  function startAnother() { setGrossAmount(''); setSimulation(null); setRequestKey(crypto.randomUUID()); }
  const assigned = result?.association === 'assigned_to_this_merchant';

  return <div className="mx-auto max-w-2xl pb-24">
    <h1 className="text-2xl font-bold sm:text-3xl">Quét QR cộng tác viên</h1>
    <p className="mt-2 text-slate-600">Xác minh quan hệ trước khi ghi một giao dịch mô phỏng UAT.</p>
    <div className="my-5 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950"><strong>Chỉ dành cho UAT.</strong> Quy trình này không xác nhận thanh toán, không chuyển tiền, không trả hoa hồng và không sử dụng trạng thái PAID của V1.</div>

    <form onSubmit={resolve} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <label className="block text-sm font-semibold">Mã QR / mã cộng tác viên<input value={payload} onChange={(event) => setPayload(event.target.value)} autoCapitalize="characters" autoComplete="off" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base" placeholder="Quét hoặc nhập mã cộng tác viên" required /></label>
      <button disabled={busy} className="mt-4 min-h-12 w-full rounded-xl bg-rose-600 px-5 font-semibold text-white disabled:opacity-60">{busy ? 'Đang xác minh…' : 'Xác minh mã'}</button>
    </form>
    {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-4 text-rose-800">{error}</p>}

    {result && <section className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
      <div className="font-bold text-emerald-900">Mã hợp lệ · {result.collaborator_code}</div><div className="mt-2 text-emerald-950">{result.collaborator_name}</div>
      <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2 text-sm"><dt>Trạng thái</dt><dd className="break-words font-semibold">{result.status}</dd><dt>Liên kết</dt><dd className="break-words font-semibold">{associationLabel(result.association)}</dd><dt>Tạo tài chính khi quét</dt><dd className="font-semibold">Không</dd></dl>
      {!assigned && <p className="mt-4 rounded-lg bg-amber-100 p-3 text-sm text-amber-900">Không thể tạo mô phỏng: cộng tác viên chưa được gán đúng Merchant.</p>}
    </section>}

    {result && assigned && <form onSubmit={createSimulation} className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-lg font-bold">Ghi đơn hàng mô phỏng</h2><p className="mt-1 text-sm text-slate-600">Giảm giá và hoa hồng được máy chủ tính từ tổng tiền và tỷ lệ đã được Admin duyệt, chính xác đến 4 chữ số thập phân.</p>
      <label className="mt-4 block text-sm font-semibold">Tổng giá trị đơn hàng (VND)<input value={grossAmount} onChange={(event) => setGrossAmount(event.target.value)} inputMode="decimal" pattern="\d{1,14}(\.\d{1,4})?" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base" placeholder="Ví dụ: 1250000.0000" required /></label>
      <button disabled={busy || Boolean(simulation)} className="mt-4 min-h-12 w-full rounded-xl bg-violet-700 px-5 font-semibold text-white disabled:opacity-60">{simulation ? 'Đã ghi mô phỏng' : busy ? 'Đang ghi…' : 'Ghi giao dịch UAT'}</button><p className="mt-2 break-all text-xs text-slate-500">Khóa chống trùng: {requestKey}</p>
    </form>}

    {simulation && <section aria-live="polite" className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold text-violet-950">{simulation.document_number}</h2><span className="rounded-full bg-violet-200 px-3 py-1 text-xs font-bold text-violet-900">MÔ PHỎNG · {simulation.simulation_status}</span></div>
      <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2 text-sm"><dt>Tổng</dt><dd className="text-right font-semibold">{money(simulation.gross_amount)}</dd><dt>Giảm giá</dt><dd className="text-right">{rate(simulation.discount_rate)} · {money(simulation.discount_amount)}</dd><dt>Hoa hồng</dt><dd className="text-right">{rate(simulation.commission_rate)} · {money(simulation.commission_amount)}</dd><dt>Yêu cầu lặp lại</dt><dd className="text-right">{simulation.idempotent_replay ? 'Đã trả lại bản ghi cũ' : 'Bản ghi mới'}</dd><dt>Thanh toán bên ngoài</dt><dd className="text-right font-semibold">Tắt</dd></dl>
      <div className="mt-4 grid gap-2 sm:grid-cols-2"><a href="/merchant/dashboard/orders" className="min-h-12 rounded-xl bg-violet-700 px-4 py-3 text-center font-semibold text-white">Xem trong báo cáo</a><button type="button" onClick={startAnother} className="min-h-12 rounded-xl border border-violet-300 bg-white px-4 font-semibold text-violet-900">Tạo mô phỏng khác</button></div>
    </section>}
  </div>;
}

function associationLabel(value: QrResult['association']) { return value === 'assigned_to_this_merchant' ? 'Đúng Merchant' : value === 'assigned_elsewhere' ? 'Đã liên kết Merchant khác' : 'Chưa liên kết Merchant'; }
function rate(value: string) { return `${fractionToPercentagePoints(value)}%`; }
function money(value: string) { return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 4 }).format(Number(value))} VND`; }
