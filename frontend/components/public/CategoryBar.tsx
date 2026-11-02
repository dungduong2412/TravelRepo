'use client';
import { LayoutGrid } from 'lucide-react';
import { CategoryIcon } from '../ui/Icon';
import type { CatalogCategory } from '../../lib/catalog';

export function CategoryBar({ categories, active, onSelect }: { categories: CatalogCategory[]; active: string | null; onSelect: (id: string | null) => void }) {
  const item = (selected: boolean) => `flex min-h-14 shrink-0 flex-col items-center justify-center gap-1 whitespace-nowrap border-b-2 px-3 text-xs font-semibold transition ${selected ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:border-line hover:text-ink'}`;
  return (
    <nav aria-label="Danh mục" className="mx-auto max-w-7xl px-4 sm:px-6">
      <ul className="scrollbar-hide flex gap-1 overflow-x-auto">
        <li><button type="button" aria-pressed={active === null} onClick={() => onSelect(null)} className={item(active === null)}><LayoutGrid aria-hidden="true" className="size-5" strokeWidth={1.75} />Tất cả</button></li>
        {categories.map((c) => (
          <li key={c.id}>
            <button type="button" aria-pressed={active === c.id} onClick={() => onSelect(active === c.id ? null : c.id)} className={item(active === c.id)} data-testid="category-chip" data-category={c.name}>
              <CategoryIcon category={c} className="size-5" /><span className="whitespace-nowrap">{c.name_vi}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
