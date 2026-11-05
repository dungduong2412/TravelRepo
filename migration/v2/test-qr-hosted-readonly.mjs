#!/usr/bin/env node
// Read-only legacy Partner QR compatibility check against the HOSTED UAT stack, using the ACTUAL imported records (no fixtures created).
//   GET  <api>/c/<code>        public QR resolution, for every V1 Partner code in the sealed snapshot
//   POST <api>/qr/resolve      authenticated merchant scan (raw code and URL-wrapped payload) for a sample, using the synthetic UAT
//                              merchant from e2e-uat/.env.uat.local if present (sign-in only; the endpoint returns financial_action_created:false)
// Expectation (collaborators.service.ts resolveByCode): 200 iff exactly one verified collaborator has that code, otherwise 403 (fail closed).
// After the E1 remediation every one of the 312 Partners resolves by its own unique code; the 4 Partners that shared V1 codes use the pinned
// <code>-DUP-<id8> replacement codes, and the two original duplicated codes must resolve to nobody (never to a 'first match').
// Usage: test-qr-hosted-readonly.mjs <snapshot-dir> <evidence.json> [api-url]    env: VNO_TARGET_URL, VNO_TARGET_SERVICE_ROLE_KEY
// Evidence contains codes, ids and statuses only (no names, e-mails or phone numbers).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pinnedPartnerRemap } from './partner-code-remap.mjs';

const [snapDir, evidenceOut, apiArg] = process.argv.slice(2);
const API = (apiArg || 'https://vno-api-uat.up.railway.app').replace(/\/$/, '');
const SUPA = process.env.VNO_TARGET_URL, KEY = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
if (!snapDir || !evidenceOut || !SUPA || !KEY) throw new Error('usage: test-qr-hosted-readonly.mjs <snapshot-dir> <evidence.json> [api-url]; VNO_TARGET_URL and VNO_TARGET_SERVICE_ROLE_KEY required');
if (new URL(SUPA).hostname !== 'hsezyogfxgnkpweoqqny.supabase.co') throw new Error('refusing: not the approved UAT Supabase project');
if (!['vno-api-uat.up.railway.app', '127.0.0.1', 'localhost'].includes(new URL(API).hostname)) throw new Error('refusing: API is not the UAT backend');
const TENANT = 'b7688a1c-23f9-637d-c2fb-3a16eb1befd2';
const lower = (v) => (v == null ? null : String(v).toLowerCase());
const checks = [];
const check = (id, name, pass, evidence) => { checks.push({ id, name, status: pass ? 'PASS' : 'FAIL', evidence }); console.error(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${JSON.stringify(evidence).slice(0, 200)}`); };
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function rest(path) { const rows = []; for (let off = 0; ; off += 1000) { const r = await fetch(`${SUPA}/rest/v1/${path}&limit=1000&offset=${off}`, { headers: H }); if (!r.ok) throw new Error(`GET ${path.split('?')[0]} ${r.status}`); const j = await r.json(); rows.push(...j); if (j.length < 1000) break; } return rows; }
async function call(route, { token, method = 'GET', body } = {}) {
  const r = await fetch(`${API}${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json };
}

const source = readFileSync(join(snapDir, 'tables/Emos_MdmService/dbo.RestaurantMiddleman.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const remap = new Map(pinnedPartnerRemap(source).map((m) => [m.legacy_id, m]));
const expectedCode = (s) => remap.get(lower(s.Id))?.replacement_code ?? s.Code;
const hosted = new Map((await rest(`collaborators?select=id,collaborators_code,collaborators_verified,collaborators_status,legacy_middleman_id&legacy_tenant_id=eq.${TENANT}`)).map((c) => [lower(c.legacy_middleman_id), c]));
const allByCode = new Map(); for (const c of await rest('collaborators?select=id,collaborators_code,collaborators_verified')) allByCode.set(c.collaborators_code, [...(allByCode.get(c.collaborators_code) || []), c]);

const health = await call('/health');
check('Q0', 'UAT API is healthy and reads the hosted UAT database', health.status === 200, { status: health.status });

// Q1: every V1 Partner code through the public route
let merchantTokenForNegatives = null;
const failures = []; const tally = { resolved_200: 0, refused_403: 0 };
let i = 0;
const queue = source.slice();
await Promise.all(Array.from({ length: 4 }, async () => {
  for (;;) {
    const s = queue.shift(); if (!s) return;
    const h = hosted.get(lower(s.Id));
    const code = expectedCode(s);
    const unique = (allByCode.get(code) || []).length === 1;
    const wantOk = Boolean(h) && h.collaborators_code === code && h.collaborators_verified === true && unique;
    const r = await call(`/c/${encodeURIComponent(code)}`);
    const gotOk = r.status === 200 && r.json?.verified === true && lower(r.json?.collaboratorId) === lower(h?.id);
    if (r.status === 200) tally.resolved_200++; else if (r.status === 403) tally.refused_403++;
    if (wantOk ? !gotOk : r.status !== 403) failures.push({ code, legacy_id: lower(s.Id), want: wantOk ? 200 : 403, got: r.status });
    i++;
  }
}));
check('Q1', `public GET /c/<code> for all ${source.length} imported Partners (own unique code): 200 + that Partner's id`, failures.length === 0 && i === source.length && tally.resolved_200 === source.length,
  { checked: i, ...tally, v1_verified: source.filter((s) => s.IsVerified).length, hosted_verified: [...hosted.values()].filter((c) => c.collaborators_verified).length, failures: failures.slice(0, 10) });
check('Q2', 'unknown code is refused (403) without revealing whether it exists', (await call('/c/C9999999')).status === 403, {});

// Q3: authenticated merchant scan with the synthetic UAT merchant (if its local credentials exist)
const envFile = new URL('../../e2e-uat/.env.uat.local', import.meta.url);
if (existsSync(envFile)) {
  const env = Object.fromEntries(readFileSync(envFile, 'utf8').split('\n').filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim().replace(/^"|"$/g, '')]; }));
  const anon = env.E2E_SUPABASE_ANON_KEY || readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('SUPABASE_ANON_KEY='))?.split('=').slice(1).join('=');
  if (env.E2E_MERCHANT_EMAIL && env.E2E_MERCHANT_PASSWORD && anon) {
    const tok = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email: env.E2E_MERCHANT_EMAIL, password: env.E2E_MERCHANT_PASSWORD }) }).then((r) => r.json()).catch(() => ({}));
    if (tok.access_token) {
      merchantTokenForNegatives = tok.access_token;
      const sample = [...source.filter((s) => !remap.has(lower(s.Id))).slice(0, 8), ...source.filter((s) => remap.has(lower(s.Id)))];
      const bad = [];
      for (const s of sample) {
        const code = expectedCode(s);
        for (const payload of [code, `https://vno-web-uat.up.railway.app/c/${code}`]) {
          const r = await call('/qr/resolve', { token: tok.access_token, method: 'POST', body: { payload } });
          if (!(r.status === 201 && r.json?.collaborator_code === code && lower(r.json?.collaborator_id) === lower(hosted.get(lower(s.Id)).id) && r.json?.financial_action_created === false)) bad.push({ code, form: payload === code ? 'raw' : 'url', status: r.status });
        }
      }
      check('Q3', `authenticated merchant POST /qr/resolve: ${sample.length} imported Partner codes (8 unchanged + the 4 remapped), raw and URL-wrapped, resolve to the right Partner with no financial action`, bad.length === 0, { codes: sample.length, requests: sample.length * 2, failures: bad });
    } else checks.push({ id: 'Q3', name: 'authenticated merchant scan', status: 'NOT_RUN', evidence: { reason: 'synthetic merchant sign-in was not possible' } });
  } else checks.push({ id: 'Q3', name: 'authenticated merchant scan', status: 'NOT_RUN', evidence: { reason: 'no synthetic merchant credentials configured' } });
} else checks.push({ id: 'Q3', name: 'authenticated merchant scan', status: 'NOT_RUN', evidence: { reason: 'e2e-uat/.env.uat.local not present' } });

// Q4: the two original duplicated codes resolve to nobody - publicly (403) and from an authenticated Merchant context (404); never a first match
const dupCodes = [...new Set([...remap.values()].map((m) => m.original_code))];
const pub = await Promise.all(dupCodes.map((c) => call(`/c/${c}`)));
const q4Auth = [];
if (merchantTokenForNegatives) for (const c of dupCodes) { const r = await call('/qr/resolve', { token: merchantTokenForNegatives, method: 'POST', body: { payload: c } }); q4Auth.push({ code: c, status: r.status }); }
check('Q4', 'duplicate-code negative cases: C2500228 and C2500240 resolve to NO Partner (public 403; authenticated Merchant scan 404), no first-match guess', pub.every((r) => r.status === 403) && (merchantTokenForNegatives ? q4Auth.every((r) => r.status === 404) : true),
  { public: dupCodes.map((c, i) => ({ code: c, status: pub[i].status })), authenticated_merchant: merchantTokenForNegatives ? q4Auth : 'not run (no synthetic merchant sign-in)' });
// Q5: the four replacement codes each resolve to their own, distinct Partner
const q5 = await Promise.all([...remap.values()].map(async (m) => ({ m, r: await call(`/c/${m.replacement_code}`) })));
check('Q5', 'each of the 4 remapped Partners resolves by its new code to its own id (4 distinct ids)', q5.every(({ m, r }) => r.status === 200 && lower(r.json?.collaboratorId) === m.legacy_id) && new Set(q5.map(({ r }) => r.json?.collaboratorId)).size === 4,
  { resolved: q5.map(({ m, r }) => ({ code: m.replacement_code, status: r.status, id_matches_legacy_id: lower(r.json?.collaboratorId) === m.legacy_id })) });

const out = { generated_utc: new Date().toISOString(), api: new URL(API).hostname, pass: checks.filter((c) => c.status === 'PASS').length, fail: checks.filter((c) => c.status === 'FAIL').length, not_run: checks.filter((c) => c.status === 'NOT_RUN').length, checks };
writeFileSync(evidenceOut, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ pass: out.pass, fail: out.fail, not_run: out.not_run }));
process.exit(out.fail ? 1 : out.not_run ? 3 : 0);
