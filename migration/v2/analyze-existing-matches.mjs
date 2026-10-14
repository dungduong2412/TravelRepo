#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SNAPSHOT = process.env.VNO_SNAPSHOT_DIR ||
  '/Users/dungduongdinhquoc/Documents/VNO/phase-d1-20261013/snapshot-3';
const OUTPUT = process.env.VNO_D2_PRIVATE_DIR ||
  '/Users/dungduongdinhquoc/Documents/VNO/phase-d2-20261013';
const EXPECTED_TENANT = 'b7688a1c-23f9-637d-c2fb-3a16eb1befd2';

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return [];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[match[1], value]];
  }));
}

async function jsonl(relative) {
  const text = await readFile(path.join(SNAPSHOT, relative), 'utf8');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const norm = (value) => value == null ? null : String(value).trim().toLocaleLowerCase('en-US');
const digits = (value) => value == null ? null : String(value).replace(/\D/g, '');
const id = (value) => value == null ? null : String(value).toLowerCase();
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');

async function main() {
  const manifest = JSON.parse(await readFile(path.join(SNAPSHOT, 'manifest.json'), 'utf8'));
  if (id(manifest.tenant_id) !== EXPECTED_TENANT) throw new Error('sealed snapshot tenant mismatch');

  const env = { ...parseEnv(await readFile(new URL('../../.env', import.meta.url), 'utf8')), ...process.env };
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (route) => {
    const response = await fetch(`${url}${route}`, { headers });
    if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
    return response.json();
  };

  const [sourceMerchants, sourceCollaborators, sourceUsers, v2Merchants, v2Collaborators, profiles] =
    await Promise.all([
      jsonl('tables/Emos_MdmService/dbo.Restaurant.jsonl'),
      jsonl('tables/Emos_MdmService/dbo.RestaurantMiddleman.jsonl'),
      jsonl('tables/Emos_Identity/dbo.AbpUsers.jsonl'),
      get('/rest/v1/merchant_details?select=merchant_system_id,legacy_restaurant_id,merchant_code,merchant_email,merchant_phone,merchant_name,owner_email,owner_phone'),
      get('/rest/v1/collaborators?select=id,legacy_middleman_id,collaborators_code,collaborators_email,collaborators_phone,collaborators_name'),
      get('/rest/v1/user_profiles?select=id,user_id,email,role,merchant_id,collaborator_id')
    ]);

  const authUsers = [];
  for (let page = 1; ; page += 1) {
    const result = await get(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    const batch = result.users || [];
    authUsers.push(...batch);
    if (batch.length < 1000) break;
  }

  function classify(source, targets, fields) {
    const out = [];
    for (const row of source) {
      const levels = fields.map(({ source: sk, target: tk, normalize }) => ({
        field: sk,
        value: normalize(row[sk]),
        matches: targets.filter((target) => {
          const sourceValue = normalize(row[sk]);
          return sourceValue && sourceValue === normalize(target[tk]);
        })
      }));
      const chosen = levels.find((level) => level.matches.length > 0);
      out.push({
        legacy_id_hash: hash(id(row.Id)),
        outcome: !chosen ? 'new' : chosen.matches.length === 1 ? 'matched' : 'conflict',
        rule: chosen?.field || null,
        candidate_count: chosen?.matches.length || 0,
        candidate_id_hashes: (chosen?.matches || []).map((target) =>
          hash(id(target.merchant_system_id || target.id)))
      });
    }
    return out;
  }

  const merchantMatches = classify(sourceMerchants, v2Merchants, [
    { source: 'Id', target: 'legacy_restaurant_id', normalize: id },
    { source: 'Code', target: 'merchant_code', normalize: norm },
    { source: 'Email', target: 'merchant_email', normalize: norm },
    { source: 'Email', target: 'owner_email', normalize: norm },
    { source: 'Phone', target: 'merchant_phone', normalize: digits },
    { source: 'Phone', target: 'owner_phone', normalize: digits }
  ]);
  const collaboratorMatches = classify(sourceCollaborators, v2Collaborators, [
    { source: 'Id', target: 'legacy_middleman_id', normalize: id },
    { source: 'Code', target: 'collaborators_code', normalize: norm },
    { source: 'Email', target: 'collaborators_email', normalize: norm },
    { source: 'Phone', target: 'collaborators_phone', normalize: digits }
  ]);

  const authEmail = new Map();
  for (const user of authUsers) {
    const keyEmail = norm(user.email);
    if (!keyEmail) continue;
    authEmail.set(keyEmail, [...(authEmail.get(keyEmail) || []), user]);
  }
  const profileEmail = new Map();
  for (const profile of profiles) {
    const keyEmail = norm(profile.email);
    if (!keyEmail) continue;
    profileEmail.set(keyEmail, [...(profileEmail.get(keyEmail) || []), profile]);
  }
  const authMatches = sourceUsers.map((user) => {
    const byId = authUsers.filter((target) => id(target.id) === id(user.Id));
    const byEmail = authEmail.get(norm(user.Email)) || [];
    const candidates = byId.length ? byId : byEmail;
    const matchedProfiles = profileEmail.get(norm(user.Email)) || [];
    return {
      legacy_id_hash: hash(id(user.Id)),
      active: !user.IsDeleted && user.IsActive !== false,
      outcome: candidates.length === 0 ? 'new' : candidates.length === 1 ? 'matched' : 'conflict',
      rule: byId.length ? 'legacy_uuid' : byEmail.length ? 'email_ci' : null,
      candidate_count: candidates.length,
      profile_count: matchedProfiles.length,
      role_check: matchedProfiles.length === 1 ? 'requires-source-role-comparison' : 'not-auto-approved'
    };
  });

  const summarize = (rows) => Object.fromEntries(
    ['matched', 'new', 'conflict'].map((value) => [value, rows.filter((row) => row.outcome === value).length])
  );
  const report = {
    generated_at_utc: new Date().toISOString(),
    snapshot_manifest_sha256: hash(await readFile(path.join(SNAPSHOT, 'manifest.json'))),
    tenant_id: EXPECTED_TENANT,
    live_v2_counts: {
      merchants: v2Merchants.length,
      collaborators: v2Collaborators.length,
      profiles: profiles.length,
      auth_users: authUsers.length
    },
    source_counts: {
      merchants: sourceMerchants.length,
      collaborators: sourceCollaborators.length,
      identity_users: sourceUsers.length
    },
    merchants: { summary: summarize(merchantMatches), records: merchantMatches },
    collaborators: { summary: summarize(collaboratorMatches), records: collaboratorMatches },
    auth: { summary: summarize(authMatches), active: authMatches.filter((r) => r.active).length, records: authMatches },
    decision_rules: [
      'legacy UUID, then exact code, then case-insensitive email, then normalized phone',
      'name-only similarity is never an automatic match',
      'multiple candidates or a role/entity disagreement is a blocking conflict',
      'unmatched V2 rows are preserved and never overwritten'
    ]
  };
  await mkdir(OUTPUT, { recursive: true, mode: 0o700 });
  await writeFile(path.join(OUTPUT, 'existing-v2-match-analysis.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    output: path.join(OUTPUT, 'existing-v2-match-analysis.json'),
    live_v2_counts: report.live_v2_counts,
    merchants: report.merchants.summary,
    collaborators: report.collaborators.summary,
    auth: report.auth.summary,
    active_source_users: report.auth.active
  }, null, 2));
}

await main();
