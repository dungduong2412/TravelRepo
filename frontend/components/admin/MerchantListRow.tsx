"use client";

import { ChevronRight } from 'lucide-react';
import { MerchantThumb } from './MerchantThumb';
import { statusLabel } from '../../lib/status-labels';

export type DirectoryRowData = {
  merchant_system_id: string; merchant_code?: string | null; merchant_name?: string | null; merchant_verified?: boolean; merchants_status?: string | null;
  new_address_line?: string | null; new_address_ward?: string | null; new_address_district?: string | null; new_address_city?: string | null; new_address_province?: string | null;
  category_names?: string[]; main_image?: { id: string; thumb_url: string | null } | null;
};

const text = (value?: string | null) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
export const rowLocation = (m: DirectoryRowData) => [m.new_address_ward, m.new_address_city || m.new_address_district, m.new_address_province].map(text).filter(Boolean).filter((part, i, all) => all.indexOf(part) === i).join(', ');
export function verificationLabel(m: DirectoryRowData) {
  if (m.merchant_verified) return { text: 'Verified', tone: 'bg-success-50 text-success-700' };
  return m.merchants_status === 'pending' ? { text: statusLabel('pending'), tone: 'bg-warning-50 text-warning-700' } : { text: 'Not verified', tone: 'bg-canvas text-ink-muted' };
}

/** Two-line Merchant row: (name · verification) / (code · category · location). Each line truncates; the whole row opens the editor. */
export function MerchantListRow({ merchant, onOpen }: { merchant: DirectoryRowData; onOpen: () => void }) {
  const badge = verificationLabel(merchant);
  const meta = [text(merchant.merchant_code), (merchant.category_names || []).join(', '), rowLocation(merchant)].filter(Boolean).join(' · ');
  return <li>
    <button type="button" data-testid="merchant-row" onClick={onOpen} aria-label={`Open ${merchant.merchant_name || 'merchant'}`}
      className="flex min-h-[4.5rem] w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-canvas focus-visible:bg-canvas sm:px-4">
      <MerchantThumb image={merchant.main_image} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><span data-testid="merchant-row-name" className="truncate text-sm font-semibold text-ink">{merchant.merchant_name || 'Unnamed merchant'}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${badge.tone}`}>{badge.text}</span></span>
        <span data-testid="merchant-row-meta" className="mt-0.5 block truncate text-xs text-ink-muted">{meta || '—'}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
    </button>
  </li>;
}
