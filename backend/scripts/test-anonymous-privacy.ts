// Negative privacy contract for every ANONYMOUS endpoint.
//   unit  (always)          : hostile rows with nested private objects go through the projections; nothing private may survive.
//   live  (BASE_URL=<api>)  : every anonymous GET is fetched and deep-scanned (keys at any depth, nested objects and arrays, string values).
// Usage: BASE_URL=https://vno-api-uat.up.railway.app node -r ts-node/register/transpile-only scripts/test-anonymous-privacy.ts
import assert from 'node:assert/strict';
import { toPublicDetail, toPublicListing } from '../src/modules/public-catalog/public-catalog.projection';

// Keys that must never appear at any depth of an anonymous response.
const FORBIDDEN_KEY = /^(owner_.*|legacy_.*|.*password.*|.*tax.*|.*commission.*|.*bank.*|merchant_email|merchant_phone|merchant_contact_email|collaborators_(email|phone|password|bank.*|qr_code)|user_id|auth_user_id|created_by.*|approved_by|uploaded_by|object_path|bucket_id|original_filename|sha256_hex|invite_link|.*token.*)$/i;
// Free-text fields written for the public (a business address in a description is intentional); everything else is scanned for contact data.
const FREE_TEXT = new Set(['merchant_description', 'description', 'summary', 'category_description', 'org_description']);
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /^(\+?84|0)\d{8,10}$/;

export function privacyViolations(value: unknown, path = '$'): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) value.forEach((v, i) => out.push(...privacyViolations(v, `${path}[${i}]`)));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY.test(k)) out.push(`${path}.${k}: forbidden key`);
      if (typeof v === 'string' && !FREE_TEXT.has(k)) {
        if (EMAIL.test(v) && k !== 'org_email') out.push(`${path}.${k}: e-mail address in a structured field`);
        if (PHONE.test(v.replace(/[\s.-]/g, '')) && !['phone', 'org_phone', 'merchant_contact_phone'].includes(k)) out.push(`${path}.${k}: phone number in an unexpected field`);
      }
      out.push(...privacyViolations(v, `${path}.${k}`));
    }
  }
  return out;
}

let passed = 0;
const t = async (name: string, fn: () => void | Promise<void>) => { await fn(); passed++; console.log(`PASS ${name}`); };

(async () => {
  await t('detector flags nested private keys and structured contact data (self-test)', () => {
    assert.equal(privacyViolations({ a: [{ b: { owner_email: 'x' } }] }).length, 1);
    assert.equal(privacyViolations({ x: 'someone@example.com' }).length, 1);
    assert.equal(privacyViolations({ description: 'info@shop.vn' }).length, 0);
    assert.equal(privacyViolations({ legacy_is_banned: false }).length, 1);
  });

  const hostile = {
    merchant_system_id: '11111111-1111-1111-1111-111111111111', merchant_code: 'M1', merchant_name: 'Shop', merchant_description: 'text',
    merchant_contact_phone: '0900 000 111', merchant_discount_type: 'percentage', merchant_discount_value: 0.05,
    owner_name: 'Nguyen', owner_email: 'o@x.vn', owner_phone: '0911111111', owner_tax_code: 'T', merchant_email: 'o@x.vn', merchant_phone: '0911111111',
    merchant_commission_value: 0.2, legacy_tax_code: 'L', legacy_extra_properties: { bank: { account: '123' } },
    nested: { owner: { email: 'n@x.vn' }, bank_account: '999' }, password: 'p', owner_password: 'p', access_token: 't',
  };
  await t('projections drop hostile top-level and nested private data', () => {
    const v = [toPublicListing(hostile, [], 'a'), toPublicDetail(hostile, [], ['a', 'b'])];
    assert.deepEqual(privacyViolations(v), []);
    const json = JSON.stringify(v);
    for (const secret of ['Nguyen', 'o@x.vn', '0911111111', '"123"', '999', 'n@x.vn']) assert.ok(!json.includes(secret), secret);
  });

  const base = process.env.BASE_URL?.replace(/\/$/, '');
  if (!base) { console.log(`${passed} passed (unit only; set BASE_URL for the live scan)`); return; }

  const get = async (path: string) => { const r = await fetch(base + path, { redirect: 'manual' }); const text = await r.text(); let body: any = null; try { body = JSON.parse(text); } catch { /* not json */ } return { status: r.status, body }; };
  const scan = async (path: string, expect: number[] = [200]) => {
    const r = await get(path);
    assert.ok(expect.includes(r.status), `${path} -> HTTP ${r.status}`);
    assert.deepEqual(privacyViolations(r.body), [], path);
    return r;
  };

  await t('legacy GET /merchants/verified is allow-listed', async () => {
    const r = await scan('/merchants/verified');
    assert.ok(Array.isArray(r.body) && r.body.length > 0);
    const allowed = ['merchant_system_id', 'merchant_code', 'merchant_name', 'merchant_description', 'merchant_contact_phone', 'merchant_discount_type', 'merchant_discount_value', 'merchant_priority', 'new_address_line', 'new_address_ward', 'new_address_city'];
    assert.ok(r.body.every((m: any) => Object.keys(m).every((k) => allowed.includes(k))), 'unexpected column');
  });
  const ids: string[] = [];
  await t('GET /public/merchants (every page) and every GET /public/merchants/:id', async () => {
    for (let page = 1; ; page++) { const r = await scan(`/public/merchants?page=${page}&page_size=60`); ids.push(...r.body.items.map((i: any) => i.id)); if (ids.length >= r.body.total || !r.body.items.length) break; }
    assert.ok(ids.length > 0);
    for (const id of ids) await scan(`/public/merchants/${id}`);
  });
  await t('GET /public/categories, /categories, /categories/active, /categories/:id', async () => {
    await scan('/public/categories'); const all = await scan('/categories'); await scan('/categories/active');
    assert.ok(all.body.every((c: any) => !('legacy_category_id' in c) && !('legacy_tenant_id' in c)));
    await scan(`/categories/${all.body[0].id}`);
  });
  await t('GET /organization-profile exposes only organisation profile fields', async () => {
    const r = await scan('/organization-profile');
    if (r.body) assert.ok(Object.keys(r.body).every((k) => ['id', 'org_id', 'org_name', 'org_address', 'org_phone', 'org_email', 'org_description', 'org_avatar_url', 'created_at', 'updated_at'].includes(k)));
  });
  await t('anonymous approved-media feed is closed (401) for Merchants and Partners', async () => {
    for (const type of ['merchant', 'collaborator']) assert.equal((await get(`/media/approved/${type}/${ids[0]}`)).status, 401);
  });
  await t('public media: unknown ids are 404, known gallery ids redirect', async () => {
    assert.equal((await get('/public/media/00000000-0000-4000-8000-000000000000')).status, 404);
    const withImage = (await get('/public/merchants?page_size=60')).body.items.find((i: any) => i.image_url);
    const r = await fetch(`${base}${withImage.image_url}?size=thumb`, { redirect: 'manual' });
    assert.equal(r.status, 302);
  });
  await t('QR public route refuses unknown codes without data', async () => {
    const r = await get('/c/C9999999'); assert.equal(r.status, 403); assert.deepEqual(privacyViolations(r.body), []);
  });
  console.log(`${passed} passed (unit + live scan of ${base}, ${ids.length} merchant details)`);
})().catch((e) => { console.error('FAIL', e.message.slice(0, 600)); process.exit(1); });
