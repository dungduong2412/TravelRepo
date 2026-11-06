"use client";

import { FormEvent, useState } from "react";
import { apiFetch } from "../../../../lib/api";
import { fractionToPercentagePoints } from "../../../../lib/rates";
import QrCameraScanner from "../../../../components/QrCameraScanner";

type QrResult = {
  collaborator_id: string;
  collaborator_code: string;
  collaborator_name: string;
  verified: boolean;
  status: string;
  association: "assigned_to_this_merchant" | "assigned_elsewhere" | "unassigned";
};

type TransactionResult = {
  transaction_id: string;
  document_number: string;
  merchant_id: string;
  collaborator_id: string;
  gross_amount: string;
  discount_rate: string;
  discount_amount: string;
  commission_rate: string;
  commission_amount: string;
  lifecycle_status: "recorded" | "confirmed" | "cancelled";
  idempotent_replay: boolean;
};

type ActionResult = {
  transaction_id: string;
  lifecycle_status: string;
  idempotent_replay: boolean;
};

type InputMode = "camera" | "manual";

export default function MerchantNewTransactionPage() {
  const [inputMode, setInputMode] = useState<InputMode>("camera");
  const [payload, setPayload] = useState("");
  const [qrResult, setQrResult] = useState<QrResult | null>(null);
  const [grossAmount, setGrossAmount] = useState("");
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  const [transaction, setTransaction] = useState<TransactionResult | null>(null);
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function resolvePartner(code: string) {
    setBusy(true); setError(null); setQrResult(null); setTransaction(null); setActionResult(null);
    try {
      const resolved = await apiFetch("/qr/resolve", { method: "POST", body: JSON.stringify({ payload: code }) });
      setQrResult(resolved);
    } catch (err: any) {
      setError(err.message || "Không thể xác minh mã QR");
    } finally { setBusy(false); }
  }

  // Called when camera successfully decodes a QR code
  function handleCameraScan(decoded: string) {
    resolvePartner(decoded);
  }

  // Called when merchant submits the manual text form
  async function handleManualResolve(event: FormEvent) {
    event.preventDefault();
    if (payload.trim()) resolvePartner(payload.trim());
  }

  async function createTransaction(event: FormEvent) {
    event.preventDefault();
    if (!qrResult || qrResult.association !== "assigned_to_this_merchant") return;
    setBusy(true); setError(null);
    try {
      setTransaction(await apiFetch("/transactions/real", {
        method: "POST",
        body: JSON.stringify({ collaborator_code: qrResult.collaborator_code, gross_amount: grossAmount, idempotency_key: createKey }),
      }));
    } catch (err: any) {
      setError(err.message || "Không thể tạo giao dịch");
    } finally { setBusy(false); }
  }

  async function confirmTransaction() {
    if (!transaction) return;
    setBusy(true); setError(null);
    try {
      setActionResult(await apiFetch(`/transactions/${transaction.transaction_id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ idempotency_key: crypto.randomUUID() }),
      }));
    } catch (err: any) {
      setError(err.message || "Không thể xác nhận giao dịch");
    } finally { setBusy(false); }
  }

  async function cancelTransaction() {
    if (!transaction) return;
    setBusy(true); setError(null);
    try {
      setActionResult(await apiFetch(`/transactions/${transaction.transaction_id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ idempotency_key: crypto.randomUUID() }),
      }));
    } catch (err: any) {
      setError(err.message || "Không thể huỷ giao dịch");
    } finally { setBusy(false); }
  }

  function startAnother() {
    setPayload(""); setQrResult(null); setGrossAmount("");
    setCreateKey(crypto.randomUUID()); setTransaction(null); setActionResult(null); setError(null);
  }

  const assigned = qrResult?.association === "assigned_to_this_merchant";
  const finalStatus = actionResult?.lifecycle_status ?? transaction?.lifecycle_status;

  return (
    <div className="mx-auto max-w-2xl pb-24">
      <h1 className="text-2xl font-bold sm:text-3xl">Giao dịch mới</h1>
      <p className="mt-2 text-slate-600">Quét mã QR của Đối tác, nhập giá trị hoá đơn, rồi xác nhận để ghi nhận hoa hồng.</p>

      {/* Step 1 — scan / enter partner QR */}
      {!transaction && !qrResult && (
        <>
          {/* Mode tabs */}
          <div className="mt-5 flex rounded-xl border border-slate-200 bg-slate-50 p-1 gap-1">
            <button
              type="button"
              onClick={() => setInputMode("camera")}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${inputMode === "camera" ? "bg-white shadow text-slate-900" : "text-slate-500"}`}
            >
              📷 Quét camera
            </button>
            <button
              type="button"
              onClick={() => setInputMode("manual")}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${inputMode === "manual" ? "bg-white shadow text-slate-900" : "text-slate-500"}`}
            >
              ⌨️ Nhập thủ công
            </button>
          </div>

          {inputMode === "camera" && (
            <div className="mt-3">
              <QrCameraScanner onDecode={handleCameraScan} />
            </div>
          )}

          {inputMode === "manual" && (
            <form onSubmit={handleManualResolve} className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <label className="block text-sm font-semibold">
                Mã đối tác hoặc URL QR
                <input
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  autoCapitalize="characters"
                  autoComplete="off"
                  className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base"
                  placeholder="COL-… hoặc dán URL từ mã QR"
                  required
                />
              </label>
              <button disabled={busy} className="mt-4 min-h-12 w-full rounded-xl bg-slate-800 px-5 font-semibold text-white disabled:opacity-60">
                {busy ? "Đang xác minh…" : "Xác minh đối tác"}
              </button>
            </form>
          )}
        </>
      )}

      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-4 text-rose-800">{error}</p>}

      {/* Step 1 result — partner verified */}
      {qrResult && !transaction && (
        <section className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5">
          <div className="font-bold text-emerald-900">{qrResult.collaborator_name || qrResult.collaborator_code}</div>
          <div className="mt-1 font-mono text-sm text-emerald-800">{qrResult.collaborator_code}</div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-emerald-700">Liên kết</dt>
            <dd className="font-semibold text-emerald-900">{associationLabel(qrResult.association)}</dd>
          </dl>
          {!assigned && (
            <p className="mt-3 rounded-lg bg-amber-100 p-3 text-sm text-amber-900">Đối tác chưa được gán cho cửa hàng này. Không thể tạo giao dịch.</p>
          )}
          <button
            type="button"
            onClick={startAnother}
            className="mt-3 text-sm text-emerald-700 underline underline-offset-2"
          >
            Quét lại
          </button>
        </section>
      )}

      {/* Step 2 — enter gross amount */}
      {qrResult && assigned && !transaction && (
        <form onSubmit={createTransaction} className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-lg font-bold">Nhập giá trị hoá đơn</h2>
          <p className="mt-1 text-sm text-slate-600">
            Giảm giá cho Khách hàng và hoa hồng cho Đối tác được tính từ tỷ lệ cấu hình của cửa hàng.
          </p>
          <label className="mt-4 block text-sm font-semibold">
            Tổng giá trị (VND)
            <input
              value={grossAmount}
              onChange={(e) => setGrossAmount(e.target.value)}
              inputMode="decimal"
              pattern="\d{1,14}(\.\d{1,4})?"
              className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base"
              placeholder="Ví dụ: 1250000"
              required
            />
          </label>
          <button disabled={busy} className="mt-4 min-h-12 w-full rounded-xl bg-violet-700 px-5 font-semibold text-white disabled:opacity-60">
            {busy ? "Đang tạo…" : "Tạo giao dịch"}
          </button>
          <p className="mt-2 break-all text-xs text-slate-400">Khóa chống trùng: {createKey}</p>
        </form>
      )}

      {/* Step 3 — confirm / cancel */}
      {transaction && (
        <section aria-live="polite" className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-violet-950">{transaction.document_number}</h2>
            <StatusBadge status={finalStatus ?? "recorded"} />
          </div>
          <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2 text-sm">
            <dt>Tổng hoá đơn</dt>    <dd className="text-right font-semibold">{money(transaction.gross_amount)}</dd>
            <dt>Giảm giá KH</dt>     <dd className="text-right">{rate(transaction.discount_rate)} · {money(transaction.discount_amount)}</dd>
            <dt>Hoa hồng ĐT</dt>     <dd className="text-right">{rate(transaction.commission_rate)} · {money(transaction.commission_amount)}</dd>
          </dl>

          {(finalStatus === "confirmed" || finalStatus === "cancelled" || finalStatus === "reversed") ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <a href="/merchant/dashboard/orders" className="min-h-12 rounded-xl bg-violet-700 px-4 py-3 text-center font-semibold text-white">
                Xem trong báo cáo
              </a>
              <button type="button" onClick={startAnother} className="min-h-12 rounded-xl border border-violet-300 bg-white px-4 font-semibold text-violet-900">
                Giao dịch mới
              </button>
            </div>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={confirmTransaction}
                disabled={busy}
                className="min-h-12 rounded-xl bg-emerald-600 px-4 font-semibold text-white disabled:opacity-60"
              >
                {busy ? "Đang xử lý…" : "Xác nhận giao dịch"}
              </button>
              <button
                type="button"
                onClick={cancelTransaction}
                disabled={busy}
                className="min-h-12 rounded-xl border border-rose-300 bg-white px-4 font-semibold text-rose-700 disabled:opacity-60"
              >
                Huỷ giao dịch
              </button>
            </div>
          )}

          {actionResult?.idempotent_replay && (
            <p className="mt-2 text-xs text-slate-500">Trạng thái đã được ghi nhận trước đó (idempotent replay).</p>
          )}
        </section>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    recorded: "bg-amber-100 text-amber-900",
    confirmed: "bg-emerald-100 text-emerald-900",
    cancelled: "bg-slate-100 text-slate-700",
    reversed: "bg-rose-100 text-rose-900",
  };
  const label: Record<string, string> = {
    recorded: "Đã ghi nhận",
    confirmed: "Đã xác nhận",
    cancelled: "Đã huỷ",
    reversed: "Đã hoàn trả",
  };
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${map[status] ?? "bg-slate-100 text-slate-700"}`}>
      {label[status] ?? status}
    </span>
  );
}

function associationLabel(a: QrResult["association"]) {
  return a === "assigned_to_this_merchant" ? "Đúng cửa hàng" : a === "assigned_elsewhere" ? "Cửa hàng khác" : "Chưa liên kết";
}
function rate(value: string) { return `${fractionToPercentagePoints(value)}%`; }
function money(value: string) { return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(value))} VND`; }
