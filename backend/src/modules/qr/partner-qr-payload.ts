/**
 * What a Partner QR (or a pasted / typed value) can contain, and how it is turned into a Partner code.
 *
 *   https://<any host>/c/COL-XXXXXXXXXXXXXXXX      the canonical QR URL (host varies by environment and by print run, so it is NOT checked)
 *   <host>/c/COL-…                                  the same without a scheme (typed or pasted)
 *   COL-XXXXXXXXXXXXXXXX                            a bare code (V1 / imported Partner cards carry the code directly)
 *
 * Messaging apps (Zalo, Messenger, ...) and on-screen keyboards add invisible characters, non-breaking spaces and change case; those are
 * normalised here, so a value that LOOKS right to a person is accepted. Anything else is "unsupported" — it is never sent to a lookup.
 * The web app carries a mirror of this function (frontend/lib/qr/payload.ts) only to give instant feedback; this one is authoritative.
 */
export type ParsedPartnerQr =
  | { ok: true; code: string; form: 'code' | 'url' }
  | { ok: false; reason: 'empty' | 'unsupported' };

const INVISIBLE = /[​-‍⁠﻿­‪-‮⁦-⁩]/g;
const ODD_SPACES = /[   -   　]/g;
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u001F\u007F]/g;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const SCHEMELESS = /^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d{1,5})?\/\S+$/i;

export function normalisePayload(raw: string): string {
  return raw.normalize('NFKC').replace(INVISIBLE, '').replace(ODD_SPACES, ' ').replace(CONTROLS, ' ').trim();
}

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
