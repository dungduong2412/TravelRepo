/**
 * Read-only preflight for the two owner-approved real-mail signup aliases (one Merchant, one Partner).
 *   railway run --service vno-api -- npx tsx tools/signup-alias-preflight.ts <merchant-alias> <partner-alias>
 * Changes nothing. It proves each alias is safe to add to the exact-recipient allowlist: well-formed single mailbox (no wildcard / domain entry),
 * distinct, not already allowlisted, no existing Auth user, and not a migrated V1 identity (checked by SHA-256 of the normalised address, as the hook does).
 * Output is masked and boolean; it never prints the allowlist, a key or a token.
 */
import { createHash } from 'node:crypto';

const mask = (e: string) => e.replace(/^(.{1,3}).*@/, '$1***@');
const sha = (e: string) => createHash('sha256').update(e.trim().toLocaleLowerCase('en-US')).digest('hex'); // importer normalisation
const SHAPE = /^[^\s@,;<>"*]+@[^\s@,;<>"*]+\.[^\s@,;<>"*]+$/;

async function main() {
  const [m, p] = process.argv.slice(2).map((v) => (v || '').trim().toLowerCase());
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; const base = process.env.SUPABASE_URL;
  if (!key || !base) throw new Error('run through `railway run --service vno-api -- ...` (needs SUPABASE_URL and the service key; neither is printed)');
  const allow = (process.env.AUTH_EMAIL_ALLOWLIST || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const authUsers: string[] = [];
  for (let page = 1; page < 20; page++) {
    const r = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers });
    if (!r.ok) throw new Error(`auth admin list failed: HTTP ${r.status}`);
    const users = ((await r.json()) as any).users ?? [];
    authUsers.push(...users.map((u: any) => String(u.email || '').toLowerCase()));
    if (users.length < 1000) break;
  }
  const checks: Array<[string, string, boolean, string]> = [];
  for (const [role, email] of [['merchant', m], ['partner', p]] as const) {
    const ok = SHAPE.test(email ?? '');
    checks.push([role, 'single well-formed mailbox (no wildcard or @domain entry)', ok, '']);
    if (!ok) continue;
    checks.push([role, 'not already on the allowlist', !allow.includes(email), '']);
    checks.push([role, 'no existing Auth user (fresh identity)', !authUsers.includes(email), '']);
    const r = await fetch(`${base}/rest/v1/legacy_identity_map?source_email_sha256=eq.${sha(email)}&select=auth_user_id&limit=1`, { headers });
    const rows = r.ok ? ((await r.json()) as any[]) : null;
    checks.push([role, 'not a migrated V1 identity (e-mail hash lookup)', rows !== null && rows.length === 0, rows === null ? `lookup failed HTTP ${r.status}` : '']);
  }
  checks.push(['both', 'the two aliases are different', !!m && !!p && m !== p, '']);
  let bad = 0;
  for (const [who, what, ok, note] of checks) { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${who}: ${what}${note ? ' (' + note + ')' : ''}`); }
  console.log(`aliases: merchant=${mask(m || '')} partner=${mask(p || '')}; current allowlist entries=${allow.length}; after adding=${allow.length + 2}`);
  console.log(bad ? 'PREFLIGHT FAILED: do not add these aliases' : 'PREFLIGHT OK: safe to add (apply only after the owner approves these exact addresses)');
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error('ERROR', String(e.message).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[JWT]')); process.exit(2); });
