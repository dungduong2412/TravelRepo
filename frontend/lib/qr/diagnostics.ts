import type { InAppKind, Os } from './environment';

/**
 * Scanner telemetry, so a camera problem on a phone nobody can hold (an in-app browser, an old iPhone) can be read from the server log.
 * Closed vocabulary only — the same list the API accepts. Never a payload, a code, an image, a URL, a name or an address.
 */
export type QrEvent =
  | 'page_open' | 'camera_support' | 'camera_start' | 'camera_started' | 'camera_error' | 'camera_stopped' | 'decode_ok' | 'decode_fail'
  | 'upload_selected' | 'upload_decoded' | 'upload_failed' | 'resolve_ok' | 'resolve_error' | 'fallback_shown' | 'manual_submit' | 'engine_ready' | 'engine_failed';
export type QrEventFields = Partial<{ source: 'camera' | 'upload' | 'capture' | 'manual'; inapp: InAppKind; os: Os; secure: boolean; media: boolean; err: string; engine: 'zxing' | 'jsqr'; ms: number; w: number; h: number; n: number; code: string }>;

export function newScanId(): string {
  try { return crypto.randomUUID().replace(/-/g, '').slice(0, 12); } catch { return Math.random().toString(16).slice(2, 14).padEnd(12, '0'); }
}

/** A DOMException / API code reduced to a short token the server accepts (`NotAllowedError`, `QR_UNSUPPORTED`, ...). */
export const safeToken = (value: unknown): string | undefined => {
  const v = String(value ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
  return v || undefined;
};

export function logQrEvent(cid: string, event: QrEvent, fields: QrEventFields = {}) {
  const base = process.env.NEXT_PUBLIC_API_URL || '';
  const body = { evt: 'qr_scan', cid, event, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
  try { console.info(JSON.stringify(body)); } catch { /* ignore */ }
  if (!base) return;
  try {
    void fetch(`${base.replace(/\/$/, '')}/qr/diagnostics`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
  } catch { /* diagnostics must never break scanning */ }
}
