// Main-photo selection rules shared by the Admin directory and the anonymous catalog.
// A Merchant's Main Photo is its single effective, verified `is_hero` asset. Legacy data may have no hero, so the
// first effective asset (display_order, then creation time, then id) is the deterministic fallback.

export const EFFECTIVE_MEDIA_STATUSES = ['legacy_effective', 'preexisting_effective', 'approved'] as const;

export type OrderableMedia = { id: string; is_hero?: boolean | null; display_order?: number | null; created_at?: string | null };

export function compareMedia(a: OrderableMedia, b: OrderableMedia): number {
  return Number(Boolean(b.is_hero)) - Number(Boolean(a.is_hero))
    || (a.display_order ?? 0) - (b.display_order ?? 0)
    || (Date.parse(a.created_at ?? '') || 0) - (Date.parse(b.created_at ?? '') || 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function pickMainMedia<T extends OrderableMedia>(assets: T[]): T | null {
  return assets.length ? [...assets].sort(compareMedia)[0] : null;
}

export function isEffectiveMedia(status: unknown): boolean {
  return (EFFECTIVE_MEDIA_STATUSES as readonly string[]).includes(String(status));
}
