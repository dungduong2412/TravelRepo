import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { Badge } from '../ui/Feedback';
import { CategoryIcon } from '../ui/Icon';
import { imageSrc, type CatalogListing } from '../../lib/catalog';

export function ListingCard({ listing }: { listing: CatalogListing }) {
  const src = imageSrc(listing.image_url);
  const category = listing.categories[0];
  return (
    <Link href={`/merchants/${listing.id}`} data-testid="listing-card" aria-label={listing.name} className="group block rounded-card focus-visible:outline-offset-4">
      <div className="relative aspect-[4/3] overflow-hidden rounded-card border border-line bg-canvas">
        {src
          // eslint-disable-next-line @next/next/no-img-element -- images are short-lived signed redirects from our API; next/image would proxy and cache them
          ? <img src={src} alt={`Ảnh ${listing.name}`} loading="lazy" decoding="async" className="size-full object-cover transition duration-300 group-hover:scale-105" />
          : <div data-testid="listing-no-image" className="flex size-full flex-col items-center justify-center gap-2 bg-line/50 text-ink-muted">
              {category ? <CategoryIcon category={category} className="size-9 opacity-60" /> : null}<span className="text-xs">Chưa có ảnh</span>
            </div>}
        {listing.offer && <span className="absolute left-3 top-3 rounded-full bg-brand-600 px-3 py-1 text-xs font-bold text-white shadow-card">{listing.offer.label}</span>}
      </div>
      <div className="mt-3 px-0.5">
        <h3 className="line-clamp-1 font-semibold group-hover:text-brand-700">{listing.name}</h3>
        {listing.address && <p className="mt-1 flex items-start gap-1 text-sm text-ink-muted"><MapPin aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span className="line-clamp-1">{listing.address}</span></p>}
        {category && <div className="mt-2"><Badge>{category.name_vi}</Badge></div>}
      </div>
    </Link>
  );
}

export function ListingSkeletons({ count = 8 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => <div key={i}><div className="aspect-[4/3] animate-pulse rounded-card bg-line" /><div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-line" /><div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-line" /></div>)}
    </div>
  );
}
