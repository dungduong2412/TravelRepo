// Synthetic fixtures for the LOCAL drill stack only (refuses any non-loopback target). Prefix: UXIMG.
import zlib from 'node:zlib';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const SB = env.SUPABASE_URL, API = 'http://localhost:3100';
if (!['127.0.0.1', 'localhost'].includes(new URL(SB).hostname)) throw new Error('local only');
const crc = (b) => { let c, r = ~0; for (let n = 0; n < b.length; n++) { c = (r ^ b[n]) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; r = (r >>> 8) ^ c; } return ~r >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const png = (rgb, w = 640, h = 480) => { const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, (_, x) => [Math.min(255, rgb[0] + (x >> 4)), rgb[1], rgb[2]]).flat())]); const raw = Buffer.concat(Array.from({ length: h }, () => row)); const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); };
const j = async (res) => { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } };
const sb = (path, init = {}, key = env.SUPABASE_SERVICE_ROLE_KEY) => fetch(`${SB}${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) } });
const PW = 'Local-Only-Ux!42';
async function user(email) {
  const res = await sb('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: PW, email_confirm: true }) });
  const body = await j(res); if (!body.id) throw new Error(`user ${email}: ${JSON.stringify(body)}`); return body.id;
}
async function login(email) { const r = await j(await sb('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password: PW }) }, env.SUPABASE_ANON_KEY)); return r.access_token; }
const api = async (token, method, path, body) => { const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await j(r) }; };

const out = { password: PW, users: {}, merchants: {} };
const adminId = await user('uximg-admin@local.invalid');
const ownerId = await user('uximg-owner@local.invalid');
const partnerOwner = await user('uximg-other-owner@local.invalid');
const profile = (user_id, email, role, extra = {}) => sb('/rest/v1/user_profiles', { method: 'POST', body: JSON.stringify({ user_id, email, role, user_profiles_status: 'active', full_name: `UXIMG ${role}`, ...extra }) });
const rAdmin = await profile(adminId, 'uximg-admin@local.invalid', 'admin'); if (!rAdmin.ok) throw new Error(await rAdmin.text());
const admin = await login('uximg-admin@local.invalid');
const cats = await api(admin, 'GET', '/categories');
const mk = async (key, name, extra = {}) => {
  const c = await api(admin, 'POST', '/merchants/admin', { owner_email: `uximg-${key}@local.invalid`, merchant_name: name, merchant_description: `Synthetic merchant ${name} for the Merchant Management UX test.`, new_address_line: '1 Test Street', new_address_ward: 'Ward 1', new_address_city: 'Ho Chi Minh City', category_ids: cats.body[0] ? [cats.body[0].id] : undefined, ...extra });
  if (c.status >= 300) throw new Error(`create ${key}: ${JSON.stringify(c.body)}`);
  const id = c.body.merchant_system_id;
  const v = await api(admin, 'PATCH', `/merchants/${id}/admin`, { merchant_verified: true, merchants_status: 'active', merchant_discount_type: 'percentage', merchant_discount_value: '0.1' });
  if (v.status >= 300) throw new Error(`verify ${key}: ${JSON.stringify(v.body)}`);
  out.merchants[key] = { id, name, code: c.body.merchant_code };
  return id;
};
const A = await mk('a', 'UXIMG Alpha Bistro With A Very Long Merchant Name That Must Truncate Cleanly On One Line');
const B = await mk('b', 'UXIMG Bravo Cafe');
const C = await mk('c', 'UXIMG Charlie No Photos');
await sb('/rest/v1/user_profiles', { method: 'POST', body: JSON.stringify({ user_id: ownerId, email: 'uximg-owner@local.invalid', role: 'merchant', user_profiles_status: 'active', merchant_id: A, full_name: 'UXIMG owner A' }) });
await sb('/rest/v1/user_profiles', { method: 'POST', body: JSON.stringify({ user_id: partnerOwner, email: 'uximg-other-owner@local.invalid', role: 'merchant', user_profiles_status: 'active', merchant_id: B, full_name: 'UXIMG owner B' }) });
const up = async (merchant, name, rgb, slot) => { const b = png(rgb); const r = await api(admin, 'POST', '/media/upload', { merchant_id: merchant, filename: name, mime_type: 'image/png', size_bytes: b.length, base64_data: b.toString('base64'), action: 'add', slot, direct_publish: true }); if (r.status >= 300) throw new Error(`upload ${name}: ${JSON.stringify(r.body)}`); return r.body.id; };
out.media = { a: [], b: [] };
out.media.a.push(await up(A, 'alpha-red.png', [200, 40, 50], 'main'));
out.media.a.push(await up(A, 'alpha-green.png', [40, 170, 80], 'gallery'));
out.media.a.push(await up(A, 'alpha-blue.png', [40, 90, 200], 'gallery'));
out.media.b.push(await up(B, 'bravo-orange.png', [240, 150, 30], 'main'));
out.users = { admin: 'uximg-admin@local.invalid', owner: 'uximg-owner@local.invalid', otherOwner: 'uximg-other-owner@local.invalid' };
out.userIds = { adminId, ownerId, partnerOwner };
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 2));
console.log(JSON.stringify({ merchants: out.merchants, media: out.media }, null, 1));
