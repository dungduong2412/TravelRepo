"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, CheckCircle2, ScanLine, Tag, UserRound } from "lucide-react";
import { apiFetch, ApiRequestError } from "../../../../lib/api";
import QrScanner, { ScanSource } from "../../../../components/QrScanner";
import { parsePartnerQrPayload } from "../../../../lib/qr/payload";
import { logQrEvent, newScanId, safeToken } from "../../../../lib/qr/diagnostics";
import { formatRate, formatVnd } from "../../../../lib/qr/money";

type Discount = { available: boolean; kind: "percentage" | null; rate: string | null; label: string | null; reason?: "no_discount" | "rate_not_reviewed" };
/** Can THIS Merchant record a transaction? false = its commission policy is not configured/reviewed (an explicit business-rule answer from the server). */
type PaymentReadiness = { available: boolean; reason?: string; message?: string };
type Resolved = {
  collaborator_code: string;
  partner: { id: string; code: string; name: string; avatar_url: string | null; verified: boolean; status: string };
  discount: Discount;
  payment: PaymentReadiness;
  /** the walk-in event this scan recorded; a transaction made from this scan links to it */
  scan: { id: string | null; counted: boolean; duplicate: boolean };
};
type Preview = { partner: { code: string; name: string }; gross_amount: string; discount_rate: string; discount_amount: string; final_payable: string; commission_rate: string; commission_amount: string };
type Created = { transaction_id: string; document_number: string; lifecycle_status: string; gross_amount: string; discount_amount: string; commission_amount: string; idempotent_replay: boolean };
type Receipt = {
  transaction_id: string; document_number: string; issued_at: string; lifecycle_status: string; partner: { code: string | null; name: string | null }; merchant: { code: string | null; name: string | null };
  gross_amount: string; discount_rate: string; discount_amount: string; final_payable: string; commission_rate: string; commission_amount: string; events: Array<{ type: string; at: string }>;
};
type Stage = "scan" | "result" | "payment" | "receipt";
type Notice = { title: string; body: string };

const AMOUNT = /^\d{1,14}(\.\d{1,4})?$/;
const KEYS = "vno-pay-keys-v1";
/** Idempotency keys survive a reload for the SAME Partner + amount, so re-entering the payment replays the same transaction instead of creating a second one. */
function keysFor(code: string, gross: string): { create: string; confirm: string } {
  const id = `${code}|${gross}`; const now = Date.now();
  try {
    const all = JSON.parse(sessionStorage.getItem(KEYS) || "{}") as Record<string, { create: string; confirm: string; at: number }>;
    for (const k of Object.keys(all)) if (now - all[k].at > 30 * 60_000) delete all[k];
    if (!all[id]) all[id] = { create: crypto.randomUUID(), confirm: crypto.randomUUID(), at: now };
    sessionStorage.setItem(KEYS, JSON.stringify(all));
    return { create: all[id].create, confirm: all[id].confirm };
  } catch { return { create: crypto.randomUUID(), confirm: crypto.randomUUID() }; }
}
function forgetKeys(code: string, gross: string) {
  try { const all = JSON.parse(sessionStorage.getItem(KEYS) || "{}"); delete all[`${code}|${gross}`]; sessionStorage.setItem(KEYS, JSON.stringify(all)); } catch { /* storage unavailable */ }
}

const SCAN_ERRORS: Record<string, string> = {
  QR_UNSUPPORTED: "Mã QR không hợp lệ",
  PARTNER_NOT_FOUND: "Không tìm thấy Đối tác",
  PARTNER_NOT_ACTIVE: "Đối tác chưa hoạt động",
  MERCHANT_NOT_ACTIVE: "Cửa hàng chưa được duyệt",
  MERCHANT_REQUIRED: "Chỉ dành cho nhà cung cấp",
  QR_RATE_LIMITED: "Quét quá nhanh",
  QR_UNAVAILABLE: "Chưa tra cứu được lúc này",
};
const apiCode = (err: unknown) => (err instanceof ApiRequestError ? err.apiCode : undefined);
const apiMessage = (err: unknown, fallback: string) => (err instanceof Error && err.message && !/^API request failed/i.test(err.message) ? err.message : fallback);

export default function MerchantQrPaymentPage() {
  const [stage, setStage] = useState<Stage>("scan");
  const [tab, setTab] = useState<"scan" | "manual">("scan");
  const [scanKey, setScanKey] = useState(0);
  const [scanId, setScanId] = useState(() => newScanId());
  const [manual, setManual] = useState("");
  const [resolving, setResolving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);

  const [gross, setGross] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const submitting = useRef(false);
  const resolvingRef = useRef(false);
  const previewSeq = useRef(0);
  const keys = useRef<{ create: string; confirm: string } | null>(null);
  /** One id per scan attempt: a retry or a repeated detection of the SAME scan is counted once as a walk-in; a new scan gets a new id. */
  const scanUuid = useRef(crypto.randomUUID());

  /** Scan (or type, or upload) -> look the Partner up. Read-only: nothing is created. */
  const resolve = useCallback(async (payload: string, source: ScanSource | "manual") => {
    if (resolvingRef.current) return;                       // a second detection of the same code while the first is being looked up
    setNotice(null);
    const local = parsePartnerQrPayload(payload);
    if (local.ok !== true) {
      logQrEvent(scanId, "resolve_error", { source, code: "QR_UNSUPPORTED" });
      setNotice({ title: SCAN_ERRORS.QR_UNSUPPORTED, body: local.reason === "empty" ? "Chưa có nội dung. Hãy quét hoặc nhập mã của Đối tác." : "Mã QR này không phải mã Đối tác của VNO. Hãy quét đúng mã QR trong Cổng Đối tác, hoặc nhập mã có dạng COL-…." });
      setScanKey((k) => k + 1); return;
    }
    resolvingRef.current = true; setResolving(true);
    try {
      const r = (await apiFetch("/qr/resolve", { method: "POST", body: JSON.stringify({ payload, scan_id: scanUuid.current, source }) })) as Resolved;
      logQrEvent(scanId, "resolve_ok", { source });
      setResolved(r); setStage("result");
    } catch (err) {
      const code = apiCode(err) ?? "";
      logQrEvent(scanId, "resolve_error", { source, code: /^[A-Z_]{1,40}$/.test(code) ? code : undefined, err: safeToken(code ? undefined : (err as Error)?.name) });
      setNotice({
        title: SCAN_ERRORS[code] ?? "Không thể tra cứu mã QR",
        body: code ? apiMessage(err, "Hãy thử lại hoặc nhập mã thủ công.") : "Không kết nối được tới máy chủ. Hãy kiểm tra mạng rồi quét lại — chưa có giao dịch nào được tạo.",
      });
      setScanKey((k) => k + 1);                              // restart the scanner so the person can try again
    } finally { resolvingRef.current = false; setResolving(false); }
  }, [scanId]);

  function onScanned(payload: string, source: ScanSource) { void resolve(payload, source); }
  function submitManual(e: FormEvent) { e.preventDefault(); logQrEvent(scanId, "manual_submit", { source: "manual" }); void resolve(manual, "manual"); }

  function backToScan() {
    setResolved(null); setGross(""); setPreview(null); setPreviewError(null); setCreated(null); setPayError(null); setReceipt(null); setNotice(null);
    scanUuid.current = crypto.randomUUID(); setScanId(newScanId()); setScanKey((k) => k + 1); setStage("scan");
  }

  // ---- payment: live price preview from the server (same rules and arithmetic as the transaction itself) ----
  const grossValid = AMOUNT.test(gross) && Number(gross) > 0;
  useEffect(() => {
    if (stage !== "payment" || !resolved) return;
    if (!grossValid) { setPreview(null); setPreviewError(gross ? "Số tiền chỉ gồm chữ số, tối đa 4 chữ số thập phân." : null); return; }
    const mine = ++previewSeq.current; setPreviewing(true); setPreviewError(null);
    const timer = setTimeout(async () => {
      try {
        const p = (await apiFetch("/transactions/real/preview", { method: "POST", body: JSON.stringify({ collaborator_code: resolved.partner.code, gross_amount: gross }) })) as Preview;
        if (mine === previewSeq.current) setPreview(p);
      } catch (err) { if (mine === previewSeq.current) { setPreview(null); setPreviewError(apiMessage(err, "Không tính được số tiền. Hãy thử lại.")); } }
      finally { if (mine === previewSeq.current) setPreviewing(false); }
    }, 350);
    return () => clearTimeout(timer);
  }, [stage, resolved, gross, grossValid]);

  async function confirmPayment() {
    if (submitting.current || !resolved || !preview) return;       // double click / double tap
    submitting.current = true; setBusy(true); setPayError(null);
    const k = (keys.current = keysFor(resolved.partner.code, gross));
    try {
      let tx = created;
      if (!tx) {
        tx = (await apiFetch("/transactions/real", { method: "POST", body: JSON.stringify({ collaborator_code: resolved.partner.code, gross_amount: gross, idempotency_key: k.create, ...(resolved.scan?.id ? { scan_event_id: resolved.scan.id } : {}) }) })) as Created;
        setCreated(tx);
      }
      try {
        await apiFetch(`/transactions/${tx.transaction_id}/confirm`, { method: "POST", body: JSON.stringify({ idempotency_key: k.confirm }) });
      } catch (err) {
        setPayError(`Giao dịch ${tx.document_number} đã được ghi nhận nhưng chưa xác nhận được (${apiMessage(err, "lỗi mạng")}). Bấm “Thử xác nhận lại”: hệ thống sẽ không tạo giao dịch mới và không cộng hoa hồng lần thứ hai.`);
        return;
      }
      const r = (await apiFetch(`/transactions/${tx.transaction_id}/receipt`)) as Receipt;
      forgetKeys(resolved.partner.code, gross);
      setReceipt(r); setStage("receipt");
    } catch (err) {
      setPayError(apiMessage(err, "Không thể tạo giao dịch. Chưa có khoản nào được ghi nhận; bạn có thể thử lại."));
    } finally { submitting.current = false; setBusy(false); }
  }

  async function cancelRecorded() {
    if (!created || submitting.current) return;
    submitting.current = true; setBusy(true); setPayError(null);
    try {
      await apiFetch(`/transactions/${created.transaction_id}/cancel`, { method: "POST", body: JSON.stringify({ idempotency_key: crypto.randomUUID() }) });
      if (resolved) forgetKeys(resolved.partner.code, gross);
      setCreated(null); setPayError("Đã huỷ giao dịch chưa xác nhận. Bạn có thể nhập lại số tiền.");
    } catch (err) { setPayError(apiMessage(err, "Không huỷ được giao dịch.")); }
    finally { submitting.current = false; setBusy(false); }
  }

  /** Global Partner network: every active Partner can be scanned at every active Merchant. The only gate to PAYING is this Merchant's own commission policy. */
  const canPay = resolved?.payment?.available !== false;

  return (
    <div className="mx-auto max-w-2xl pb-24">
      <h1 className="text-2xl font-bold sm:text-3xl">Quét mã QR Đối tác</h1>
      <p className="mt-2 text-slate-600">Mọi Đối tác đang hoạt động đều dùng được tại cửa hàng của bạn. Quét để xem Đối tác và ưu đãi dành cho khách; chỉ khi bạn nhập hoá đơn và bấm xác nhận mới có giao dịch được tạo.</p>

      {/* 1 — scan */}
      {stage === "scan" && (
        <>
          <div className="mt-5 flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1" role="tablist">
            {([["scan", "📷 Quét QR"], ["manual", "⌨️ Nhập mã"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${tab === id ? "bg-white text-slate-900 shadow" : "text-slate-500"}`}>{label}</button>
            ))}
          </div>

          {notice && (
            <div role="alert" data-testid="scan-notice" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
              <p className="font-semibold">{notice.title}</p><p className="mt-1 text-sm">{notice.body}</p>
              <p className="mt-2 text-xs text-rose-700">Chưa có giao dịch hay hoa hồng nào được tạo.</p>
            </div>
          )}

          {tab === "scan" ? (
            <div className="mt-3"><QrScanner key={`${scanKey}-${scanId}`} scanId={scanId} busy={resolving} onDecode={onScanned} />{resolving && <p className="mt-2 text-center text-sm text-slate-500" role="status">Đang tra cứu Đối tác…</p>}</div>
          ) : (
            <form onSubmit={submitManual} className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <label className="block text-sm font-semibold">Mã Đối tác hoặc liên kết trong QR
                <input value={manual} onChange={(e) => setManual(e.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" data-testid="manual-code"
                  className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base" placeholder="COL-… hoặc dán liên kết từ mã QR" required />
              </label>
              <button disabled={resolving} className="mt-4 min-h-12 w-full rounded-xl bg-slate-800 px-5 font-semibold text-white disabled:opacity-60">{resolving ? "Đang tra cứu…" : "Xem Đối tác và ưu đãi"}</button>
            </form>
          )}
        </>
      )}

      {/* 2 — Partner identity + the discount that applies (inquiry only) */}
      {stage === "result" && resolved && (
        <section className="mt-5 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm sm:p-5" data-testid="partner-result" aria-live="polite">
          <PartnerHeader r={resolved} />
          <div className={`mt-4 flex items-start gap-3 rounded-xl p-4 ${resolved.discount.available ? "bg-violet-50 text-violet-950" : "bg-slate-50 text-slate-700"}`} data-testid="discount-box" data-available={resolved.discount.available}>
            <Tag aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Ưu đãi dành cho khách</p>
              {resolved.discount.available
                ? <p className="text-xl font-bold" data-testid="discount-label">{resolved.discount.label}</p>
                : <p className="text-lg font-semibold" data-testid="discount-label">Không có ưu đãi áp dụng</p>}
            </div>
          </div>
          {!canPay && resolved.payment.message && <p role="status" className="mt-3 rounded-lg bg-amber-100 p-3 text-sm text-amber-900" data-testid="payment-unavailable" data-reason={resolved.payment.reason}>{resolved.payment.message}</p>}
          <p className="mt-3 text-xs text-slate-500" data-testid="inquiry-note">{resolved.scan?.id ? "Lượt quét đã được ghi nhận là một khách ghé cửa hàng. " : ""}Chưa có giao dịch, thanh toán hay hoa hồng nào được tạo — đây chỉ là kiểm tra ưu đãi.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={backToScan} className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 font-semibold text-slate-700" data-testid="close-result">Đóng</button>
            <button type="button" disabled={!canPay} onClick={() => setStage("payment")} className="min-h-12 rounded-xl bg-violet-700 px-4 font-semibold text-white disabled:opacity-50" data-testid="continue-payment">Tiếp tục thanh toán</button>
          </div>
        </section>
      )}

      {/* 3 — payment: Partner kept, amount in, discount and commission computed by the server */}
      {stage === "payment" && resolved && (
        <section className="mt-5 space-y-4" data-testid="payment-step">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><PartnerHeader r={resolved} compact /><button type="button" onClick={backToScan} disabled={busy || Boolean(created)} className="mt-2 text-sm text-slate-600 underline underline-offset-2 disabled:opacity-40">Quét Đối tác khác</button></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <label className="block text-sm font-semibold">Giá trị hoá đơn gốc (VND)
              <input value={gross} onChange={(e) => setGross(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))} disabled={busy || Boolean(created)} inputMode="decimal" autoComplete="off" data-testid="gross-input"
                className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-lg disabled:bg-slate-50" placeholder="Ví dụ: 1250000" />
            </label>
            <p className="mt-1 text-xs text-slate-500">Nhập số tiền trước giảm giá, chỉ gồm chữ số.</p>
            {previewError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800" data-testid="preview-error">{previewError}</p>}
            {preview && grossValid && (
              <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm" data-testid="breakdown" aria-busy={previewing}>
                <dt>Giá trị hoá đơn gốc</dt><dd className="text-right font-semibold" data-testid="pay-original">{formatVnd(preview.gross_amount)}</dd>
                <dt>Giảm giá cho khách <span className="text-slate-500">({formatRate(preview.discount_rate)})</span></dt><dd className="text-right" data-testid="pay-discount">− {formatVnd(preview.discount_amount)}</dd>
                <dt className="border-t border-slate-200 pt-2 text-base font-bold">Khách thanh toán</dt><dd className="border-t border-slate-200 pt-2 text-right text-xl font-bold text-violet-800" data-testid="pay-final">{formatVnd(preview.final_payable)}</dd>
                <dt className="text-slate-600">Hoa hồng Đối tác <span className="text-slate-500">({formatRate(preview.commission_rate)} trên giá trị gốc)</span></dt><dd className="text-right text-slate-700" data-testid="pay-commission">{formatVnd(preview.commission_amount)}</dd>
              </dl>
            )}
            {payError && <p role="alert" data-testid="pay-error" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{payError}</p>}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={confirmPayment} disabled={busy || previewing || !preview || !grossValid} data-testid="confirm-payment" className="min-h-12 rounded-xl bg-emerald-600 px-4 font-semibold text-white disabled:opacity-50">
                {busy ? "Đang xử lý…" : created ? "Thử xác nhận lại" : "Xác nhận thanh toán"}
              </button>
              {created && <button type="button" onClick={cancelRecorded} disabled={busy} className="min-h-12 rounded-xl border border-rose-300 bg-white px-4 font-semibold text-rose-700 disabled:opacity-60">Huỷ giao dịch chưa xác nhận</button>}
            </div>
            <p className="mt-2 text-xs text-slate-500">Bấm một lần. Mỗi lần thanh toán chỉ tạo một giao dịch và chỉ tính hoa hồng một lần, kể cả khi mạng chập chờn.</p>
          </div>
        </section>
      )}

      {/* 4 — receipt */}
      {stage === "receipt" && receipt && resolved && (
        <section className="mt-5 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm" data-testid="receipt" aria-live="polite">
          <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 aria-hidden="true" className="size-6" /><h2 className="text-xl font-bold">Thanh toán đã xác nhận</h2></div>
          <p className="mt-1 font-mono text-sm text-slate-600" data-testid="receipt-number">{receipt.document_number}</p>
          <p className="text-xs text-slate-500">{new Date(receipt.issued_at).toLocaleString("vi-VN")} · {receipt.merchant.name ?? receipt.merchant.code}</p>
          <div className="mt-3"><PartnerHeader r={resolved} compact /></div>
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
            <dt>Giá trị hoá đơn gốc</dt><dd className="text-right" data-testid="receipt-original">{formatVnd(receipt.gross_amount)}</dd>
            <dt>Giảm giá cho khách ({formatRate(receipt.discount_rate)})</dt><dd className="text-right" data-testid="receipt-discount">− {formatVnd(receipt.discount_amount)}</dd>
            <dt className="border-t border-slate-200 pt-2 font-bold">Khách đã thanh toán</dt><dd className="border-t border-slate-200 pt-2 text-right text-lg font-bold" data-testid="receipt-final">{formatVnd(receipt.final_payable)}</dd>
            <dt className="text-slate-600">Hoa hồng Đối tác ({formatRate(receipt.commission_rate)} trên giá trị gốc)</dt><dd className="text-right text-slate-700" data-testid="receipt-commission">{formatVnd(receipt.commission_amount)}</dd>
          </dl>
          <p className="mt-3 text-xs text-slate-500">Trạng thái: <b>Đã xác nhận</b> · Giao dịch được ghi nhận một lần và có trong nhật ký kiểm toán.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Link href="/merchant/dashboard/orders" className="min-h-12 rounded-xl bg-violet-700 px-4 py-3 text-center font-semibold text-white">Xem trong báo cáo</Link>
            <button type="button" onClick={backToScan} className="min-h-12 rounded-xl border border-violet-300 bg-white px-4 font-semibold text-violet-900" data-testid="new-scan">Giao dịch mới</button>
          </div>
        </section>
      )}
    </div>
  );
}

function PartnerHeader({ r, compact = false }: { r: Resolved; compact?: boolean }) {
  const initials = (r.partner.name || r.partner.code).trim().split(/\s+/).slice(-2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  return (
    <div className="flex items-center gap-3" data-testid="partner-identity">
      {r.partner.avatar_url
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of the Partner's approved avatar
        ? <img src={r.partner.avatar_url} alt={`Ảnh đại diện của ${r.partner.name}`} data-testid="partner-avatar" className={`${compact ? "size-12" : "size-16"} shrink-0 rounded-full border border-slate-200 object-cover`} />
        : <span data-testid="partner-avatar-fallback" aria-hidden="true" className={`${compact ? "size-12 text-base" : "size-16 text-xl"} grid shrink-0 place-items-center rounded-full bg-slate-100 font-bold text-slate-600`}>{initials === "?" ? <UserRound className="size-6" /> : initials}</span>}
      <div className="min-w-0">
        <p className={`${compact ? "text-base" : "text-lg"} truncate font-bold`} data-testid="partner-name">{r.partner.name || "Đối tác"}</p>
        <p className="font-mono text-sm text-slate-600" data-testid="partner-code">{r.partner.code}</p>
        <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700" data-testid="partner-verified">{r.partner.verified ? <><BadgeCheck aria-hidden="true" className="size-4" />Đã xác minh · Đang hoạt động</> : <><ScanLine aria-hidden="true" className="size-4" />Chưa xác minh</>}</p>
      </div>
    </div>
  );
}
