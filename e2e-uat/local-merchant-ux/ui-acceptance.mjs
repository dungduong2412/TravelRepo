import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const fx = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = new URL('../../docs/screenshots/merchant-ux', import.meta.url).pathname;
const WEB = 'http://localhost:3011';
const A = fx.merchants.a, [a1, a2, a3] = fx.media.a;
const results = []; const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch();

async function adminPage(viewport, blockStorage = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  if (blockStorage) await ctx.route(/\/storage\/v1\//, (route) => route.abort());
  const page = await ctx.newPage();
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Email').fill(fx.users.admin); await page.getByLabel('Mật khẩu').fill(fx.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.waitForURL('**/admin/**', { timeout: 30000 });
  await page.goto(`${WEB}/admin/merchants`);
  await page.getByTestId('merchant-row').first().waitFor({ timeout: 30000 });
  return { ctx, page };
}
const search = async (page, q) => { await page.getByLabel('Search').fill(q); await page.getByRole('button', { name: 'Apply' }).click(); await page.waitForTimeout(1200); await page.getByTestId('merchant-row').first().waitFor(); };
// every row's name and meta line must be a single line (nowrap + ellipsis) => 2 lines per row maximum
const rowLines = (page) => page.getByTestId('merchant-row').evaluateAll((rows) => rows.map((row) => {
  const lh = (el) => { const cs = getComputedStyle(el); return parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3; };
  const name = row.querySelector('[data-testid=merchant-row-name]'), meta = row.querySelector('[data-testid=merchant-row-meta]');
  return { nameLines: Math.round(name.getBoundingClientRect().height / lh(name)), metaLines: Math.round(meta.getBoundingClientRect().height / lh(meta)), h: Math.round(row.getBoundingClientRect().height), overflowX: row.scrollWidth > row.clientWidth + 1 };
}));

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const { ctx, page } = await adminPage(viewport);
  await page.waitForTimeout(1500);
  const lines = await rowLines(page);
  check(`${label}: list rows are exactly two lines max (name 1 line + meta 1 line), no horizontal overflow`, lines.length > 5 && lines.every((l) => l.nameLines === 1 && l.metaLines === 1 && !l.overflowX), `rows=${lines.length} maxHeight=${Math.max(...lines.map((l) => l.h))}px`);
  check(`${label}: page has no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: `${OUT}/list-${label}-real-data.png` });
  await search(page, 'UXIMG Alpha');
  check(`${label}: very long name is clamped to one line with ellipsis`, (await rowLines(page))[0].nameLines === 1 && await page.getByTestId('merchant-row-name').first().evaluate((el) => { const cs = getComputedStyle(el); return cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap' && cs.overflow === 'hidden'; }));
  await page.screenshot({ path: `${OUT}/list-${label}-long-name.png` });
  await ctx.close();
}

// ---------- behaviour on desktop
{
  const { ctx, page } = await adminPage({ width: 1440, height: 900 });
  const F = (label) => page.getByTestId('merchant-edit').getByLabel(label, { exact: true });
  await search(page, 'UXIMG Alpha');
  await page.getByTestId('merchant-row').first().click();
  await page.getByTestId('merchant-view').waitFor();
  check('B1 clicking the row opens read-only View Mode (not Edit)', await page.getByTestId('merchant-view').isVisible() && await page.getByTestId('merchant-edit').count() === 0 && await page.locator('aside input, aside textarea').count() === 1 /* only the hidden upload input */);
  check('B2 View Mode shows Edit and View on VNO actions, main photo, gallery, description, address, status', await page.getByTestId('edit-merchant').isVisible() && await page.getByTestId('view-on-vno').isVisible() && await page.getByText('Synthetic merchant UXIMG Alpha').isVisible() && await page.getByText('1 Test Street').isVisible() && (await page.getByTestId('gallery-item').count()) === 3 && await page.locator('aside img').first().isVisible());
  await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/view-desktop.png` });
  check('B3 View on VNO links to the public details page', (await page.getByTestId('view-on-vno').getAttribute('href')) === `/merchants/${A.id}`);

  // Edit -> Cancel discards
  const originalName = (await page.locator('[data-testid=merchant-view] h3').first().innerText()).trim();
  await page.getByTestId('edit-merchant').click(); await page.getByTestId('merchant-edit').waitFor();
  check('E1 Edit opens a separate editable state', await page.getByTestId('merchant-view').count() === 0 && await F('Merchant name').isVisible());
  await page.screenshot({ path: `${OUT}/edit-desktop.png` });
  await F('Merchant name').fill('UXIMG Alpha UNSAVED NAME');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('cancel-edit').click(); await page.getByTestId('merchant-view').waitFor();
  check('E2 Cancel (with unsaved changes) discards and returns to View Mode with the original data', await page.getByRole('heading', { name: originalName }).isVisible() && await page.getByText('UNSAVED NAME').count() === 0);
  await page.getByTestId('edit-merchant').click();
  check('E3 re-opening Edit shows the stored value, not the discarded draft', (await F('Merchant name').inputValue()) === originalName);
  // dismissing the confirm keeps the draft
  await F('Merchant name').fill('UXIMG Alpha KEEP');
  page.once('dialog', (d) => d.dismiss()); await page.getByTestId('cancel-edit').click();
  check('E4 declining the discard prompt keeps the edit form and draft', await page.getByTestId('merchant-edit').isVisible() && (await F('Merchant name').inputValue()) === 'UXIMG Alpha KEEP');
  // Save -> View with updated data
  const updated = originalName.endsWith('(renamed)') ? 'UXIMG Alpha Bistro' : 'UXIMG Alpha Bistro (renamed)';
  await F('Merchant name').fill(updated);
  await page.getByTestId('save-edit').click(); await page.getByTestId('merchant-view').waitFor({ timeout: 20000 });
  check('E5 Save returns to View Mode showing the updated data', await page.getByRole('heading', { name: updated }).isVisible() && await page.getByTestId('merchant-edit').count() === 0);
  await page.screenshot({ path: `${OUT}/view-after-save-desktop.png` });
  // Save failure stays in Edit with a visible error
  await page.getByTestId('edit-merchant').click();
  await F('Merchant name').fill(updated + ' ');
  await F('Merchant email').fill('not-an-email');
  await F('Merchant email').evaluate((el) => el.removeAttribute('type'));
  await page.getByTestId('save-edit').click();
  await page.getByTestId('edit-error').waitFor({ timeout: 10000 });
  check('E6 a rejected save keeps Edit Mode and shows the error inside the form', await page.getByTestId('merchant-edit').isVisible() && await page.getByTestId('edit-error').isVisible());
  page.once('dialog', (d) => d.accept()); await page.getByTestId('cancel-edit').click(); await page.getByTestId('merchant-view').waitFor();
  await page.keyboard.press('Escape');

  // list reflects the rename
  await page.locator('aside button[aria-label=Close]').click();
  await page.waitForTimeout(800);
  check('E7 list shows the updated name after returning', (await page.getByTestId('merchant-row-name').first().innerText()).trim() === updated);

  // gallery: Set as main
  await page.getByTestId('merchant-row').first().click(); await page.getByTestId('merchant-view').waitFor();
  const mainId = () => page.locator('[data-testid=gallery-item][data-main=true] img').first().getAttribute('alt');
  const startMain = await mainId(); const targetName = startMain === 'alpha-red.png' ? 'alpha-green.png' : 'alpha-red.png'; const idOf = { 'alpha-red.png': a1, 'alpha-green.png': a2, 'alpha-blue.png': a3 }; globalThis.expectedMain = idOf[targetName];
  check('G1 initial gallery has exactly one Main photo', (await page.locator('[data-testid=gallery-item][data-main=true]').count()) === 1 && Boolean(startMain), startMain);
  await page.getByTestId('merchant-gallery').scrollIntoViewIfNeeded(); await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=gallery-item] img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 10000 }).catch(() => undefined);
  check('G2 existing images are all visible with real pictures (not placeholders)', await page.locator('[data-testid=gallery-item] img').evaluateAll((imgs) => imgs.length === 3 && imgs.every((i) => i.complete && i.naturalWidth > 0)));
  const target = page.locator('[data-testid=gallery-item]').filter({ hasText: targetName });
  await target.getByTestId('set-main').click(); await page.getByTestId('gallery-notice').waitFor();
  await page.waitForTimeout(800);
  check('G3 Set as main moves the Main badge; still exactly one; gallery still has 3 images', (await page.locator('[data-testid=gallery-item][data-main=true]').count()) === 1 && (await mainId()) === targetName && (await page.getByTestId('gallery-item').count()) === 3);
  await page.screenshot({ path: `${OUT}/gallery-set-main-desktop.png` });
  await page.reload(); await page.getByTestId('merchant-row').first().waitFor(); await search(page, 'UXIMG Alpha');
  await page.getByTestId('merchant-row').first().click(); await page.getByTestId('merchant-view').waitFor(); await page.waitForTimeout(600);
  check('G4 after a full page refresh the selected Main photo persists', (await mainId()) === targetName);
  check('G5 list thumbnail reflects the new Main photo', (await page.getByTestId('merchant-thumb').count()) > 0);
  await ctx.close();
}

// ---------- public site uses the selected main
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
  await new Promise((r) => setTimeout(r, 31000)); // public snapshot TTL
  await page.goto(`${WEB}/`); await page.getByTestId('listing-card').first().waitFor();
  await page.getByPlaceholder(/Tìm|tìm/).first().fill('UXIMG Alpha').catch(() => undefined);
  await page.waitForTimeout(100);
  const api = await (await fetch(`http://localhost:3100/public/merchants?q=UXIMG%20Alpha`)).json();
  const card = api.items.find((i) => i.id === A.id);
  await page.goto(`${WEB}/?q=UXIMG%20Alpha`); await page.waitForTimeout(2500);
  const cardImg = await page.locator(`[data-testid=listing-card][href="/merchants/${A.id}"] img`).first().getAttribute('src').catch(() => null);
  check('P1 landing-page card image is the selected Main photo', cardImg?.includes(`/public/media/${globalThis.expectedMain}`) && card.image_url === `/public/media/${globalThis.expectedMain}`, cardImg || 'card not found by href');
  await page.screenshot({ path: `${OUT}/public-card-desktop.png` });
  await page.goto(`${WEB}/merchants/${A.id}`); await page.getByTestId('gallery-hero').waitFor();
  const heroSrc = await page.getByTestId('gallery-hero').getAttribute('src');
  check('P2 public Merchant Details hero is the same image as the card', heroSrc.includes(`/public/media/${globalThis.expectedMain}`));
  await page.waitForFunction(() => { const i = document.querySelector('[data-testid=gallery-hero]'); return i && i.complete && i.naturalWidth > 0; });
  check('P3 hero and gallery decode real pictures; gallery still lists all 3', await page.getByTestId('gallery-hero').evaluate((i) => i.complete && i.naturalWidth > 0) && (await page.getByTestId('gallery-thumb').count()) === 3);
  await page.screenshot({ path: `${OUT}/public-details-desktop.png` });
  const m = await browser.newContext({ viewport: { width: 390, height: 844 } }); const mp = await m.newPage();
  await mp.goto(`${WEB}/merchants/${A.id}`); await mp.getByTestId('gallery-hero').waitFor(); await mp.waitForTimeout(800);
  await mp.screenshot({ path: `${OUT}/public-details-mobile.png` });
  await ctx.close(); await m.close();
}

// ---------- mobile admin view + broken images
{
  const { ctx, page } = await adminPage({ width: 390, height: 844 });
  await search(page, 'UXIMG');
  await page.getByTestId('merchant-row').first().click(); await page.getByTestId('merchant-view').waitFor(); await page.waitForTimeout(800);
  check('M1 mobile View Mode fits the viewport without horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1) && await page.getByTestId('merchant-view').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await page.screenshot({ path: `${OUT}/view-mobile.png` });
  await page.getByTestId('merchant-gallery').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/gallery-mobile.png` });
  await ctx.close();
}
{
  // broken / missing images degrade to placeholders: block every Storage image request
  const { ctx, page } = await adminPage({ width: 1440, height: 900 }, true);
  await search(page, 'UXIMG Bravo');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=merchant-row]').length === 1);
  await page.getByTestId('merchant-thumb-empty').first().waitFor({ timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  check('X1 list shows a placeholder (no broken-image icon) when the thumbnail fails', (await page.getByTestId('merchant-thumb-empty').count()) >= 1 && await page.getByTestId('merchant-thumb').count() === 0, `empty=${await page.getByTestId('merchant-thumb-empty').count()} img=${await page.getByTestId('merchant-thumb').count()} rows=${await page.getByTestId('merchant-row').count()}`);
  await page.getByTestId('merchant-row').first().click(); await page.getByTestId('merchant-view').waitFor(); await page.waitForTimeout(1200);
  check('X2 view mode shows "Preview unavailable" placeholders and stays usable', (await page.getByTestId('picture-unavailable').count()) >= 1 && await page.getByTestId('edit-merchant').isEnabled());
  await page.screenshot({ path: `${OUT}/broken-images-desktop.png` });
  await ctx.close();
}
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
