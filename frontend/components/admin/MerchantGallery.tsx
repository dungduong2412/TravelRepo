"use client";
/* Signed private Storage URLs are short-lived and cannot use a stable Next image loader. */
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from 'react';
import { Check, ImageOff, Star, Upload } from 'lucide-react';
import { api } from '../../lib/api';

export type MerchantMedia = {
  id: string; original_filename?: string | null; mime_type?: string | null; size_bytes?: number | null; is_hero?: boolean;
  display_order?: number; created_at?: string | null; transfer_status?: string | null; publication_status?: string | null; signed_url?: string | null;
};

const EFFECTIVE = ['legacy_effective', 'preexisting_effective', 'approved'];
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const isEligibleMedia = (asset: MerchantMedia) => EFFECTIVE.includes(asset.publication_status || '') && asset.transfer_status === 'verified';
// Same rule as the backend (media/main-media.ts) so the Admin sees the image the public site shows.
export const orderMedia = (a: MerchantMedia, b: MerchantMedia) => Number(Boolean(b.is_hero)) - Number(Boolean(a.is_hero)) || (a.display_order ?? 0) - (b.display_order ?? 0) || (Date.parse(a.created_at || '') || 0) - (Date.parse(b.created_at || '') || 0) || a.id.localeCompare(b.id);
export const mainMedia = (media: MerchantMedia[]) => [...media].filter(isEligibleMedia).sort(orderMedia)[0] ?? null;

function Picture({ asset, className, label }: { asset: MerchantMedia; className: string; label: string }) {
  const [broken, setBroken] = useState(false);
  if (!asset.signed_url || broken) return <div data-testid="picture-unavailable" className={`${className} grid place-items-center bg-canvas text-xs text-ink-muted`}><span className="flex flex-col items-center gap-1"><ImageOff aria-hidden="true" className="size-5" />Preview unavailable</span></div>;
  return <img src={asset.signed_url} alt={label} loading="lazy" decoding="async" className={`${className} bg-canvas object-cover`} onError={() => setBroken(true)} />;
}

/** Read-only Main Photo hero used at the top of Merchant View Mode. */
export function MerchantHero({ media, name }: { media: MerchantMedia[]; name: string }) {
  const main = useMemo(() => mainMedia(media), [media]);
  if (!main) return <div data-testid="merchant-hero-empty" className="grid aspect-[16/7] w-full place-items-center rounded-card bg-canvas text-sm text-ink-muted">No main photo yet</div>;
  return <Picture key={main.id} asset={main} label={`Main photo of ${name}`} className="aspect-[16/7] max-h-72 w-full rounded-card" />;
}

/**
 * Gallery of every effective image with Set-as-Main and upload. Superseded / removed / pending / rejected files are listed separately
 * as history and are never offered as a Main Photo. Setting Main only flips the flag server-side; nothing is copied or removed.
 */
export function MerchantGallery({ merchantId, media, onChanged }: { merchantId: string; media: MerchantMedia[]; onChanged: () => Promise<void> }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const eligible = useMemo(() => media.filter(isEligibleMedia).sort(orderMedia), [media]);
  const history = media.filter((asset) => !isEligibleMedia(asset));
  const main = eligible[0] ?? null;
  const hasExplicitMain = Boolean(main?.is_hero);

  async function setMain(asset: MerchantMedia) {
    setBusyId(asset.id); setNotice(null);
    try {
      await api.post(`/media/merchants/${merchantId}/main`, { media_id: asset.id });
      await onChanged();
      setNotice({ tone: 'ok', text: 'Main photo updated. The public site shows it within about 30 seconds.' });
    } catch (err) { setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Unable to set the main photo' }); }
    finally { setBusyId(null); }
  }

  async function upload(file: File) {
    if (!TYPES.includes(file.type)) { setNotice({ tone: 'error', text: 'Only JPEG, PNG or WebP images are supported' }); return; }
    if (file.size > 5 * 1024 * 1024) { setNotice({ tone: 'error', text: 'Maximum file size is 5 MB' }); return; }
    setUploading(true); setNotice(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Cannot read file'));
        reader.readAsDataURL(file);
      });
      // Always added to the gallery; it only becomes Main when the Merchant has no Main Photo yet, so existing images are never superseded.
      await api.post('/media/upload', { merchant_id: merchantId, filename: file.name, mime_type: file.type, size_bytes: file.size, base64_data: base64, action: 'add', slot: eligible.length ? 'gallery' : 'main', direct_publish: true });
      await onChanged();
      setNotice({ tone: 'ok', text: 'Picture added to the gallery.' });
    } catch (err) { setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Unable to upload media' }); }
    finally { setUploading(false); }
  }

  return <div data-testid="merchant-gallery">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-ink-muted">{eligible.length} {eligible.length === 1 ? 'picture' : 'pictures'} in the gallery{main && !hasExplicitMain ? ' · no main photo chosen, the first picture is used' : ''}</p>
      <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-control bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 aria-disabled:opacity-60" aria-disabled={uploading}>
        <Upload aria-hidden="true" className="size-4" />{uploading ? 'Uploading…' : 'Upload picture'}
        <input type="file" accept={TYPES.join(',')} disabled={uploading} className="hidden" data-testid="gallery-upload" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
      </label>
    </div>
    {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'} data-testid="gallery-notice" className={`mt-3 rounded-control px-3 py-2 text-sm ${notice.tone === 'error' ? 'bg-danger-50 text-danger-700' : 'bg-success-50 text-success-700'}`}>{notice.text}</p>}

    {eligible.length ? <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Merchant pictures">
      {eligible.map((asset) => { const isMain = asset.id === main?.id; return <li key={asset.id} data-testid="gallery-item" data-main={isMain} className={`overflow-hidden rounded-card border bg-surface ${isMain ? 'border-brand-600 ring-1 ring-brand-600' : 'border-line'}`}>
        <div className="relative"><Picture asset={asset} label={asset.original_filename || 'Merchant picture'} className="aspect-[4/3] w-full" />
          {isMain && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-white shadow-card"><Star aria-hidden="true" className="size-3" />Main photo</span>}</div>
        <div className="flex items-center justify-between gap-2 p-2">
          <span className="min-w-0 truncate text-xs text-ink-muted" title={asset.original_filename || asset.id}>{asset.original_filename || asset.id}</span>
          {isMain && hasExplicitMain ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-success-700"><Check aria-hidden="true" className="size-3.5" />Selected</span>
            : <button type="button" data-testid="set-main" disabled={busyId !== null} onClick={() => void setMain(asset)} className="min-h-9 shrink-0 rounded-control border border-line px-3 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-60">{busyId === asset.id ? 'Saving…' : 'Set as main'}</button>}
        </div>
      </li>; })}
    </ul> : <p className="mt-4 rounded-card bg-canvas p-6 text-center text-sm text-ink-muted">No pictures are linked to this merchant yet.</p>}

    {history.length > 0 && <details className="mt-4 text-sm text-ink-muted"><summary className="cursor-pointer font-semibold text-ink">History · {history.length} not currently published</summary>
      <ul className="mt-2 grid gap-1.5">{history.map((asset) => <li key={asset.id} className="flex flex-wrap justify-between gap-2 rounded-control bg-canvas px-3 py-2 text-xs"><span className="min-w-0 truncate">{asset.original_filename || asset.id}</span><span>{(asset.publication_status || 'unknown').replaceAll('_', ' ')}{asset.transfer_status && asset.transfer_status !== 'verified' ? ` · transfer ${asset.transfer_status}` : ''}</span></li>)}</ul></details>}
  </div>;
}
