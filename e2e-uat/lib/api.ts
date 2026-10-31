import { config, creds, Cred, Role, setActive } from './env';
import { redact } from './redact';

let anonCache = '';
// The anon key is public by design (it ships in the web bundle). Use env if set, else discover it.
export async function anonKey(): Promise<string> {
  const c = config();
  if (c.anonKey) return c.anonKey;
  if (anonCache) return anonCache;
  const html = await (await fetch(`${c.web}/login`)).text();
  for (const src of new Set(html.match(/\/_next\/static\/[^"']+\.js/g) ?? [])) {
    const js = await (await fetch(c.web + src)).text();
    const m = js.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)?.find((t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { return false; } });
    if (m) { process.env.E2E_SUPABASE_ANON_KEY = m; return (anonCache = m); }
  }
  throw new Error('anon key not found in web bundle; set E2E_SUPABASE_ANON_KEY');
}

const sessions = new Map<Role, string>();
// Supported Supabase Auth password login. No service-role key, no minted sessions.
export async function login(role: Role): Promise<string | null> {
  if (sessions.has(role)) return sessions.get(role)!;
  const c = creds(role); if (!c) return null;
  const r = await fetch(`${config().supabase}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: await anonKey(), 'Content-Type': 'application/json' }, body: JSON.stringify(c),
  });
  if (!r.ok) throw new Error(`Auth login failed for ${role}: HTTP ${r.status}`);
  const token = (await r.json()).access_token as string;
  process.env[`E2E_TOKEN_${role.toUpperCase()}`] = token; // registered so redact() masks it
  sessions.set(role, token);
  return token;
}

export type ApiResult<T = any> = { status: number; body: T };
export async function api<T = any>(role: Role | null, method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const token = role ? await login(role) : null;
  if (role && !token) throw new Error(`no credentials for ${role}`);
  const r = await fetch(config().api + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text(); let parsed: any = text; try { parsed = JSON.parse(text); } catch { /* keep text */ }
  return { status: r.status, body: parsed };
}

export const hasCreds = (...roles: Role[]) => roles.every((r) => !!creds(r));
export function mask(v: unknown) { return redact(v); }

// Probe a candidate identity through the supported password login. 'unclaimed' = verified Auth user with no application profile.
export async function probeIdentity(c: Cred): Promise<'unclaimed' | 'claimed' | 'invalid'> {
  const r = await fetch(`${config().supabase}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: await anonKey(), 'Content-Type': 'application/json' }, body: JSON.stringify(c) });
  if (!r.ok) return 'invalid';
  const token = (await r.json()).access_token as string; process.env.E2E_TOKEN_PROBE = token;
  const me = await fetch(`${config().api}/user-profiles/me`, { headers: { Authorization: `Bearer ${token}` } });
  const body: any = await me.json().catch(() => null);
  return me.ok && body?.role ? 'claimed' : 'unclaimed';
}
export function useIdentity(role: Role, c: Cred) { sessions.delete(role); setActive(role, c); }
