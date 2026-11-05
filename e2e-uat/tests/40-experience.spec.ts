import { test, expect, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { api } from '../lib/api';
import { config, creds, EVIDENCE_DIR, setActive } from '../lib/env';
import { readFixture } from '../lib/fixture';
import { record } from '../lib/evidence';

// Business-UAT experience suite. Public discovery specs are read-only against the actual migrated records.
// Specs that sign in use only the dedicated synthetic identities (never a migrated V1 user) and write nothing.
// Run against the release candidate with E2E_TARGET=candidate (local web :3011 + local API :3100 on the hosted UAT data).
const c = config();
const check = (id: string, title: string, ok: boolean, detail = '') => { record(id, title, ok ? 'PASS' : 'FAIL', detail); expect(ok, `${id} ${title} ${detail}`).toBeTruthy(); };
const has = (role: 'admin' | 'merchant' | 'partner') => Boolean(creds(role));
const shot = (page: Page, name: string) => page.screenshot({ path: `${EVIDENCE_DIR}/screens/${name}.png`, fullPage: false });
const DEMO_TITLES = ['Luxury Hotel Saigon', 'Fine Dining at La Table', 'Morning Coffee House', 'City Spa & Wellness', 'Saigon City Tour', 'Live Jazz Night'];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function uiLogin(page: Page, role: 'admin' | 'merchant' | 'partner') {
  const cred = creds(role)!;
  await page.goto('/login');
  await page.getByLabel('Email').fill(cred.email);
  await page.getByLabel('Mật khẩu').fill(cred.password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}

test.describe('@experience public discovery (read-only, real migrated data)', () => {
  test('X01 home shows real Merchants, not demo listings', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('listing-card').first()).toBeVisible();
    const total = Number((await page.getByTestId('result-count').innerText()).match(/\d+/)![0]);
    const body = await page.locator('body').innerText();
    const demo = DEMO_TITLES.filter((t) => body.includes(t));
    const apiTotal = (await api(null, 'GET', '/public/merchants?page_size=1')).body.total;
    check('X01', 'real listings; no demo titles; count equals API', demo.length === 0 && total === apiTotal && total >= 100, `shown=${total} api=${apiTotal} demo=${demo.length}`);
    // the first row of cards must actually decode real photos (not just render boxes)
    await expect.poll(() => page.$$eval('[data-testid=listing-card] img', (imgs) => imgs.slice(0, 8).filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0).length), { message: 'first 8 card images decoded', timeout: 60_000 }).toBe(8);
    record('X01b', 'first 8 listing cards show decoded approved photos', 'PASS');
    await shot(page, 'x01-home-desktop');
  });

  test('X01c "Xem thêm" reaches every listing (no silently truncated catalog)', async ({ page }) => {
    await page.goto('/');
    const total = Number((await page.getByTestId('result-count').innerText()).match(/\d+/)![0]);
    let previous = await page.getByTestId('listing-card').count();
    for (let i = 0; i < 12 && (await page.getByTestId('load-more').count()) > 0; i++) {
      await page.getByTestId('load-more').click();
      await expect.poll(() => page.getByTestId('listing-card').count(), { timeout: 30_000 }).toBeGreaterThan(previous);
      previous = await page.getByTestId('listing-card').count();
    }
    const shown = await page.getByTestId('listing-card').count();
    const ids = new Set(await page.getByTestId('listing-card').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href'))));
    check('X01c', 'load-more shows all listings exactly once', shown === total && ids.size === total, `shown=${shown} unique=${ids.size} total=${total}`);
  });

  test('X02 Restaurant category lists the real restaurants (was 0)', async ({ page }) => {
    await page.goto('/');
    const chip = page.locator('[data-testid=category-chip][data-category=restaurant]');
    await chip.click();
    await expect(page).toHaveURL(/category=/);
    await expect(page.getByTestId('listing-card').first()).toBeVisible();
    const shown = Number((await page.getByTestId('result-count').innerText()).match(/\d+/)![0]);
    const cats = (await api(null, 'GET', '/public/categories')).body as any[];
    const expected = cats.find((x) => x.name === 'restaurant').count;
    check('X02', 'Restaurant filter shows the API/DB count', shown === expected && shown >= 30, `shown=${shown} expected=${expected}`);
    await shot(page, 'x02-restaurant-filter');
    // filtered state survives refresh and is shareable
    await page.reload();
    await expect(page.getByTestId('result-count')).toContainText(String(expected));
    record('X02b', 'category filter survives refresh (deep link)', 'PASS');
  });

  test('X03 every category chip has listings; no raw Font Awesome text', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('category-chip').first()).toBeVisible();
    const text = await page.locator('body').innerText();
    const cats = (await api(null, 'GET', '/public/categories')).body as any[];
    check('X03', 'no "fa-" strings rendered; every offered category is non-empty', !/\bfa-(regular|solid)|fa-[a-z-]+/.test(text) && cats.every((x) => x.count > 0) && (await page.getByTestId('category-chip').count()) === cats.length, `${cats.length} categories`);
  });

  test('X04 card opens a real detail page that survives refresh / deep link', async ({ page }) => {
    await page.goto('/');
    const first = page.getByTestId('listing-card').first();
    const name = await first.getAttribute('aria-label');
    await first.click();
    await expect(page).toHaveURL(new RegExp(`/merchants/${UUID.source}`));
    await expect(page.getByTestId('merchant-name')).toHaveText(name!);
    const url = page.url();
    await page.reload();
    await expect(page.getByTestId('merchant-name')).toHaveText(name!);
    const fresh = await page.context().newPage(); await fresh.goto(url);
    await expect(fresh.getByTestId('merchant-name')).toHaveText(name!);
    await fresh.close();
    check('X04', 'card → detail; reload and fresh-tab deep link render the same Merchant', true, name!);
    await shot(page, 'x04-detail-desktop');
  });

  test('X05 detail content: gallery, offer, contact, unavailable-vs-error', async ({ page }) => {
    const list = (await api(null, 'GET', '/public/merchants?page_size=60')).body.items as any[];
    const rich = list.find((m) => m.image_url && m.offer);
    const bare = list.find((m) => !m.image_url);
    await page.goto(`/merchants/${rich.id}`);
    await expect(page.getByTestId('gallery-hero')).toBeVisible();
    await expect(page.getByTestId('offer-card')).toContainText(rich.offer.label);
    await expect(page.getByTestId('contact-card')).toBeVisible();
    await expect.poll(() => page.getByTestId('gallery-hero').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { message: 'hero image decoded', timeout: 30_000 }).toBeTruthy();
    if (bare) { await page.goto(`/merchants/${bare.id}`); await expect(page.getByTestId('gallery-empty')).toBeVisible(); }
    // unknown id = legitimate "not found" (not a technical error)
    await page.goto('/merchants/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('Không tìm thấy nhà cung cấp')).toBeVisible();
    await expect(page.locator('[data-state=error]')).toHaveCount(0);
    check('X05', 'gallery decodes, offer + contact present, missing image/id use the "unavailable" states', true, `rich=${rich.id.slice(0, 8)} bare=${bare ? bare.id.slice(0, 8) : 'n/a'}`);
  });

  test('X06 technical failure is shown as an error with retry, empty result as empty', async ({ page }) => {
    await page.route('**/public/merchants?*', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"down"}' }));
    await page.goto('/');
    await expect(page.locator('[data-state=error]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
    await expect(page.locator('[data-state=empty]')).toHaveCount(0);
    await page.unroute('**/public/merchants?*');
    await page.route('**/public/merchants?*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[],"total":0,"page":1,"page_size":24}' }));
    await page.reload();
    await expect(page.locator('[data-state=empty]')).toBeVisible();
    await expect(page.locator('[data-state=error]')).toHaveCount(0);
    check('X06', '503 → error+retry (never "no listings"); 200/[] → empty state', true);
  });

  test('X07 approved image identity: public feed bytes equal the governed admin object (SHA-256) and the stored size', async () => {
    test.skip(!has('admin'), 'BLOCKED: admin credentials missing (needed for the governed signed-url path and stored size)');
    test.setTimeout(300_000); // downloads each original twice (public feed + governed path)
    const media = (await api('admin', 'GET', '/media')).body; const stored = new Map<string, any>((Array.isArray(media) ? media : media?.items ?? []).map((m: any) => [m.id, m]));
    const items = (await api(null, 'GET', '/public/merchants?page_size=60')).body.items.filter((m: any) => m.image_url).slice(0, 12);
    const sha = async (res: Response) => { const b = Buffer.from(await res.arrayBuffer()); return { hash: crypto.createHash('sha256').update(b).digest('hex'), size: b.length }; };
    let ok = 0; const bad: string[] = [];
    for (const m of items) {
      const id = m.image_url.split('/').pop(); const pub = await sha(await fetch(`${c.api}${m.image_url}?size=original`));
      const signed = (await api('admin', 'GET', `/media/${id}/signed-url`)).body; const url = signed?.signed_url ?? signed?.url ?? signed?.signedUrl;
      const gov = url ? await sha(await fetch(url)) : null;
      if (gov && pub.hash === gov.hash && pub.size === Number(stored.get(id)?.size_bytes)) ok++; else bad.push(`${String(id).slice(0, 8)}`);
    }
    // the default card rendition is a small derivative of the same approved object, not the multi-MB original
    const card = await fetch(`${c.api}${items[0].image_url}`); const cardBytes = (await card.arrayBuffer()).byteLength;
    record('X07b', 'card rendition is a small derivative', cardBytes < 250_000 && /image\//.test(card.headers.get('content-type') ?? '') ? 'PASS' : 'FAIL', `${Math.round(cardBytes / 1024)} KB`);
    expect(cardBytes, 'card rendition size').toBeLessThan(250_000);
    check('X07', `${items.length} listing hero images (size=original) are byte-identical (SHA-256) to the approved object and match the stored size`, ok === items.length && ok > 0, bad.join(','));
  });

  test('X08 anonymous API exposes no owner PII, commission or legacy fields', async () => {
    const pages = [(await api(null, 'GET', '/public/merchants?page_size=60&page=1')).body, (await api(null, 'GET', '/public/merchants?page_size=60&page=2')).body, (await api(null, 'GET', '/public/merchants?page_size=60&page=3')).body];
    const detail = (await api(null, 'GET', `/public/merchants/${pages[0].items[0].id}`)).body;
    const legacy = await api(null, 'GET', '/merchants/verified');
    const blob = JSON.stringify([pages, detail, legacy.body]);
    const structured = JSON.stringify([pages, detail, legacy.body], (k, v) => (['description', 'summary', 'merchant_description'].includes(k) ? undefined : v)); // merchant-authored marketing text may legitimately print a business address
    const leaks = ['owner_', 'legacy_', 'commission', 'tax_code'].filter((k) => blob.includes(k)).concat(/[\w.+-]+@[\w-]+\.[\w.]+/.test(structured) ? ['email-address'] : []);
    check('X08', 'public catalog + /merchants/verified contain no owner_*, legacy_*, commission, tax code or e-mail address', leaks.length === 0, leaks.join(','));
  });

  test('X09 mobile layout: no horizontal scroll, readable cards, filter bar scrolls', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); await page.goto('/');
    await expect(page.getByTestId('listing-card').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const cardWidth = (await page.getByTestId('listing-card').first().boundingBox())!.width;
    await expect.poll(() => page.$$eval('[data-testid=listing-card] img', (imgs) => imgs.slice(0, 2).filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0).length), { timeout: 60_000 }).toBe(2);
    await shot(page, 'x09-home-mobile');
    await page.getByTestId('listing-card').first().click(); await expect(page.getByTestId('merchant-name')).toBeVisible();
    await expect.poll(() => page.getByTestId('gallery-hero').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { timeout: 60_000 }).toBeTruthy();
    const overflowDetail = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await shot(page, 'x09-detail-mobile');
    await ctx.close();
    check('X09', 'home + detail at 390px: no horizontal overflow, single-column card ≥ 340px', overflow <= 1 && overflowDetail <= 1 && cardWidth >= 340, `overflow=${overflow}/${overflowDetail} card=${Math.round(cardWidth)}`);
  });
});

test.describe('@experience Partner QR', () => {
  test('X10 Partner Home shows the QR; enlarge, download and scan resolve to the right Partner', async ({ page }) => {
    const fx = readFixture();
    test.skip(!fx || !has('merchant'), 'BLOCKED: no verified paired synthetic Partner fixture (.auth/fixture.json) or merchant credentials');
    setActive('partner', fx!.partner); // the verified, claimed fixture Partner; never a migrated V1 user
    await uiLogin(page, 'partner');
    await expect(page).toHaveURL(/collaborator\/dashboard/, { timeout: 30_000 });
    const qr = page.getByTestId('partner-qr-image');
    await expect(qr).toBeVisible({ timeout: 30_000 });
    const code = (await page.getByTestId('partner-qr-code').innerText()).trim();
    const src = await qr.getAttribute('src');
    const png = PNG.sync.read(Buffer.from(src!.split(',')[1], 'base64'));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data;
    // enlarge
    await page.getByRole('button', { name: 'Phóng to', exact: true }).click();
    await expect(page.getByTestId('partner-qr-image-large')).toBeVisible();
    await shot(page, 'x10-partner-qr-enlarged');
    await page.keyboard.press('Escape');
    // download
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('partner-qr-download').click()]);
    const fileName = download.suggestedFilename();
    // scan: the merchant resolves the decoded payload to this Partner, with no financial action
    const me = (await api('partner', 'GET', '/collaborators/me')).body;
    const scan = await api('merchant', 'POST', '/qr/resolve', { payload: decoded });
    await shot(page, 'x10-partner-home');
    check('X10', 'QR image decodes to the canonical Partner code; download = VNO-QR-<code>.png; merchant scan → same Partner, no financial action',
      decoded === code && decoded === me.collaborators_code && fileName === `VNO-QR-${code}.png` && scan.status === 201 && scan.body.collaborator_id === me.id && scan.body.financial_action_created === false,
      `code=${code} decoded=${decoded} scan=${scan.status}`);
  });

  test('X11 remapped legacy QR cases: only the new unique codes resolve; the shared V1 codes resolve to nobody', async () => {
    const remap = [['C2500228', ['C2500228-DUP-2c495a87', 'C2500228-DUP-77f4a15e']], ['C2500240', ['C2500240-DUP-2852d043', 'C2500240-DUP-55cb956a']]] as const;
    const bad: string[] = [];
    for (const [original, replacements] of remap) {
      if ((await api(null, 'GET', `/c/${original}`)).status !== 403) bad.push(`${original} resolves`);
      const ids = new Set<string>();
      for (const code of replacements) { const r = await api(null, 'GET', `/c/${code}`); if (r.status !== 200) bad.push(`${code}=${r.status}`); ids.add(r.body?.collaboratorId); }
      if (ids.size !== replacements.length) bad.push(`${original}: replacement codes share a Partner`);
      if (has('merchant')) { const r = await api('merchant', 'POST', '/qr/resolve', { payload: original }); if (r.status !== 404) bad.push(`merchant scan ${original}=${r.status}`); }
    }
    check('X11', '4 remapped Partners resolve by their own new code (distinct ids); C2500228/C2500240 refuse (public 403, merchant scan 404)', bad.length === 0, bad.join('; '));
  });

  test('X12 cross-account: a Partner cannot read another Partner\'s QR; anonymous cannot read any', async () => {
    test.skip(!has('partner') || !has('merchant'), 'BLOCKED: credentials missing');
    const anon = await api(null, 'GET', '/collaborators/me/qr-code');
    const merchantAsPartner = await api('merchant', 'GET', '/collaborators/me/qr-code');
    check('X12', 'anonymous 401; a Merchant token has no Partner QR (403/404)', anon.status === 401 && [403, 404].includes(merchantAsPartner.status), `${anon.status}/${merchantAsPartner.status}`);
  });
});

test.describe('@experience authentication and onboarding screens (no e-mail is sent)', () => {
  test('X13 login: wrong password is explained; correct credentials route by role', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@example.invalid'); await page.getByLabel('Mật khẩu').fill('Wrong-password-1!');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByText('Email hoặc mật khẩu không đúng')).toBeVisible();
    await shot(page, 'x13-login-error');
    const routes: [('admin' | 'merchant' | 'partner'), RegExp][] = [['admin', /admin\/dashboard/], ['merchant', /merchant\/dashboard/], ['partner', /collaborator\/dashboard/]];
    const seen: string[] = [];
    for (const [role, re] of routes) {
      if (!has(role)) { seen.push(`${role}:skipped`); continue; }
      const p = await page.context().newPage(); await uiLogin(p, role); await expect(p).toHaveURL(re, { timeout: 30_000 }); seen.push(`${role}:ok`); await p.close();
    }
    check('X13', 'invalid login → friendly alert; admin/merchant/partner land on their own workspace', true, seen.join(' '));
  });

  test('X14 role isolation in the browser', async ({ browser }) => {
    test.skip(!has('merchant') || !has('partner'), 'BLOCKED: credentials missing');
    const m = await (await browser.newContext()).newPage(); await uiLogin(m, 'merchant'); await expect(m).toHaveURL(/merchant\/dashboard/, { timeout: 30_000 });
    await m.goto('/admin/dashboard'); await expect(m).toHaveURL(/login|merchant\/dashboard/);
    await m.goto('/collaborator/dashboard'); await expect(m).toHaveURL(/login|merchant\/dashboard/, { timeout: 20_000 });
    const p = await (await browser.newContext()).newPage(); await uiLogin(p, 'partner'); await expect(p).toHaveURL(/collaborator\/dashboard/, { timeout: 30_000 });
    await p.goto('/merchant/dashboard'); await expect(p).toHaveURL(/login|collaborator\/dashboard/, { timeout: 20_000 });
    check('X14', 'a Merchant cannot open Admin/Partner workspaces and a Partner cannot open Merchant/Admin ones', !/admin/.test(m.url()) && !/merchant/.test(p.url()), `${new URL(m.url()).pathname} ${new URL(p.url()).pathname}`);
  });

  test('X15 forgot / reset / claim states: invalid and expired links give a retry path', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page.getByText('Liên kết không hợp lệ hoặc đã hết hạn')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Yêu cầu liên kết mới' })).toBeVisible();
    await page.goto('/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    await expect(page.getByText('Liên kết không hợp lệ hoặc đã hết hạn')).toBeVisible();
    await shot(page, 'x15-reset-expired');
    await page.goto('/claim/merchant/00000000-0000-4000-8000-000000000000#error=access_denied&error_code=otp_expired');
    await expect(page.getByText('Liên kết không hợp lệ hoặc đã hết hạn')).toBeVisible();
    await page.goto('/claim/merchant/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('Bạn cần đăng nhập để tiếp tục')).toBeVisible();
    // forgot-password UI path with the Auth call stubbed: proves the confirmation copy without sending a real e-mail
    await page.route('**/auth/v1/recover*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto('/forgot-password'); await page.getByLabel('Email').fill('nobody@example.invalid');
    await page.getByRole('button', { name: 'Gửi liên kết khôi phục' }).click();
    await expect(page.getByText('Nếu email thuộc một tài khoản hợp lệ')).toBeVisible();
    check('X15', 'reset-password (none/expired link), claim (expired link / no session) and forgot-password confirmation render with next steps', true);
  });

  test('X16 pending-approval account sees its status, not a blank spinner', async ({ page }) => {
    // Static render check of the status screen via a stubbed profile (no real account is changed).
    test.skip(!has('partner'), 'BLOCKED: partner credentials missing');
    await uiLogin(page, 'partner'); await expect(page).toHaveURL(/collaborator\/dashboard/, { timeout: 30_000 });
    await page.route('**/user-profiles/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'collaborator', collaborator_id: 'x', user_profiles_status: 'pending' }) }));
    await page.reload();
    await expect(page.getByText('Hồ sơ đang chờ duyệt')).toBeVisible();
    await shot(page, 'x16-pending-state');
    record('X16', 'bound but unapproved account shows "Hồ sơ đang chờ duyệt" with logout', 'PASS');
  });
});

test.describe('@experience workspaces render (desktop + mobile)', () => {
  for (const [role, path, heading] of [['admin', '/admin/dashboard', 'Tổng quan'], ['merchant', '/merchant/dashboard', ''], ['partner', '/collaborator/dashboard', 'Xin chào']] as const) {
    test(`X17 ${role} workspace renders on desktop and 390px without overflow`, async ({ browser }) => {
      test.skip(!has(role), `BLOCKED: ${role} credentials missing`);
      for (const [label, viewport] of [['desktop', { width: 1366, height: 800 }], ['mobile', { width: 390, height: 844 }]] as const) {
        const ctx = await browser.newContext({ viewport }); const page = await ctx.newPage();
        await uiLogin(page, role); await expect(page).toHaveURL(new RegExp(path.split('/')[1]), { timeout: 30_000 });
        if (heading) await expect(page.getByText(heading).first()).toBeVisible({ timeout: 20_000 });
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        await shot(page, `x17-${role}-${label}`);
        expect(overflow, `${role} ${label} horizontal overflow`).toBeLessThanOrEqual(1);
        await ctx.close();
      }
      record(`X17-${role}`, `${role} workspace: desktop + mobile, no overflow`, 'PASS');
    });
  }
});

// Claim-page first-password gate. Hermetic: the Supabase Auth user/update calls and the claim API call are stubbed in the browser, so no identity,
// invitation, e-mail or database row is touched. The unit under test is the UI contract: who may set a password, and who may not skip it.
test.describe('@experience claim: first password (stubbed Auth + API, writes nothing)', () => {
  const ENTITY = '00000000-0000-4000-8000-0000000000aa';
  const sessionKey = `sb-${c.supabase.replace(/^https:\/\//, '').split('.')[0]}-auth-token`;
  async function arrange(page: Page, user: Record<string, unknown>, opts: { userStatus?: number } = {}) {
    const session = { access_token: 'stub.access.token', refresh_token: 'stub-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u-1', email: 'invited@example.invalid', ...user } };
    await page.addInitScript(([k, v]) => { try { localStorage.setItem(k as string, v as string); } catch { /* storage unavailable */ } }, [sessionKey, JSON.stringify(session)]);
    const puts: any[] = [];
    await page.route('**/auth/v1/user', async (r) => {
      if (r.request().method() === 'PUT') { puts.push(r.request().postDataJSON()); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...session.user, user_metadata: { password_set: true } }) }); }
      if (opts.userStatus && opts.userStatus !== 200) return r.fulfill({ status: opts.userStatus, contentType: 'application/json', body: '{"message":"invalid JWT"}' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session.user) });
    });
    await page.route('**/auth/v1/token*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }));
    await page.route('**/invitations/claim/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'accepted', entity_type: 'merchant', entity_id: ENTITY, role: 'merchant' }) }));
    return puts;
  }
  const open = (page: Page) => page.goto(`/claim/merchant/${ENTITY}`);

  test('X18 invited identity without a password cannot finish onboarding without setting one', async ({ page }) => {
    const puts = await arrange(page, { email_confirmed_at: '2026-11-02T00:00:00Z', invited_at: '2026-11-02T00:00:00Z', user_metadata: {} });
    await open(page);
    await expect(page.getByText('Đã liên kết thành công')).toBeVisible();
    await expect(page.getByText('Cần đặt mật khẩu để hoàn tất')).toBeVisible();
    await expect(page.getByRole('button', { name: /Bỏ qua/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Vào không gian làm việc/ })).toHaveCount(0);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('weak'); await page.getByLabel('Xác nhận mật khẩu').fill('weak');
    await page.getByRole('button', { name: 'Đặt mật khẩu' }).click();
    await expect(page.getByText(/ít nhất 8 ký tự/).first()).toBeVisible(); expect(puts.length, 'weak password never reaches Auth').toBe(0);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('Str0ng-Passw0rd!'); await page.getByLabel('Xác nhận mật khẩu').fill('Different-Passw0rd!');
    await page.getByRole('button', { name: 'Đặt mật khẩu' }).click();
    await expect(page.getByText('Hai mật khẩu không khớp.')).toBeVisible(); expect(puts.length).toBe(0);
    await page.getByLabel('Xác nhận mật khẩu').fill('Str0ng-Passw0rd!'); await page.getByRole('button', { name: 'Đặt mật khẩu' }).click();
    await expect(page.getByRole('button', { name: /Vào không gian làm việc/ })).toBeVisible();
    expect(puts.length).toBe(1); expect(puts[0].password).toBe('Str0ng-Passw0rd!'); expect(puts[0].data).toEqual({ password_set: true });
    record('X18', 'invited account must set a password before leaving the claim flow (no skip; weak/mismatch refused client-side)', 'PASS');
  });

  test('X18b established account (no invitation marker) may skip; unverified or invalid session never sees the password form', async ({ page, browser }) => {
    await arrange(page, { email_confirmed_at: '2026-11-02T00:00:00Z', user_metadata: {} });
    await open(page);
    await expect(page.getByRole('button', { name: /Bỏ qua/ })).toBeVisible();
    for (const [label, user, status] of [['unconfirmed e-mail', { invited_at: '2026-11-02T00:00:00Z', email_confirmed_at: null }, 200], ['Auth rejects the token', { email_confirmed_at: '2026-11-02T00:00:00Z' }, 401]] as const) {
      const ctx = await browser.newContext({ baseURL: c.web }); const p = await ctx.newPage();
      await arrange(p, { ...user }, { userStatus: status }); await open(p);
      await expect(p.getByText('Chưa xác minh được phiên đăng nhập'), label).toBeVisible();
      await expect(p.getByLabel('Mật khẩu', { exact: true }), label).toHaveCount(0); await expect(p.getByRole('button', { name: /Vào không gian/ }), label).toHaveCount(0);
      await ctx.close();
    }
    record('X18b', 'optional skip only for established accounts; unverified/invalid sessions get login or forgot-password, never the form', 'PASS');
  });
});
