import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const fx = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const SB = env.SUPABASE_URL, API = 'http://localhost:3100';
if (!['127.0.0.1', 'localhost'].includes(new URL(SB).hostname)) throw new Error('local only');
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const login = async (email) => (await j(await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: fx.password }) }))).access_token;
const api = async (token, method, path, body) => { const r = await fetch(`${API}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' }); return { status: r.status, body: await j(r), headers: r.headers }; };
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) process.exitCode = 1; };
const admin = await login(fx.users.admin), owner = await login(fx.users.owner), other = await login(fx.users.otherOwner);
const A = fx.merchants.a.id, B = fx.merchants.b.id, C = fx.merchants.c.id; const [a1, a2, a3] = fx.media.a; const [b1] = fx.media.b;
const dir = async (q = '') => (await api(admin, 'GET', `/merchants/admin-directory?page_size=100&search=${encodeURIComponent(q)}`)).body.items;
const publicOf = async (id) => (await api(null, 'GET', `/public/merchants/${id}`)).body;
const heroIds = async () => (await api(admin, 'GET', `/merchants/${A}/operational-detail`)).body.media.filter((m) => m.is_hero).map((m) => m.id);

// ---- READ-ONLY on real migrated data: admin Main Photo == public Main Photo for every published Merchant
const all = []; for (let page = 1; ; page++) { const r = (await api(admin, 'GET', `/merchants/admin-directory?page=${page}&page_size=100&verified=true`)).body; all.push(...r.items); if (page >= r.page_count) break; }
const pub = []; for (let page = 1; ; page++) { const r = (await api(null, 'GET', `/public/merchants?page=${page}&page_size=60`)).body; pub.push(...r.items); if (pub.length >= r.total) break; }
const adminMain = new Map(all.map((m) => [m.merchant_system_id, m.main_image?.id ?? null]));
const mismatches = pub.filter((p) => (p.image_url ? p.image_url.split('/').pop() : null) !== (adminMain.get(p.id) ?? null));
check('R1 admin Main Photo equals public card image for every published merchant', mismatches.length === 0, `published=${pub.length} mismatches=${mismatches.length}`);
const withImg = all.filter((m) => m.main_image); const realWithThumb = withImg.filter((m) => m.main_image.thumb_url).length;
check('R2 directory carries main_image + categories + location data without owner secrets', all.length > 100 && withImg.length > 100 && all.every((m) => !('owner_password' in m)), `merchants=${all.length} withImage=${withImg.length} thumbUrls=${realWithThumb}`);
const noHero = (await api(admin, 'GET', '/merchants/admin-directory?page_size=1')).status;
check('R3 directory still honours search/filter/pagination', (await dir('UXIMG')).length === 3 && noHero === 200);

// ---- initial state of synthetic merchant A
check('S0 A starts with exactly one Main Photo (the first upload) and 3 effective images', (await heroIds()).join() === a1);
const before = (await api(admin, 'GET', `/merchants/${A}/operational-detail`)).body.media.map((m) => ({ id: m.id, path: m.original_filename, order: m.display_order, st: m.publication_status }));
let pa = await publicOf(A); check('S1 public detail hero == first uploaded image', pa.gallery[0].id === a1 && pa.image_url.endsWith(a1));

// ---- RBAC / tenant isolation / eligibility
check('A1 anonymous cannot set main (401)', (await api(null, 'POST', `/media/merchants/${A}/main`, { media_id: a2 })).status === 401);
check('A2 merchant owner of A cannot set main (403)', (await api(owner, 'POST', `/media/merchants/${A}/main`, { media_id: a2 })).status === 403);
check('A3 merchant owner of B cannot set main on A (403)', (await api(other, 'POST', `/media/merchants/${A}/main`, { media_id: a2 })).status === 403);
check('A4 image of B cannot be promoted under A (404), A unchanged', (await api(admin, 'POST', `/media/merchants/${A}/main`, { media_id: b1 })).status === 404 && (await heroIds()).join() === a1);
check('A5 image of A cannot be promoted under B (404)', (await api(admin, 'POST', `/media/merchants/${B}/main`, { media_id: a2 })).status === 404);
check('A6 malformed ids rejected (400)', (await api(admin, 'POST', `/media/merchants/not-a-uuid/main`, { media_id: a2 })).status === 400 && (await api(admin, 'POST', `/media/merchants/${A}/main`, { media_id: 'x' })).status === 400 && (await api(admin, 'POST', `/media/merchants/${A}/main`, { media_id: a2, extra: 1 })).status === 400);
check('A7 owner media listing is untouched by set-main (owner sees only own media)', (await api(owner, 'GET', '/media/me')).body.every((m) => m.merchant_id === A));

// ---- set main, persistence, public propagation, gallery intact
const set = await api(admin, 'POST', `/media/merchants/${A}/main`, { media_id: a3 });
check('M1 admin sets an existing gallery image as main', set.status === 201 && set.body.changed === true && set.body.main_media_id === a3, JSON.stringify(set.body));
check('M2 exactly one Main Photo after the change, and it persists on re-read', (await heroIds()).join() === a3);
const after = (await api(admin, 'GET', `/merchants/${A}/operational-detail`)).body.media.map((m) => ({ id: m.id, path: m.original_filename, order: m.display_order, st: m.publication_status }));
check('M3 gallery intact: same images, filenames, order and publication status; previous main remains in the gallery', JSON.stringify(after) === JSON.stringify(before) && after.find((m) => m.id === a1).st === 'approved');
check('M4 admin directory thumbnail switches to the new main', (await dir('UXIMG Alpha'))[0].main_image.id === a3);
await new Promise((r) => setTimeout(r, 31_000)); // public catalog snapshot TTL is 30 s
pa = await publicOf(A); const listing = (await api(null, 'GET', `/public/merchants?q=${encodeURIComponent('UXIMG Alpha')}`)).body.items.find((x) => x.id === A);
check('M5 public Merchant Details hero uses the selected image and keeps the full gallery', pa.gallery[0].id === a3 && pa.gallery.length === 3 && pa.gallery.map((g) => g.id).sort().join() === [a1, a2, a3].sort().join());
check('M6 public landing card uses the same image as the details hero', listing?.image_url === `/public/media/${a3}` && pa.image_url === listing.image_url);
const img = await api(null, 'GET', `/public/media/${a3}?size=card`); check('M7 selected image is served (redirect to signed object)', [302, 200].includes(img.status));
check('M8 re-selecting the current main is a no-op', (await api(admin, 'POST', `/media/merchants/${A}/main`, { media_id: a3 })).body.changed === false && (await heroIds()).join() === a3);
check('M9 other Merchants unaffected', (await api(admin, 'GET', `/merchants/${B}/operational-detail`)).body.media.filter((m) => m.is_hero).map((m) => m.id).join() === b1);

// ---- governed lifecycle still works around the new field
const pend = await api(admin, 'POST', '/media/requests/change', { action: 'remove', target_media_id: a2 });
check('L1 a pending change on an image blocks promoting it (409)', pend.status === 201 && (await api(admin, 'POST', `/media/merchants/${A}/main`, { media_id: a2 })).status === 409);
await api(admin, 'DELETE', `/media/requests/${pend.body.id}`);
const rej = await api(admin, 'POST', '/media/upload', { merchant_id: A, filename: 'pending.png', mime_type: 'image/png', size_bytes: 70, base64_data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', action: 'add', slot: 'gallery' });
const pendingId = rej.body.id; check('L2 a pending (unapproved) image cannot become main (400)', rej.status === 201 && (await api(admin, 'POST', `/media/merchants/${A}/main`, { media_id: pendingId })).status === 400);
await api(admin, 'DELETE', `/media/requests/${rej.body.approval_request.id}`);
check('L3 a Merchant with no photos has no main image anywhere', (await dir('UXIMG Charlie'))[0].main_image === null && (await publicOf(C)).image_url === null);
const audit = await fetch(`${SB}/rest/v1/audit_events?action=eq.media.main_set&entity_id=eq.${A}&select=actor_auth_user_id,details`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }).then(j);
check('L4 audited with actor and previous main', audit.length === 1 && audit[0].details.previous_main_media_ids[0] === a1);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
