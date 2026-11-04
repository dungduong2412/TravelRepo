// Pure projection helpers for the anonymous catalog. The allow-lists below are the ONLY columns that may reach
// an unauthenticated caller: owner identity (name/phone/e-mail/tax code), Partner commission and every legacy_* field stay private.
// merchant_email / merchant_phone are the owner's personal login identifiers in the imported data (141/144 and 139/144 rows are
// identical to owner_email / owner_phone), so the only public contact number is merchant_contact_phone.

export const PUBLIC_MERCHANT_COLUMNS = [
  'merchant_system_id', 'merchant_code', 'merchant_name', 'merchant_description', 'merchant_description_format', 'merchant_contact_phone',
  'merchant_discount_type', 'merchant_discount_value', 'merchant_priority',
  'new_address_line', 'new_address_ward', 'new_address_city', 'legacy_is_banned',
] as const;

export const PUBLIC_MEDIA_STATUSES = ['legacy_effective', 'preexisting_effective', 'approved'] as const;

export type PublicOffer = { type: 'percentage' | 'amount'; value: number; label: string };
export type PublicCategory = { id: string; name: string; name_vi: string; icon: string | null };

/**
 * Description text for the public site. The UI never renders markup, so HTML tags are always dropped and Markdown *structure* is
 * flattened to its text (links, images, escapes, paired emphasis / code, heading markers) for every format: imported descriptions are
 * flagged `plain_text` but carry V1 Markdown. Characters that carry meaning in ordinary text are kept ("3*", "Wi-Fi_free", "#1",
 * "> 10 khách", "<500k"), so what the Admin saves is what customers read. A `markdown` description additionally loses every
 * remaining formatting symbol. Line endings are normalised and runs of blank lines collapsed.
 */
export function plainText(value: unknown, format: unknown = 'plain_text'): string {
  if (typeof value !== 'string') return '';
  let text = value.replace(/\r\n?/g, '\n').replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\\([\\`*_{}\[\]()#+.!>-])/g, '$1')
    .replace(/\*\*([^\n*]+?)\*\*/g, '$1').replace(/__([^\n_]+?)__/g, '$1')
    .replace(/(^|[^\w*])\*(?=\S)([^\n*]+?)(?<=\S)\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w_])_(?=\S)([^\n_]+?)(?<=\S)_(?![\w_])/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^ {0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*([*_-])(?:[ \t]*\1){2,}[ \t]*$/gm, '');
  if (format === 'markdown') text = text.replace(/^[ \t]*>+[ \t]?/gm, '').replace(/[*_`#]+/g, '');
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** Customer-facing discount only. A zero / missing discount yields null (no "0%" labels). Commission is never involved. */
export function publicOffer(type: unknown, value: unknown): PublicOffer | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (type === 'percentage') {
    const pct = Math.round(n * 1000) / 10;
    if (pct <= 0 || pct > 100) return null;
    return { type: 'percentage', value: pct, label: `Giảm ${String(pct).replace('.', ',')}%` };
  }
  if (type === 'fixed' || type === 'amount') {
    return { type: 'amount', value: n, label: `Giảm ${new Intl.NumberFormat('vi-VN').format(n)} đ` };
  }
  return null;
}

/** Category icons are stored as Font Awesome class strings ("fa-regular fa-shirt") or junk ("Sing "). Return a bare slug or null. */
export function iconSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/\bfa-(?!regular\b|solid\b|light\b|thin\b|brands\b|duotone\b)([a-z0-9-]+)/);
  return match ? match[1] : null;
}

export function addressLine(row: Record<string, any>): string | null {
  const parts = [row.new_address_line, row.new_address_ward, row.new_address_city]
    .map((p) => (typeof p === 'string' ? p.replace(/\s+/g, ' ').trim() : ''))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function toPublicListing(row: Record<string, any>, categories: PublicCategory[], heroAssetId: string | null) {
  return {
    id: row.merchant_system_id as string,
    code: row.merchant_code as string,
    name: row.merchant_name as string,
    summary: excerpt(plainText(row.merchant_description, row.merchant_description_format)),
    city: (row.new_address_city as string | null) || null,
    address: addressLine(row),
    categories,
    image_url: heroAssetId ? `/public/media/${heroAssetId}` : null,
    offer: publicOffer(row.merchant_discount_type, row.merchant_discount_value),
  };
}

export function toPublicDetail(row: Record<string, any>, categories: PublicCategory[], assetIds: string[]) {
  const phone = typeof row.merchant_contact_phone === 'string' ? row.merchant_contact_phone.trim() : '';
  return {
    ...toPublicListing(row, categories, assetIds[0] ?? null),
    description: plainText(row.merchant_description, row.merchant_description_format),
    phone: phone || null,
    gallery: assetIds.map((id) => ({ id, url: `/public/media/${id}` })),
  };
}
