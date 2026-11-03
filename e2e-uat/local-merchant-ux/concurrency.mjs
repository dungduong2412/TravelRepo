import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const fx = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')); const SB = env.SUPABASE_URL;
if (!['127.0.0.1', 'localhost'].includes(new URL(SB).hostname)) throw new Error('local only');
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const token = (await j(await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: fx.users.admin, password: fx.password }) }))).access_token;
const A = fx.merchants.a.id, ids = fx.media.a;
const heroes = async () => (await j(await fetch(`${SB}/rest/v1/media_assets?merchant_id=eq.${A}&is_hero=eq.true&publication_status=in.(legacy_effective,preexisting_effective,approved)&select=id`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }))).map((r) => r.id);
let bad = 0, zero = 0, rounds = 6;
for (let r = 0; r < rounds; r++) {
  const calls = Array.from({ length: 12 }, (_, i) => fetch(`http://localhost:3100/media/merchants/${A}/main`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ media_id: ids[i % 3] }) }).then((x) => x.status));
  const codes = await Promise.all(calls); const h = await heroes();
  if (h.length > 1) bad++; if (h.length === 0) zero++;
  console.log(`round ${r + 1}: statuses=${[...new Set(codes)].join(',')} heroes=${h.length}`);
}
const media = (await j(await fetch(`${SB}/rest/v1/media_assets?merchant_id=eq.${A}&select=id,publication_status`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } })));
console.log(JSON.stringify({ roundsWithMultipleHeroes: bad, roundsWithZeroHeroes: zero, allStillEffective: media.every((m) => m.publication_status === 'approved'), images: media.length }));
process.exitCode = bad || zero || media.length !== 3 ? 1 : 0;
