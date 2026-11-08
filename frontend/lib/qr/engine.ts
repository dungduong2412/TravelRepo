import jsQR from 'jsqr';

/**
 * QR decoding for phone cameras and photos.
 *
 * Primary engine: ZXing (WebAssembly). It reads blurred, noisy, tilted and glare-washed codes (what another phone's screen looks like through a camera)
 * in a few milliseconds. The previous engine (jsQR alone) failed on those frames AND took ~0.5 s of main-thread time per failed 720p frame and ~35 s for a
 * noisy 12-megapixel photo — on a phone that is a frozen page and then "no QR found". jsQR stays only as a fallback for environments where WebAssembly
 * cannot be loaded, and it is never given more than ~1000 px.
 * The WebAssembly file is bundled as a static asset of THIS site (never fetched from a third-party CDN).
 */
export type Frame = { data: Uint8ClampedArray; width: number; height: number };
export type EngineName = 'zxing' | 'jsqr';
export type DecodeOutcome = { text: string; engine: EngineName; ms: number };

type ZXing = typeof import('zxing-wasm/reader');
let loading: Promise<{ name: EngineName; zxing: ZXing | null }> | null = null;

/** Loads (once) the best engine that works here. `bundledWasm:false` is for Node tests, where the library finds its own file. */
export function loadEngine(opts: { bundledWasm?: boolean } = {}): Promise<{ name: EngineName; zxing: ZXing | null }> {
  loading ??= (async () => {
    try {
      const mod = await import('zxing-wasm/reader');
      if (opts.bundledWasm !== false) {
        const wasm = new URL('../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url).href;
        await mod.prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm : prefix + path) }, fireImmediately: true });
      } else {
        await mod.prepareZXingModule({ fireImmediately: true });
      }
      return { name: 'zxing' as const, zxing: mod };
    } catch {
      return { name: 'jsqr' as const, zxing: null };
    }
  })();
  return loading;
}

/** Test seam: forget the loaded engine. */
export function resetEngineForTests() { loading = null; }

/** Area-average downscale so the longest side is at most `maxSide` (cheap, and keeps module edges intact enough to decode). */
export function downscale(frame: Frame, maxSide: number): Frame {
  const longest = Math.max(frame.width, frame.height);
  if (longest <= maxSide) return frame;
  const k = maxSide / longest; const w = Math.max(1, Math.round(frame.width * k)); const h = Math.max(1, Math.round(frame.height * k));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.floor(y / k); const y1 = Math.min(frame.height, Math.max(y0 + 1, Math.ceil((y + 1) / k)));
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.floor(x / k); const x1 = Math.min(frame.width, Math.max(x0 + 1, Math.ceil((x + 1) / k)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) { const i = (yy * frame.width + xx) * 4; r += frame.data[i]; g += frame.data[i + 1]; b += frame.data[i + 2]; n += 1; }
      const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** The fallback engine on its own (also used directly by tests). Never handed more than ~1000 px. */
export function decodeWithJsQr(frame: Frame): DecodeOutcome | null {
  const t0 = performance.now();
  const small = downscale(frame, 1000);
  const hit = jsQR(small.data, small.width, small.height, { inversionAttempts: 'attemptBoth' });
  return hit?.data ? { text: hit.data, engine: 'jsqr', ms: Math.round(performance.now() - t0) } : null;
}

/** One decode attempt on one frame. Returns null when no code is found (never throws for "not found"). */
export async function decodeFrame(frame: Frame, imageData?: ImageData): Promise<DecodeOutcome | null> {
  const t0 = performance.now();
  const engine = await loadEngine();
  if (engine.zxing) {
    try {
      const input = imageData ?? ({ data: frame.data, width: frame.width, height: frame.height, colorSpace: 'srgb' } as unknown as ImageData);
      const [hit] = await engine.zxing.readBarcodes(input, { formats: ['QRCode'], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 1 });
      if (hit?.text && hit.isValid !== false) return { text: hit.text, engine: 'zxing', ms: Math.round(performance.now() - t0) };
      return null;
    } catch { /* the wasm engine failed on this frame: fall through to jsQR once */ }
  }
  const small = downscale(frame, 1000);
  const hit = jsQR(small.data, small.width, small.height, { inversionAttempts: 'attemptBoth' });
  return hit?.data ? { text: hit.data, engine: 'jsqr', ms: Math.round(performance.now() - t0) } : null;
}
