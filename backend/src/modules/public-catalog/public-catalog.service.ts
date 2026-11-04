import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { PostgresUuidSchema } from '../../common/validation/postgres-uuid';
import {
  PUBLIC_MEDIA_STATUSES, PUBLIC_MERCHANT_COLUMNS, PublicCategory, iconSlug, plainText, publicOffer, toPublicDetail, toPublicListing,
} from './public-catalog.projection';

const CACHE_TTL_MS = 30_000;
/** Public image presets. Originals average >1 MB (up to 4.5 MB); Storage image transformation returns ~30 KB for a card. */
export const IMAGE_SIZES = {
  thumb: { width: 160, height: 160 },
  card: { width: 640, height: 480 },
  hero: { width: 1280, height: 800 },
} as const;
export type ImageSize = keyof typeof IMAGE_SIZES | 'original';
const MEDIA_COLUMNS = 'id,merchant_id,bucket_id,object_path,is_hero,display_order,created_at';

type Snapshot = {
  at: number;
  merchants: Record<string, any>[];
  categories: Map<string, PublicCategory & { display_order: number }>;
  categoryByMerchant: Map<string, string[]>;
  assetsByMerchant: Map<string, string[]>;
};

@Injectable()
export class PublicCatalogService {
  private snapshot: Snapshot | null = null;
  constructor(private readonly supabase: SupabaseService) {}

  private async load(): Promise<Snapshot> {
    if (this.snapshot && Date.now() - this.snapshot.at < CACHE_TTL_MS) return this.snapshot;
    const client = this.supabase.getClient();
    const [merchants, cats, links, media] = await Promise.all([
      client.from('merchant_details').select(PUBLIC_MERCHANT_COLUMNS.join(','))
        .eq('merchant_verified', true).order('merchant_priority', { ascending: false, nullsFirst: false }).order('merchant_name'),
      client.from('categories').select('id,category_name,category_name_vi,category_icon,display_order').eq('is_active', true),
      client.from('merchant_category_links').select('merchant_id,category_id'),
      client.from('media_assets').select(MEDIA_COLUMNS).not('merchant_id', 'is', null)
        .in('publication_status', [...PUBLIC_MEDIA_STATUSES]).eq('transfer_status', 'verified')
        .order('is_hero', { ascending: false }).order('display_order').order('created_at').order('id'),
    ]);
    for (const r of [merchants, cats, links, media]) if (r.error) throw new InternalServerErrorException('Catalog is temporarily unavailable');

    const categories = new Map<string, PublicCategory & { display_order: number }>();
    for (const c of (cats.data || []) as any[]) {
      categories.set(c.id, { id: c.id, name: c.category_name, name_vi: c.category_name_vi || c.category_name, icon: iconSlug(c.category_icon), display_order: c.display_order ?? 0 });
    }
    const categoryByMerchant = new Map<string, string[]>();
    for (const l of (links.data || []) as any[]) {
      if (!categories.has(l.category_id)) continue;
      categoryByMerchant.set(l.merchant_id, [...(categoryByMerchant.get(l.merchant_id) || []), l.category_id]);
    }
    const assetsByMerchant = new Map<string, string[]>();
    for (const a of (media.data || []) as any[]) assetsByMerchant.set(a.merchant_id, [...(assetsByMerchant.get(a.merchant_id) || []), a.id]);

    // Discovery ranking: listings that can actually be shown well (approved photo, then a published offer) come first;
    // the remaining order is the original priority/name order (Array.sort is stable). Nothing is hidden by this.
    const offerOf = (m: any) => publicOffer(m.merchant_discount_type, m.merchant_discount_value) !== null;
    const quality = (m: any) => (assetsByMerchant.has(m.merchant_system_id) ? 2 : 0) + (offerOf(m) ? 1 : 0);
    const ranked = ((merchants.data || []) as any[]).filter((m) => m.legacy_is_banned !== true).sort((a, b) => quality(b) - quality(a));
    this.snapshot = { at: Date.now(), merchants: ranked, categories, categoryByMerchant, assetsByMerchant };
    return this.snapshot;
  }

  private categoriesOf(s: Snapshot, merchantId: string): PublicCategory[] {
    return (s.categoryByMerchant.get(merchantId) || []).map((id) => {
      const { display_order: _order, ...c } = s.categories.get(id)!;
      return c;
    });
  }

  async categories() {
    const s = await this.load();
    const counts = new Map<string, number>();
    for (const m of s.merchants) for (const id of s.categoryByMerchant.get(m.merchant_system_id) || []) counts.set(id, (counts.get(id) || 0) + 1);
    return [...s.categories.values()]
      .filter((c) => (counts.get(c.id) || 0) > 0)
      .sort((a, b) => a.display_order - b.display_order || a.name_vi.localeCompare(b.name_vi, 'vi'))
      .map(({ display_order: _order, ...c }) => ({ ...c, count: counts.get(c.id)! }));
  }

  async list(query: { category?: string; q?: string; page: number; page_size: number }) {
    const s = await this.load();
    const q = query.q?.trim().toLocaleLowerCase('vi');
    const filtered = s.merchants.filter((m) => {
      if (query.category && !(s.categoryByMerchant.get(m.merchant_system_id) || []).includes(query.category)) return false;
      if (!q) return true;
      return [m.merchant_name, m.new_address_city, m.new_address_ward, plainText(m.merchant_description, m.merchant_description_format)]
        .some((v) => typeof v === 'string' && v.toLocaleLowerCase('vi').includes(q));
    });
    const from = (query.page - 1) * query.page_size;
    return {
      items: filtered.slice(from, from + query.page_size)
        .map((m) => toPublicListing(m, this.categoriesOf(s, m.merchant_system_id), s.assetsByMerchant.get(m.merchant_system_id)?.[0] ?? null)),
      total: filtered.length, page: query.page, page_size: query.page_size,
    };
  }

  async detail(id: string) {
    if (!PostgresUuidSchema.safeParse(id).success) throw new NotFoundException('Merchant not found');
    const s = await this.load();
    const m = s.merchants.find((row) => row.merchant_system_id === id.toLowerCase());
    if (!m) throw new NotFoundException('Merchant not found');
    return toPublicDetail(m, this.categoriesOf(s, id.toLowerCase()), s.assetsByMerchant.get(id.toLowerCase()) || []);
  }

  /** Short-lived signed URL for an effective, verified asset of a publicly listed Merchant; anything else is a 404. */
  async signedMediaUrl(assetId: string, size: ImageSize = 'card') {
    if (!PostgresUuidSchema.safeParse(assetId).success) throw new NotFoundException('Image not found');
    const s = await this.load();
    const client = this.supabase.getClient();
    const { data: asset, error } = await client.from('media_assets').select(MEDIA_COLUMNS).eq('id', assetId.toLowerCase())
      .in('publication_status', [...PUBLIC_MEDIA_STATUSES]).eq('transfer_status', 'verified').maybeSingle();
    if (error) throw new InternalServerErrorException('Image is temporarily unavailable');
    if (!asset || !s.merchants.some((m) => m.merchant_system_id === asset.merchant_id)) throw new NotFoundException('Image not found');
    const transform = size === 'original' ? undefined : { transform: { ...IMAGE_SIZES[size], resize: 'cover' as const, quality: 80 } };
    const { data: signed, error: signError } = await client.storage.from(asset.bucket_id).createSignedUrl(asset.object_path, 600, transform);
    if (signError || !signed?.signedUrl) throw new InternalServerErrorException('Image is temporarily unavailable');
    return signed.signedUrl;
  }
}
