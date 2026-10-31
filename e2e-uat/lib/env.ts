import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
export const EVIDENCE_DIR = path.join(ROOT, 'evidence');

// Minimal .env loader (no extra dependency). Process env wins over the file.
export function loadEnvFile() {
  const file = path.join(ROOT, '.env.uat.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export const UAT = {
  web: 'vno-web-uat.up.railway.app',
  api: 'vno-api-uat.up.railway.app',
  supabaseRef: 'hsezyogfxgnkpweoqqny',
} as const;

export const MERCHANT_TO_CORRECT = { code: 'UAT-M-D5-20261016-A4722D', id: '9ea93d89-a8a1-4c11-8b07-4c3d8eb590da' } as const;

export type Role = 'admin' | 'merchant' | 'partner' | 'outsider';

export function config() {
  loadEnvFile();
  const web = process.env.E2E_WEB_URL || `https://${UAT.web}`;
  const api = process.env.E2E_API_URL || `https://${UAT.api}`;
  const supabase = process.env.E2E_SUPABASE_URL || `https://${UAT.supabaseRef}.supabase.co`;
  // Explicit UAT-only target verification: exact hosts, https only.
  const must = (u: string, host: string) => { const p = new URL(u); if (p.protocol !== 'https:' || p.hostname !== host) throw new Error(`REFUSING TO RUN: ${p.hostname} is not the approved UAT host ${host}`); return p.origin; };
  return {
    web: must(web, UAT.web),
    api: must(api, UAT.api),
    supabase: must(supabase, `${UAT.supabaseRef}.supabase.co`),
    anonKey: process.env.E2E_SUPABASE_ANON_KEY || '',
  };
}

export type Cred = { email: string; password: string };
const ACTIVE: Partial<Record<Role, Cred>> = {};
export function setActive(role: Role, c: Cred) { ACTIVE[role] = c; process.env[`E2E_ACTIVE_${role.toUpperCase()}_PW`] = c.password; }

// Pool of pre-provisioned, verified, UNCLAIMED identities for first-time claim runs.
// File: .auth/identity-pool.json  →  { "merchant": [{"email":"…","password":"…"}], "partner": [...] }
// Consumed identities are remembered in .auth/consumed.json so a retry never reuses a claimed one.
const AUTH_DIR = path.join(ROOT, '.auth');
const readJson = (f: string, d: any) => { try { return JSON.parse(fs.readFileSync(path.join(AUTH_DIR, f), 'utf8')); } catch { return d; } };
export function poolFor(role: 'merchant' | 'partner'): Cred[] {
  const pool: Cred[] = readJson('identity-pool.json', {})[role] ?? [];
  const used: string[] = readJson('consumed.json', []);
  return pool.filter((c) => !used.includes(c.email.toLowerCase()));
}
export function markConsumed(email: string) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const used: string[] = readJson('consumed.json', []); used.push(email.toLowerCase());
  fs.writeFileSync(path.join(AUTH_DIR, 'consumed.json'), JSON.stringify([...new Set(used)], null, 2));
}

export function creds(role: Role): Cred | null {
  if (ACTIVE[role]) return ACTIVE[role]!;
  loadEnvFile();
  const k = role.toUpperCase();
  const email = process.env[`E2E_${k}_EMAIL`]; const password = process.env[`E2E_${k}_PASSWORD`];
  return email && password ? { email, password } : null;
}

// Unique per run; reused by retries within the same invocation.
export const RUN_ID = process.env.E2E_RUN_ID || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
