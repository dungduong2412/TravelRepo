"use client";
/* Signed private Storage URLs are short-lived and cannot use a stable Next image loader. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from 'react';
import { ImageOff, Store } from 'lucide-react';
import { api } from '../../lib/api';

type Source = { id: string; thumb_url: string | null } | null | undefined;

/**
 * Square thumbnail for the Admin list. Tries the transformed thumbnail first; if it is missing or fails to load (Storage transform
 * unavailable, expired signature, deleted object) it retries once with the authorised original, then shows a neutral placeholder.
 */
export function MerchantThumb({ image, className = 'size-14' }: { image: Source; className?: string }) {
  const [src, setSrc] = useState<string | null>(image?.thumb_url ?? null);
  const [stage, setStage] = useState<'thumb' | 'original' | 'failed'>(image?.thumb_url ? 'thumb' : image ? 'original' : 'failed');

  const loadOriginal = async (id: string) => {
    try {
      const signed = await api.get(`/media/${id}/signed-url`);
      const url = signed?.signedUrl || signed?.signed_url;
      if (url) { setSrc(url); setStage('original'); return; }
    } catch { /* fall through to the placeholder */ }
    setStage('failed');
  };
  useEffect(() => { if (image && !image.thumb_url) void loadOriginal(image.id); }, [image]);

  if (!image || stage === 'failed' || !src) {
    return <div aria-hidden="true" data-testid="merchant-thumb-empty" className={`${className} grid shrink-0 place-items-center rounded-control bg-canvas text-ink-muted`}>{image ? <ImageOff className="size-5" /> : <Store className="size-5" />}</div>;
  }
  return <img src={src} alt="" loading="lazy" decoding="async" data-testid="merchant-thumb" className={`${className} shrink-0 rounded-control bg-canvas object-cover`}
    onError={() => { if (stage === 'thumb') void loadOriginal(image.id); else setStage('failed'); }} />;
}
