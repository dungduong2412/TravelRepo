/**
 * Mirror of backend/src/modules/qr/partner-qr-payload.ts, used ONLY to give instant feedback on the phone (a value that cannot possibly be a Partner
 * code is explained without a round trip). The API re-parses everything and is authoritative; keep the two in step (both are self-tested on the same matrix).
 */
export type ParsedPartnerQr = { ok: true; code: string; form: 'code' | 'url' } | { ok: false; reason: 'empty' | 'unsupported' };

const INVISIBLE = /[​-‍⁠﻿­‪-‮⁦-⁩]/g;
const ODD_SPACES = /[   -   　]/g;
const CONTROLS = /[\u0000-\u001F\u007F]/g;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const SCHEMELESS = /^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d{1,5})?\/\S+$/i;

export const normalisePayload = (raw: string) => raw.normalize('NFKC').replace(INVISIBLE, '').replace(ODD_SPACES, ' ').replace(CONTROLS, ' ').trim();

export function parsePartnerQrPayload(raw: unknown): ParsedPartnerQr {
  if (typeof raw !== 'string') return { ok: false, reason: 'unsupported' };
  const text = normalisePayload(raw);
  if (!text) return { ok: false, reason: 'empty' };
  if (CODE.test(text)) return { ok: true, code: text, form: 'code' };
  let candidate = text;
  if (!SCHEME.test(candidate)) {
    if (!SCHEMELESS.test(candidate)) return { ok: false, reason: 'unsupported' };
    candidate = `https://${candidate}`;
  }
  let url: URL;
  try { url = new URL(candidate); } catch { return { ok: false, reason: 'unsupported' }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'unsupported' };
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || parts[parts.length - 2].toLowerCase() !== 'c') return { ok: false, reason: 'unsupported' };
  let code: string;
  try { code = decodeURIComponent(parts[parts.length - 1]).trim(); } catch { return { ok: false, reason: 'unsupported' }; }
  return CODE.test(code) ? { ok: true, code, form: 'url' } : { ok: false, reason: 'unsupported' };
}
