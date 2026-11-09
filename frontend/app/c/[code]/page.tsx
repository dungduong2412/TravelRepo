"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { QrCode, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { publicApiFetch } from "@/lib/api";

/** Global Partner network: the code is valid at every active Merchant, so the page identifies the Partner only. */
type PartnerInfo = {
  partner_code: string;
  partner_name: string;
  active?: boolean;
  applies_to?: string;
};

type View =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; info: PartnerInfo };

export default function CustomerQrLandingPage() {
  const { code } = useParams<{ code: string }>();
  const [view, setView] = useState<View>({ state: "loading" });

  useEffect(() => {
    if (!code) return;
    publicApiFetch(`/c/${encodeURIComponent(code)}`)
      .then((info: PartnerInfo) => setView({ state: "ready", info }))
      .catch(() =>
        setView({ state: "error", message: "Mã đối tác không tồn tại hoặc chưa được xác minh." })
      );
  }, [code]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-violet-50 to-white">
      <div className="mx-auto max-w-md px-4 py-8">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-violet-700 hover:text-violet-900"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Về trang chủ VNO
        </Link>

        {view.state === "loading" && (
          <div className="mt-16 flex flex-col items-center gap-3 text-violet-600">
            <div className="size-10 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
            <p className="text-sm">Đang tải thông tin đối tác…</p>
          </div>
        )}

        {view.state === "error" && (
          <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
            <QrCode aria-hidden="true" className="mx-auto mb-3 size-10 text-rose-400" />
            <h1 className="text-lg font-bold text-rose-900">Mã không hợp lệ</h1>
            <p className="mt-2 text-sm text-rose-700">{view.message}</p>
          </div>
        )}

        {view.state === "ready" && <PartnerCard info={view.info} />}
      </div>
    </main>
  );
}

function PartnerCard({ info }: { info: PartnerInfo }) {
  return (
    <div className="space-y-4">
      {/* Partner attribution */}
      <div className="rounded-2xl border border-violet-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-700">
            <QrCode aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-sm text-slate-500">Đối tác giới thiệu</p>
            <h1 className="mt-0.5 text-xl font-bold text-slate-900">{info.partner_name}</h1>
            <p className="mt-1 font-mono text-xs text-slate-400">{info.partner_code}</p>
          </div>
        </div>
      </div>

      {/* Valid at every active Merchant; the discount belongs to each Merchant and is shown to its staff when they scan */}
      <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm" data-testid="partner-network-note">
        <p className="text-sm font-semibold text-emerald-800">Mã này dùng được tại mọi nhà cung cấp VNO đang hoạt động</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Trình trang này (hoặc mã QR của đối tác) cho nhân viên tại quầy.</li>
          <li>Nhân viên quét mã QR của đối tác để ghi nhận giới thiệu.</li>
          <li>Ưu đãi (nếu nhà cung cấp có áp dụng) được hiển thị cho nhân viên khi quét và tính ngay trên hóa đơn.</li>
        </ol>
        {info.active === false && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Đối tác này hiện chưa hoạt động. Vui lòng liên hệ đối tác để biết thêm thông tin.</p>}
      </div>

      <p className="px-2 text-center text-xs text-slate-400">
        Trang này xác nhận giới thiệu của đối tác. Không lưu trữ thông tin cá nhân của bạn.
      </p>
    </div>
  );
}
