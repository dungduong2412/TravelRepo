import { createHash } from 'node:crypto';

/**
 * In-memory sliding-window limiter for the few PUBLIC endpoints (partner registration, activation, link resend).
 * One API instance runs per environment, so process memory is the right scope; the window also bounds memory (expired hits are dropped, and the
 * key table is capped). Keys are hashed, so neither e-mail addresses nor IPs are held in clear text.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now: () => number = Date.now, private readonly maxKeys = 10_000) {}

  /** Records an attempt and returns true if it is within the limit; false (and nothing recorded) when the limit is already used up. */
  take(rawKey: string): boolean {
    const key = createHash('sha256').update(rawKey).digest('base64url').slice(0, 24);
    const t = this.now();
    const live = (this.hits.get(key) || []).filter((h) => t - h < this.windowMs);
    if (live.length >= this.limit) { this.hits.set(key, live); return false; }
    live.push(t);
    this.hits.set(key, live);
    if (this.hits.size > this.maxKeys) this.sweep(t);
    return true;
  }

  private sweep(t: number) {
    for (const [k, v] of this.hits) if (!v.some((h) => t - h < this.windowMs)) this.hits.delete(k);
    // Still too many live keys (a flood): forget the oldest half rather than grow without bound.
    if (this.hits.size > this.maxKeys) [...this.hits.keys()].slice(0, Math.floor(this.hits.size / 2)).forEach((k) => this.hits.delete(k));
  }
}

/** Client address as seen by the platform edge. The right-most X-Forwarded-For entry is the one the trusted proxy appended; earlier ones are client-supplied. */
export function clientIp(req: { headers?: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } }): string {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const real = first(req.headers?.['x-real-ip'])?.trim();
  if (real) return real;
  const xff = first(req.headers?.['x-forwarded-for']);
  if (xff) { const parts = xff.split(',').map((p) => p.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
