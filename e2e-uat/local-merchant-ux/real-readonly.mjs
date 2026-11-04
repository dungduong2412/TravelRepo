// READ-ONLY on migrated records: opens the editor, scrolls, screenshots. Never types, saves, or clicks Save/Set as main/Upload.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const fx = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = new URL('../../docs/screenshots/merchant-ux', import.meta.url).pathname; const WEB = 'http://localhost:3011';
const ok = []; const check = (n, p, d = '') => { ok.push(p); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); if (!p) process.exitCode = 1; };
const b = await chromium.launch();
for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport }); const page = await ctx.newPage();
  await page.goto(`${WEB}/login`); await page.getByLabel('Email').fill(fx.users.admin); await page.getByLabel('Mật khẩu').fill(fx.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click(); await page.waitForURL('**/admin/**');
  for (const [name, expectedImages, hasHero] of [['Saigonesetourist', 4, true], ['STARANISE', 4, true], ['UAT-E2E-MERCHANT', 4, false]]) {
    await page.goto(`${WEB}/admin/merchants`); await page.getByTestId('merchant-row').first().waitFor();
    await page.getByLabel('Search').fill(name); await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForFunction((n) => { const r = document.querySelectorAll('[data-testid=merchant-row]'); return r.length >= 1 && r[0].textContent.toLowerCase().includes(n.toLowerCase()); }, name);
    const rowName = (await page.getByTestId('merchant-row-name').first().innerText()).trim();
    if (label === 'desktop' && name === 'Saigonesetourist') await page.screenshot({ path: `${OUT}/real-list-${label}.png` });
    await page.getByTestId('merchant-row').first().click(); await page.getByTestId('merchant-editor').waitFor();
    check(`${label} ${name}: row opens the editor directly (no separate View Mode)`, await page.getByTestId('merchant-edit').count() === 1 && await page.getByTestId('edit-merchant').count() === 0);
    await page.getByTestId('merchant-gallery').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=gallery-item] img')].every((i) => i.complete), null, { timeout: 15000 }).catch(() => undefined);
    const items = await page.getByTestId('gallery-item').count();
    const decoded = await page.locator('[data-testid=gallery-item] img').evaluateAll((els) => els.filter((i) => i.naturalWidth > 0).length);
    check(`${label} ${name}: every migrated image is listed and decodes`, items === expectedImages && decoded === expectedImages, `listed=${items} decoded=${decoded}`);
    check(`${label} ${name}: exactly one Main badge${hasHero ? '' : ' (automatic fallback, flagged)'}`, (await page.locator('[data-testid=gallery-item][data-main=true]').count()) === 1 && (hasHero || (await page.getByText('no main photo chosen').count()) === 1));
    await page.screenshot({ path: `${OUT}/real-gallery-${label}-${name.replace(/\W/g, '')}.png` });
    if (hasHero && label === 'desktop') {
      const id = (await page.locator('[data-testid=merchant-editor] [data-testid=view-on-vno]').getAttribute('href')).split('/').pop();
      const detail = await (await fetch(`http://localhost:3100/public/merchants/${id}`)).json();
      const adminMainAlt = await page.locator('[data-testid=gallery-item][data-main=true] img').getAttribute('alt');
      check(`${label} ${name}: public details hero (first gallery id) is the admin Main photo`, detail.gallery[0].id === detail.image_url.split('/').pop() && detail.gallery.length === expectedImages, adminMainAlt);
    }
  }
  await ctx.close();
}
await b.close(); console.log(`${ok.filter(Boolean).length}/${ok.length} passed`);
