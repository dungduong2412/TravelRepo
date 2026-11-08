import { decodeFrame, DecodeOutcome } from './engine';

/** Decoding a photo or screenshot a person chose (or took with the phone camera app). Browser-only. */
export type ImageDecode = { outcome: DecodeOutcome | null; width: number; height: number; attempts: number; ms: number; reason?: 'unreadable' };

type Source = ImageBitmap | HTMLImageElement;
const dims = (s: Source) => ('naturalWidth' in s ? { w: s.naturalWidth, h: s.naturalHeight } : { w: s.width, h: s.height });

async function loadSource(file: File): Promise<Source> {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* older Safari: no options / no support */ }
    try { return await createImageBitmap(file); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.decoding = 'async';
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('image')); img.src = url; });
    return img;
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Photos are decoded at a bounded size, never at full resolution: a 12-megapixel iPhone photo is first reduced (1600 px, then 1000 px, then 2400 px),
 * which keeps the page responsive and is what makes a screen photograph readable. The first size that yields a code wins.
 */
export async function decodeImageFile(file: File): Promise<ImageDecode> {
  const t0 = performance.now();
  let source: Source;
  try { source = await loadSource(file); } catch { return { outcome: null, width: 0, height: 0, attempts: 0, ms: Math.round(performance.now() - t0), reason: 'unreadable' }; }
  const { w, h } = dims(source);
  let attempts = 0;
  for (const maxSide of [1600, 1000, 2400]) {
    const k = Math.min(1, maxSide / Math.max(w, h)); const cw = Math.max(1, Math.round(w * k)); const ch = Math.max(1, Math.round(h * k));
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) break;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(source as CanvasImageSource, 0, 0, cw, ch);
    const image = ctx.getImageData(0, 0, cw, ch); attempts += 1;
    const outcome = await decodeFrame({ data: image.data, width: cw, height: ch }, image);
    canvas.width = 0; canvas.height = 0; // release the backing store promptly (iOS caps total canvas memory)
    if (outcome) { if ('close' in source) source.close(); return { outcome, width: w, height: h, attempts, ms: Math.round(performance.now() - t0) }; }
    if (k === 1) break; // the image is small: bigger sizes would be identical
  }
  if ('close' in source) source.close();
  return { outcome: null, width: w, height: h, attempts, ms: Math.round(performance.now() - t0) };
}
