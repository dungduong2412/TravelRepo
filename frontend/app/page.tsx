"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { SiteHeader } from "@/components/public/SiteHeader";
import { CategoryBar } from "@/components/public/CategoryBar";
import { ListingCard, ListingSkeletons } from "@/components/public/ListingCard";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/Feedback";
import { fetchCategories, fetchListings, type CatalogCategory, type CatalogListing, type CatalogPage } from "@/lib/catalog";

type View = { state: "loading" } | { state: "error" } | { state: "ready"; page: CatalogPage };
type More = { items: CatalogListing[]; page: number; busy: boolean; failed: boolean };

/** Filters live in the URL (?category=<id>&q=<text>) so listings can be shared, refreshed and deep-linked. */
function Discovery() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const category = params.get("category");
  const q = params.get("q") ?? "";
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [categoriesFailed, setCategoriesFailed] = useState(false);
  const [view, setView] = useState<View>({ state: "loading" });
  const [draft, setDraft] = useState(q);
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState<More>({ items: [], page: 1, busy: false, failed: false });

  const navigate = useCallback((next: { category?: string | null; q?: string }) => {
    const qs = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) { if (value) qs.set(key, value); else qs.delete(key); }
    router.push(qs.size ? `${pathname}?${qs}` : pathname);
  }, [params, pathname, router]);

  useEffect(() => { fetchCategories().then(setCategories).catch(() => setCategoriesFailed(true)); }, [attempt]);
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    let active = true;
    setView({ state: "loading" });
    setMore({ items: [], page: 1, busy: false, failed: false });
    fetchListings({ category, q: q || null })
      .then((page) => active && setView({ state: "ready", page }))
      .catch(() => active && setView({ state: "error" }));
    return () => { active = false; };
  }, [category, q, attempt]);

  const loadMore = useCallback(async () => {
    setMore((m) => ({ ...m, busy: true, failed: false }));
    try {
      const next = await fetchListings({ category, q: q || null, page: more.page + 1 });
      setMore((m) => ({ items: [...m.items, ...next.items], page: m.page + 1, busy: false, failed: false }));
    } catch { setMore((m) => ({ ...m, busy: false, failed: true })); }
  }, [category, q, more.page]);

  const activeName = categories.find((c) => c.id === category)?.name_vi;

  return (
    <>
      <SiteHeader>
        <div className="mx-auto max-w-7xl px-4 pb-3 sm:px-6">
          <form role="search" onSubmit={(e) => { e.preventDefault(); navigate({ q: draft.trim() }); }} className="flex gap-2">
            <label htmlFor="catalog-search" className="sr-only">Tìm theo tên hoặc khu vực</label>
            <input id="catalog-search" type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Tìm theo tên hoặc khu vực…"
              className="min-h-11 flex-1 rounded-control border border-line bg-surface px-4 text-base focus:border-brand-600 sm:text-sm" />
            <Button type="submit" aria-label="Tìm kiếm"><Search aria-hidden="true" className="size-4" /><span className="hidden sm:inline">Tìm</span></Button>
          </form>
        </div>
        {categories.length > 0 && <CategoryBar categories={categories} active={category} onSelect={(id) => navigate({ category: id })} />}
      </SiteHeader>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{activeName ?? "Ưu đãi từ nhà cung cấp đã xác minh"}</h1>
          {view.state === "ready" && <p data-testid="result-count" className="text-sm text-ink-muted">{view.page.total} nhà cung cấp</p>}
        </div>
        {categoriesFailed && <p className="mb-4 text-sm text-warning-700">Không tải được danh mục; bạn vẫn có thể xem toàn bộ danh sách.</p>}

        {view.state === "loading" && <ListingSkeletons />}
        {view.state === "error" && <ErrorState onRetry={() => setAttempt((n) => n + 1)}>Không kết nối được máy chủ. Hãy thử lại sau ít phút.</ErrorState>}
        {view.state === "ready" && view.page.items.length === 0 && (
          <EmptyState title="Chưa có nhà cung cấp phù hợp" action={(category || q) ? <Button variant="secondary" onClick={() => router.push(pathname)}>Xóa bộ lọc</Button> : undefined}>
            {activeName ? `Hiện chưa có nhà cung cấp nào trong danh mục "${activeName}".` : "Hãy thử từ khóa khác."}
          </EmptyState>
        )}
        {view.state === "ready" && view.page.items.length > 0 && (() => {
          const shown = [...view.page.items, ...more.items];
          return (
            <>
              <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="listing-grid">
                {shown.map((item) => <ListingCard key={item.id} listing={item} />)}
              </div>
              {view.page.total > shown.length && (
                <div className="mt-8 text-center">
                  <p className="mb-3 text-sm text-ink-muted">Đang hiển thị {shown.length} / {view.page.total}</p>
                  {more.failed && <p role="alert" className="mb-3 text-sm text-danger-700">Không tải thêm được. Hãy thử lại.</p>}
                  <Button variant="secondary" onClick={() => void loadMore()} disabled={more.busy} data-testid="load-more">{more.busy ? "Đang tải…" : "Xem thêm"}</Button>
                </div>
              )}
            </>
          );
        })()}
      </main>

      <footer className="mt-10 border-t border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-6 text-sm text-ink-muted sm:px-6">© 2026 VNO. Ưu đãi áp dụng khi xuất trình mã QR của Đối tác tại quầy.</div>
      </footer>
    </>
  );
}

export default function HomePage() {
  return <Suspense fallback={<div className="p-10"><ListingSkeletons /></div>}><Discovery /></Suspense>;
}
