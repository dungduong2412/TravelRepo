"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, MapPin, Phone, QrCode } from "lucide-react";
import { SiteHeader } from "@/components/public/SiteHeader";
import { Badge, EmptyState, ErrorState, Spinner } from "@/components/ui/Feedback";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Brand";
import { ApiStatusError, fetchDetail, imageSrc, mapsUrl, type CatalogDetail } from "@/lib/catalog";

type View = { state: "loading" } | { state: "missing" } | { state: "error" } | { state: "ready"; detail: CatalogDetail };

export default function MerchantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<View>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    let active = true;
    setView({ state: "loading" });
    fetchDetail(id)
      .then((detail) => { if (active) { setSelected(0); setView({ state: "ready", detail }); document.title = `${detail.name} | VNO`; } })
      .catch((error) => active && setView({ state: error instanceof ApiStatusError && error.status === 404 ? "missing" : "error" }));
    return () => { active = false; };
  }, [id, attempt]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
        <Link href="/" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"><ArrowLeft aria-hidden="true" className="size-4" />Tất cả nhà cung cấp</Link>

        {view.state === "loading" && <Spinner />}
        {view.state === "missing" && <EmptyState title="Không tìm thấy nhà cung cấp" action={<ButtonLink href="/">Về trang chủ</ButtonLink>}>Liên kết có thể đã cũ hoặc nhà cung cấp chưa được xác minh.</EmptyState>}
        {view.state === "error" && <ErrorState onRetry={() => setAttempt((n) => n + 1)}>Không tải được thông tin nhà cung cấp do lỗi kết nối.</ErrorState>}
        {view.state === "ready" && <Detail detail={view.detail} selected={selected} onSelect={setSelected} />}
      </main>
    </>
  );
}

function Detail({ detail, selected, onSelect }: { detail: CatalogDetail; selected: number; onSelect: (i: number) => void }) {
  const hero = imageSrc(detail.gallery[selected]?.url ?? null, 'hero');
  return (
    <article>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" data-testid="merchant-name">{detail.name}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {detail.categories.map((c) => <Badge key={c.id}>{c.name_vi}</Badge>)}
        {detail.address && <span className="flex items-center gap-1 text-sm text-ink-muted"><MapPin aria-hidden="true" className="size-4" />{detail.address}</span>}
      </div>

      <section aria-label="Hình ảnh" className="mt-5">
        {hero
          // eslint-disable-next-line @next/next/no-img-element -- signed redirect served by our API
          ? <img src={hero} alt={`Ảnh ${selected + 1} của ${detail.name}`} data-testid="gallery-hero" className="aspect-[16/10] w-full rounded-card bg-canvas object-cover" />
          : <div data-testid="gallery-empty" className="grid aspect-[16/10] w-full place-items-center rounded-card bg-canvas text-sm text-ink-muted">Nhà cung cấp chưa đăng ảnh</div>}
        {detail.gallery.length > 1 && (
          <ul className="scrollbar-hide mt-2 flex gap-2 overflow-x-auto" aria-label="Chọn ảnh">
            {detail.gallery.map((g, i) => (
              <li key={g.id}>
                <button type="button" onClick={() => onSelect(i)} aria-label={`Xem ảnh ${i + 1}`} aria-current={i === selected} data-testid="gallery-thumb"
                  className={`size-16 overflow-hidden rounded-control border-2 ${i === selected ? "border-brand-600" : "border-transparent"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageSrc(g.url, 'thumb')!} alt="" loading="lazy" className="size-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_20rem]">
        <section aria-label="Giới thiệu">
          <h2 className="text-lg font-semibold">Giới thiệu</h2>
          {detail.description
            ? <p className="mt-2 whitespace-pre-line text-ink" data-testid="merchant-description">{detail.description}</p>
            : <p className="mt-2 text-ink-muted" data-testid="description-unavailable">Nhà cung cấp chưa cập nhật phần giới thiệu.</p>}
        </section>

        <aside className="space-y-4">
          <Card className="p-4" data-testid="offer-card">
            <h2 className="text-base font-semibold">Ưu đãi</h2>
            {detail.offer
              ? <><p className="mt-2 text-2xl font-extrabold text-brand-700">{detail.offer.label}</p>
                  <p className="mt-2 flex items-start gap-2 text-sm text-ink-muted"><QrCode aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Áp dụng khi bạn được giới thiệu bởi một Đối tác VNO và nhà cung cấp quét mã QR của Đối tác tại quầy.</p></>
              : <p className="mt-2 text-sm text-ink-muted">Nhà cung cấp hiện chưa công bố ưu đãi.</p>}
          </Card>
          <Card className="p-4" data-testid="contact-card">
            <h2 className="text-base font-semibold">Liên hệ</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {detail.phone ? <li><a href={`tel:${detail.phone.replace(/[^\d+]/g, "")}`} className={buttonClass("secondary", "w-full justify-start")}><Phone aria-hidden="true" className="size-4" />{detail.phone}</a></li> : <li className="text-ink-muted" data-testid="phone-unavailable">Chưa có số điện thoại liên hệ.</li>}
              {detail.address ? <li><a href={mapsUrl(detail.address)} target="_blank" rel="noreferrer" className={buttonClass("secondary", "w-full justify-start")}><MapPin aria-hidden="true" className="size-4" /><span className="truncate">Xem bản đồ</span></a></li> : <li className="text-ink-muted">Chưa có địa chỉ.</li>}
            </ul>
          </Card>
        </aside>
      </div>
    </article>
  );
}
