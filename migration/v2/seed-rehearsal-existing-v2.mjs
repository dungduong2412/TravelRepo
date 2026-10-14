#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return [];
    let value = match[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    return [[match[1], value]];
  }));
}

const sourceEnv = parseEnv(await readFile(new URL('../../.env', import.meta.url), 'utf8'));
const sourceUrl = sourceEnv.SUPABASE_URL;
const sourceKey = sourceEnv.SUPABASE_SERVICE_ROLE_KEY;
const targetUrl = process.env.VNO_TARGET_URL;
const targetKey = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
if (!sourceUrl || !sourceKey || !targetUrl || !targetKey) throw new Error('source and target Supabase settings are required');
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(targetUrl).hostname)) throw new Error('target must be local rehearsal');

async function request(url, key, route, options = {}) {
  const response = await fetch(`${url.replace(/\/$/, '')}${route}`, {
    ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const merchants = await request(sourceUrl, sourceKey,
  '/rest/v1/merchant_details?select=merchant_system_id,merchant_code,merchant_name,merchant_email,merchant_phone,owner_email,owner_phone,legacy_restaurant_id');
const collaborators = await request(sourceUrl, sourceKey,
  '/rest/v1/collaborators?select=id,collaborators_code,collaborators_name,collaborators_email,collaborators_phone,legacy_middleman_id');
const categories = await request(sourceUrl, sourceKey,
  '/rest/v1/categories?select=id,category_name,category_name_vi,category_description,category_icon,is_active,display_order,legacy_category_id,legacy_tenant_id');

await request(targetUrl, targetKey, '/rest/v1/merchant_details?on_conflict=merchant_system_id', {
  method: 'POST', headers: { 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(merchants.map((row) => ({ ...row, owner_password: null })))
});
await request(targetUrl, targetKey, '/rest/v1/collaborators?on_conflict=id', {
  method: 'POST', headers: { 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(collaborators.map((row) => ({ ...row, collaborators_password: null })))
});
await request(targetUrl, targetKey, '/rest/v1/categories?on_conflict=id', {
  method: 'POST', headers: { 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(categories)
});

console.log(JSON.stringify({ seeded_existing_v2_merchants: merchants.length,
  seeded_existing_v2_collaborators: collaborators.length,
  seeded_existing_v2_categories: categories.length }, null, 2));
