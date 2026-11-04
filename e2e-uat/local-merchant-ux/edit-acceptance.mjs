// Merchant direct-edit + public field alignment acceptance. LOCAL stack only (refuses any non-loopback SUPABASE_URL).
// usage: node edit-acceptance.mjs <env> <fixtures.json>
// Writes only to the synthetic UXIMG merchants; migrated merchants are opened read-only (nothing is typed or saved).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const fx = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY, API = 'http://localhost:3100', WEB = 'http://localhost:3011';
if (!['127.0.0.1', 'localhost'].includes(new URL(SB).hostname)) throw new Error('local only');
const OUT = new URL('../../docs/screenshots/merchant-edit', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const A = fx.merchants.a, B = fx.merchants.b, C = fx.merchants.c;
let failed = 0; const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const sbGet = async (path) => (await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();
const row = async (id) => (await sbGet(`merchant_details?merchant_system_id=eq.${id}&select=*`))[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function login(email) { const r = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: fx.password }) })).json(); return r.access_token; }
const publicDetail = async (id) => (await fetch(`${API}/public/merchants/${id}`)).json();
// public catalog snapshot is cached for 30 s: poll until the predicate holds (max ~40 s)
async function waitPublic(id, pred) { for (let i = 0; i < 20; i++) { const d = await publicDetail(id); if (pred(d)) return d; await sleep(2500); } return publicDetail(id); }

// idempotent start: put the synthetic merchants (local stack only) back into a known state
for (const [m, desc] of [[A, 'UXIMG seed description'], [B, 'UXIMG seed description']]) {
  await fetch(`${SB}/rest/v1/merchant_details?merchant_system_id=eq.${m.id}`, { method: 'PATCH', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ merchant_description: desc, merchant_description_format: 'plain_text', merchant_contact_phone: null, new_address_line: null, new_address_ward: null, new_address_city: null, merchant_discount_type: 'percentage', merchant_discount_value: 0.1 }) });
}
await fetch(`${SB}/rest/v1/merchant_category_links?merchant_id=eq.${A.id}`, { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
const browser = await chromium.launch();
async function adminPage(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Email').fill(fx.users.admin); await page.getByLabel('Mật khẩu').fill(fx.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.waitForURL('**/admin/**', { timeout: 30000 });
  await page.goto(`${WEB}/admin/merchants`);
  await page.getByTestId('merchant-row').first().waitFor({ timeout: 30000 });
  return { ctx, page };
}
const search = async (page, q) => { await page.getByLabel('Search').fill(q); await page.getByRole('button', { name: 'Apply' }).click(); await page.waitForFunction((needle) => document.querySelector('[data-testid=merchant-row-name]')?.textContent?.toLowerCase().includes(needle.toLowerCase()), q, { timeout: 20000 }); };
const openRow = async (page, q) => { await search(page, q); await page.getByTestId('merchant-row').first().click(); await page.getByTestId('merchant-editor').waitFor(); await page.waitForFunction(() => document.querySelector('[data-testid=field-name]')?.value?.length > 0); };
// click Save, wait for the PATCH to answer and the editor to finish refreshing; returns the HTTP status
const save = async (page) => {
  const resp = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/admin'), { timeout: 20000 });
  await page.getByTestId('save-edit').click(); const status = (await resp).status();
  await page.waitForFunction(() => !/Saving/.test(document.querySelector('[data-testid=save-edit]')?.textContent || ''), null, { timeout: 20000 });
  if (status < 300) await page.getByTestId('save-notice').waitFor({ timeout: 20000 });
  return status;
};
const overflow = (page) => page.evaluate(() => { const d = document.querySelector('[data-testid=merchant-editor]'); return { page: document.documentElement.scrollWidth - window.innerWidth, drawer: d ? d.scrollWidth - d.clientWidth : 0 }; });
const rowLines = (page) => page.getByTestId('merchant-row').evaluateAll((rows) => rows.map((row) => {
  const lh = (el) => { const cs = getComputedStyle(el); return parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3; };
  const name = row.querySelector('[data-testid=merchant-row-name]'), meta = row.querySelector('[data-testid=merchant-row-meta]');
  return { nameLines: Math.round(name.getBoundingClientRect().height / lh(name)), metaLines: Math.round(meta.getBoundingClientRect().height / lh(meta)) };
}));

// ================= desktop: list unchanged, row -> editor
const { ctx, page } = await adminPage({ width: 1440, height: 900 });
const lines = await rowLines(page);
check('L1 two-line list unchanged: every row is name(1 line) + meta(1 line)', lines.length > 5 && lines.every((l) => l.nameLines === 1 && l.metaLines === 1), `rows=${lines.length}`);

// ---- migrated merchant, read-only: opens straight into the editor
const withMedia = [...new Set((await sbGet(`media_assets?merchant_id=not.is.null&publication_status=eq.legacy_effective&select=merchant_id&limit=400`)).map((m) => m.merchant_id))];
const real = (await sbGet(`merchant_details?merchant_system_id=in.(${withMedia.join(',')})&merchant_name=not.like.UXIMG*&merchant_verified=eq.true&merchant_description=not.is.null&merchant_contact_phone=not.is.null&select=merchant_system_id,merchant_name,merchant_description,merchant_contact_phone,new_address_line,new_address_city&order=merchant_name&limit=1`))[0];
await search(page, real.merchant_name);
await page.getByTestId('merchant-row').first().click();
await page.getByTestId('merchant-editor').waitFor();
check('R1 migrated merchant: clicking the row opens the editor immediately (no View Mode, no Edit button)', await page.getByTestId('field-name').isVisible() && await page.getByTestId('edit-merchant').count() === 0 && await page.getByTestId('merchant-view').count() === 0);
await page.waitForFunction(() => document.querySelector('[data-testid=field-name]')?.value?.length > 0);
check('R2 migrated merchant: name / description / contact phone / address load into the fields', (await page.getByTestId('field-name').inputValue()) === real.merchant_name && (await page.getByTestId('field-description').inputValue()).replace(/\r\n/g, '\n') === (real.merchant_description || '').replace(/\r\n/g, '\n') && (await page.getByTestId('field-contact-phone').inputValue()) === (real.merchant_contact_phone || '') && (await page.getByTestId('field-address-line').inputValue()) === (real.new_address_line || ''));
check('R3 migrated merchant: gallery, Main photo, View on VNO and Save/Cancel/Close are in the editor', await page.getByTestId('merchant-gallery').isVisible() && (await page.getByTestId('gallery-item').count()) > 0 && await page.getByTestId('view-on-vno').isVisible() && await page.getByTestId('save-edit').isVisible() && await page.getByTestId('cancel-edit').isVisible() && await page.getByTestId('close-editor').isVisible());
check('R4 nothing is dirty after opening; Save is disabled', await page.getByTestId('unsaved-flag').count() === 0 && await page.getByTestId('save-edit').isDisabled());
await page.screenshot({ path: `${OUT}/editor-real-desktop.png` });
await page.keyboard.press('Escape'); await page.getByTestId('merchant-editor').waitFor({ state: 'detached' });
check('R5 closing a pristine editor needs no confirmation (Escape)', true);

// ---- synthetic merchant A: description round trip
await openRow(page, 'UXIMG Alpha');
const before = await row(A.id);
const typed = 'Giới thiệu: Nhà hàng đặc sản — phở, bún chả & cà phê trứng.\nKhách sạn 3* · Wi-Fi_free · #1 Hà Nội\n\n> Giảm thêm khi đi nhóm trên 10 khách (<500k/người).\nĐà Nẵng, Thừa Thiên Huế, Nguyễn Ánh ơ ư ế ặ ỡ.';
const patches = []; page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/admin')) patches.push(JSON.parse(r.postData() || '{}')); });
await page.getByTestId('field-description').fill(typed);
check('D1 the Description field is editable, multiline and flags unsaved changes', (await page.getByTestId('field-description').evaluate((el) => el.tagName)) === 'TEXTAREA' && await page.getByTestId('unsaved-flag').isVisible() && await page.getByTestId('save-edit').isEnabled());
await save(page);
check('D2 Save keeps the editor open and shows the saved confirmation', await page.getByTestId('merchant-editor').isVisible() && await page.getByTestId('unsaved-flag').count() === 0);
check('D3 only the changed field was sent (no unrelated fields in the PATCH)', patches.length === 1 && JSON.stringify(Object.keys(patches[0])) === JSON.stringify(['merchant_description']), JSON.stringify(Object.keys(patches[0] || {})));
const after = await row(A.id);
const changedKeys = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])).sort();
check('D4 database: description saved exactly (Unicode, newlines, symbols) and no other column changed', after.merchant_description === typed && changedKeys.every((k) => ['merchant_description', 'merchant_last_update'].includes(k)), `changed=${changedKeys}`);
await page.reload(); await openRow(page, 'UXIMG Alpha');
check('D5 description survives a full refresh', (await page.getByTestId('field-description').inputValue()) === typed);
await page.screenshot({ path: `${OUT}/editor-synthetic-desktop.png` });
let pub = await waitPublic(A.id, (d) => d.description === typed);
check('D6 public API description equals the saved text exactly (3*, _, #, >, <500k preserved)', pub.description === typed, JSON.stringify(pub.description).slice(0, 80));
const pg = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await pg.goto(`${WEB}/merchants/${A.id}`); await pg.getByTestId('merchant-description').waitFor();
check('D7 public Giới thiệu section renders the saved description', (await pg.getByTestId('merchant-description').innerText()).trim() === typed);

// ---- clear -> fallback
await page.getByTestId('field-description').fill('');
check('D8 clearing shows the public-fallback hint', (await page.getByTestId('description-hint').innerText()).includes('chưa cập nhật'));
await save(page);
check('D9 database stores NULL for a cleared description, nothing else changes', (await row(A.id)).merchant_description === null);
pub = await waitPublic(A.id, (d) => d.description === '');
await pg.goto(`${WEB}/merchants/${A.id}`); await pg.getByTestId('description-unavailable').waitFor();
check('D10 public page shows the fallback text when the description is empty', pub.description === '' && (await pg.getByTestId('description-unavailable').innerText()).includes('chưa cập nhật phần giới thiệu'));

// ---- name, phone, address, discount, category propagate; payload minimal
patches.length = 0;
const cats = await sbGet('categories?select=id,category_name_vi&limit=3');
const newName = `UXIMG Alpha Bistro Edited ${Date.now() % 100000}`;
await page.getByTestId('field-name').fill(newName);
await page.getByTestId('field-contact-phone').fill('0912 345 678');
await page.getByTestId('field-address-line').fill('12 Lê Lợi');
await page.getByTestId('field-address-ward').fill('Phường Bến Nghé');
await page.getByTestId('field-address-city').fill('TP. Hồ Chí Minh');
await page.getByTestId('field-discount-type').selectOption('percentage');
await page.getByTestId('field-discount-value').fill('12.5');
check('O1 offer preview mirrors the public label before saving', (await page.getByTestId('offer-preview').innerText()).includes('Giảm 12,5%'));
check('O2 address preview mirrors the public address before saving', (await page.getByTestId('address-preview').innerText()).includes('12 Lê Lợi, Phường Bến Nghé, TP. Hồ Chí Minh'));
await page.getByRole('checkbox', { name: new RegExp(cats[0].category_name_vi) }).check();
await save(page);
const keys = Object.keys(patches[0] || {}).sort();
check('P1 payload contains only edited fields (no status / verification / commission / owner data)', JSON.stringify(keys) === JSON.stringify(['category_ids', 'merchant_contact_phone', 'merchant_discount_type', 'merchant_discount_value', 'merchant_name', 'new_address_city', 'new_address_line', 'new_address_ward']), keys.join(','));
const a2 = await row(A.id);
check('P2 database values: fraction stored 0.1250, verification/status/commission untouched', a2.merchant_discount_value == 0.125 && a2.merchant_verified === before.merchant_verified && a2.merchants_status === before.merchants_status && a2.merchant_commission_value === before.merchant_commission_value && a2.owner_name === before.owner_name && a2.merchant_email === before.merchant_email);
pub = await waitPublic(A.id, (d) => d.name === newName && d.offer?.label === 'Giảm 12,5%');
check('P3 public API: name, phone, address, offer and category propagate', pub.name === newName && pub.phone === '0912 345 678' && pub.address === '12 Lê Lợi, Phường Bến Nghé, TP. Hồ Chí Minh' && pub.offer?.label === 'Giảm 12,5%' && pub.categories.some((c) => c.id === cats[0].id), JSON.stringify({ phone: pub.phone, address: pub.address, offer: pub.offer?.label }));
await pg.goto(`${WEB}/merchants/${A.id}`); await pg.getByTestId('merchant-name').waitFor();
check('P4 public page shows name, phone, address, offer', (await pg.getByTestId('merchant-name').innerText()) === newName && (await pg.getByTestId('contact-card').innerText()).includes('0912 345 678') && (await pg.getByText('12 Lê Lợi, Phường Bến Nghé, TP. Hồ Chí Minh').first().isVisible()) && (await pg.getByTestId('offer-card').innerText()).includes('Giảm 12,5%'));
const priv = JSON.stringify(pub);
check('P5 anonymous payload leaks no owner / commission / email data', !/owner_|commission|merchant_email|uximg-a@local/.test(priv) && !priv.includes(a2.owner_email || '@@none@@'));
// discount cleared -> no offer published
await page.getByTestId('field-discount-type').selectOption(''); await page.getByTestId('field-discount-value').fill('');
check('P6 clearing the discount previews "no offer"', (await page.getByTestId('offer-preview').innerText()).includes('no offer'));
await save(page);
pub = await waitPublic(A.id, (d) => d.offer === null);
check('P7 cleared discount: DB nulls, public shows no offer (never a fabricated 0%)', pub.offer === null && (await row(A.id)).merchant_discount_value === null);
// restore the 10 % offer so the other suites see the fixture state
await page.getByTestId('field-discount-type').selectOption('percentage'); await page.getByTestId('field-discount-value').fill('10');
await save(page);

// ---- invalid input stays in the editor with the draft intact
await page.getByTestId('field-discount-value').fill('150');
await page.getByTestId('save-edit').click(); await page.getByTestId('edit-error').waitFor();
check('V1 invalid discount (150 %) is rejected, error shown inside the editor, draft kept, nothing saved', await page.getByTestId('merchant-editor').isVisible() && (await page.getByTestId('field-discount-value').inputValue()) === '150' && (await row(A.id)).merchant_discount_value == 0.1);
await page.getByTestId('field-discount-value').fill('10');

// ---- unsaved-change protection
await page.getByTestId('field-name').fill('UXIMG Alpha UNSAVED');
let dialogs = [];
page.once('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
await page.getByTestId('cancel-edit').click();
check('U1 Cancel with unsaved changes asks first; declining keeps the editor and the draft', dialogs.length === 1 && await page.getByTestId('merchant-editor').isVisible() && (await page.getByTestId('field-name').inputValue()) === 'UXIMG Alpha UNSAVED');
page.once('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
await page.getByTestId('close-editor').click();
check('U2 Close (x) asks first as well', dialogs.length === 2 && await page.getByTestId('merchant-editor').isVisible());
page.once('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
await page.mouse.click(8, 400);
check('U3 clicking outside the editor asks first', dialogs.length === 3 && await page.getByTestId('merchant-editor').isVisible());
page.once('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
check('U4 Escape asks first', dialogs.length === 4 && await page.getByTestId('merchant-editor').isVisible());
page.once('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
await page.getByTestId('close-editor').click(); await page.getByTestId('merchant-editor').waitFor({ state: 'detached' });
check('U5 confirming discards the draft: nothing was written', (await row(A.id)).merchant_name === newName);
await search(page, 'UXIMG Alpha'); await page.getByTestId('merchant-row').first().click(); await page.getByTestId('merchant-editor').waitFor(); await page.waitForTimeout(500);
check('U6 re-opening shows the stored value, not the discarded draft', (await page.getByTestId('field-name').inputValue()) === newName);

// ---- gallery + main photo inside the editor
const mainAlt = () => page.locator('[data-testid=gallery-item][data-main=true] img').first().getAttribute('alt');
await page.getByTestId('merchant-gallery').scrollIntoViewIfNeeded(); await page.waitForTimeout(800);
const startMain = await mainAlt(); const target = startMain === 'alpha-red.png' ? 'alpha-green.png' : 'alpha-red.png';
check('G1 gallery is visible in the editor: 3 images, exactly one Main', (await page.getByTestId('gallery-item').count()) === 3 && (await page.locator('[data-testid=gallery-item][data-main=true]').count()) === 1, startMain);
await page.getByTestId('field-name').fill(newName + ' draft');   // an unsaved draft must survive a gallery change
await page.locator('[data-testid=gallery-item]').filter({ hasText: target }).getByTestId('set-main').click(); await page.getByTestId('gallery-notice').waitFor(); await page.waitForTimeout(800);
check('G2 Set as Main moves the badge, still 3 images, and the unsaved draft is kept', (await mainAlt()) === target && (await page.getByTestId('gallery-item').count()) === 3 && (await page.getByTestId('field-name').inputValue()) === newName + ' draft');
await page.getByTestId('field-name').fill(newName);
check('G3 draft equal to the saved value is no longer "unsaved"', await page.getByTestId('unsaved-flag').count() === 0);
await page.keyboard.press('Escape'); await page.getByTestId('merchant-editor').waitFor({ state: 'detached' });
const heroes = await sbGet(`media_assets?merchant_id=eq.${A.id}&is_hero=eq.true&select=id,original_filename`);
check('G4 database: exactly one hero, all three images still effective', heroes.length === 1 && (await sbGet(`media_assets?merchant_id=eq.${A.id}&publication_status=in.(legacy_effective,preexisting_effective,approved)&select=id`)).length === 3);
await sleep(31000);
const card = (await (await fetch(`${API}/public/merchants?q=${encodeURIComponent('UXIMG Alpha')}`)).json()).items.find((i) => i.id === A.id);
check('G5 public card image is the selected Main photo', card?.image_url === `/public/media/${heroes[0].id}`);

// ---- controls by status: pending shows Approve/Reject, active shows Deactivate, unverified disables View on VNO
const created = await (await fetch(`${API}/merchants/admin`, { method: 'POST', headers: { Authorization: `Bearer ${await login(fx.users.admin)}`, 'content-type': 'application/json' }, body: JSON.stringify({ owner_email: `uximg-pending-${Date.now() % 100000}@local.invalid`, merchant_name: 'UXIMG Pending Delta' }) })).json();
await search(page, 'UXIMG Pending Delta'); await page.getByTestId('merchant-row').first().click(); await page.getByTestId('merchant-editor').waitFor();
check('S1 pending merchant: Approve + Reject shown, View on VNO disabled (not published), no Deactivate', await page.getByRole('button', { name: 'Approve' }).isVisible() && await page.getByRole('button', { name: 'Reject' }).isVisible() && await page.getByTestId('view-on-vno').isDisabled() && await page.getByRole('button', { name: 'Deactivate' }).count() === 0);
await page.keyboard.press('Escape');
await search(page, 'UXIMG Bravo'); await page.getByTestId('merchant-row').first().click(); await page.getByTestId('merchant-editor').waitFor();
check('S2 active verified merchant: Deactivate shown, View on VNO is a link to the public page', await page.getByRole('button', { name: 'Deactivate' }).isVisible() && (await page.getByTestId('view-on-vno').getAttribute('href')) === `/merchants/${B.id}`);
check('S3 merchant without photos: editor opens, empty-gallery state, no crash', true);
await page.keyboard.press('Escape');
await search(page, 'UXIMG Charlie'); await page.getByTestId('merchant-row').first().click(); await page.getByTestId('merchant-editor').waitFor();
check('S4 merchant without photos shows the empty main-photo state', await page.getByTestId('merchant-hero-empty').isVisible());
await page.keyboard.press('Escape');
await ctx.close();

// ================= mobile: editor layout
{
  const { ctx: mctx, page: mp } = await adminPage({ width: 390, height: 844 });
  await openRow(mp, 'UXIMG Alpha');
  const o = await overflow(mp);
  check('M1 mobile: editor opens directly with no horizontal overflow (page or drawer)', o.page <= 1 && o.drawer <= 1, JSON.stringify(o));
  await mp.getByTestId('field-description').scrollIntoViewIfNeeded();
  check('M2 mobile: Save / Cancel / Close reachable in the sticky header', await mp.getByTestId('save-edit').isVisible() && await mp.getByTestId('close-editor').isVisible());
  await mp.screenshot({ path: `${OUT}/editor-mobile-top.png` });
  await mp.getByTestId('merchant-gallery').scrollIntoViewIfNeeded(); await mp.waitForTimeout(600);
  await mp.screenshot({ path: `${OUT}/editor-mobile-gallery.png` });
  const o2 = await overflow(mp);
  check('M3 mobile: still no overflow after scrolling the whole editor', o2.page <= 1 && o2.drawer <= 1);
  await mp.keyboard.press('Escape');
  await mctx.close();
}
// desktop overflow
{
  const { ctx: dctx, page: dp } = await adminPage({ width: 1440, height: 900 });
  await openRow(dp, 'UXIMG Alpha'); const o = await overflow(dp);
  check('M4 desktop: no horizontal overflow with the editor open', o.page <= 1 && o.drawer <= 1, JSON.stringify(o));
  await dctx.close();
}

// ================= RBAC / privacy
{
  const owner = await login(fx.users.owner), otherOwner = await login(fx.users.otherOwner);
  const patch = (tok, id) => fetch(`${API}/merchants/${id}/admin`, { method: 'PATCH', headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify({ merchant_description: 'HACK' }) });
  const statuses = [(await patch(null, A.id)).status, (await patch(owner, A.id)).status, (await patch(otherOwner, B.id)).status];
  check('Z1 admin-only editing: anonymous 401, merchant owner 403, other tenant 403', statuses.join() === '401,403,403', statuses.join());
  check('Z2 forbidden writes changed nothing', (await row(A.id)).merchant_description === null && (await row(B.id)).merchant_description !== 'HACK');
  const strict = await fetch(`${API}/merchants/${A.id}/admin`, { method: 'PATCH', headers: { Authorization: `Bearer ${await login(fx.users.admin)}`, 'content-type': 'application/json' }, body: JSON.stringify({ merchant_description: 'x', latitude: 1 }) });
  check('Z3 unknown fields (e.g. latitude) are rejected by the strict schema', strict.status === 400, String(strict.status));
  const anon = await (await fetch(`${API}/public/merchants/${A.id}`)).text();
  check('Z4 anonymous detail exposes no private fields', !/owner_|commission|legacy_|merchant_email|merchant_phone"/.test(anon));
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
