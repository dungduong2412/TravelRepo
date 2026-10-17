#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir, realpath, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ACCEPTED_SNAPSHOT =
  '/Users/dungduongdinhquoc/Documents/VNO/phase-d1-20261013/snapshot-3';
const SNAPSHOT = process.env.VNO_SNAPSHOT_DIR || ACCEPTED_SNAPSHOT;
const ACCEPTED_MANIFEST_SHA256 =
  'da291214739f71cd2c5d02a356f5ea73cbb66cc36914de150d74a0b97b7abfa8';
const PRIVATE_DIR = process.env.VNO_D2_PRIVATE_DIR ||
  '/Users/dungduongdinhquoc/Documents/VNO/phase-d2-20261013';
const TENANT = 'b7688a1c-23f9-637d-c2fb-3a16eb1befd2';
const SOURCE_ZONE = 'Asia/Bangkok'; // Microsoft "SE Asia Standard Time" via CLDR.
const args = new Set(process.argv.slice(2));
const INCLUDE_AUTH = args.has('--include-auth');
const INCLUDE_MEDIA = args.has('--include-media');

const lower = (v) => v == null ? null : String(v).toLowerCase();
const norm = (v) => v == null ? null : String(v).trim().toLocaleLowerCase('en-US');
const digits = (v) => v == null ? null : String(v).replace(/\D/g, '');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const uuidFrom = (value) => {
  const hex = sha256(value).slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
};
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v || '');
const compact = (v) => v == null ? null : typeof v === 'string' ? v : JSON.stringify(v);
const decimal4 = (value) => {
  const [whole, fraction = ''] = String(value || 0).split('.');
  return BigInt(whole) * 10000n + BigInt((fraction + '0000').slice(0, 4));
};
const format4 = (value) => `${value / 10000n}.${String(value < 0n ? -(value % 10000n) : value % 10000n).padStart(4, '0')}`;

function toUtc(value) {
  if (!value || value.startsWith('0001-01-01')) return null;
  if (/Z$|[+-]\d\d:\d\d$/.test(value)) return new Date(value).toISOString();
  const milliseconds = value.replace(/(\.\d{3})\d+$/, '$1');
  return new Date(`${milliseconds}+07:00`).toISOString();
}

async function jsonl(relative) {
  const text = await readFile(path.join(SNAPSHOT, relative), 'utf8');
  return text.split('\n').filter(Boolean).map((line) => ({ row: JSON.parse(line), line }));
}

async function verifySeal() {
  const [resolvedSnapshot, resolvedAcceptedSnapshot] = await Promise.all([
    realpath(SNAPSHOT),
    realpath(ACCEPTED_SNAPSHOT),
  ]);
  if (resolvedSnapshot !== resolvedAcceptedSnapshot) {
    throw new Error('only the accepted snapshot-3 path may be imported');
  }
  const acceptanceBytes = await readFile(path.join(SNAPSHOT, 'acceptance-manifest.json'));
  const acceptanceDigest = (await readFile(
    path.join(SNAPSHOT, 'acceptance-manifest.sha256'), 'utf8'))
    .trim().split(/\s+/)[0];
  if (sha256(acceptanceBytes) !== acceptanceDigest) {
    throw new Error('acceptance manifest hash mismatch');
  }
  const acceptance = JSON.parse(acceptanceBytes);
  if (acceptance.status !== 'PASS') throw new Error('snapshot acceptance status is not PASS');
  const manifestBytes = await readFile(path.join(SNAPSHOT, 'manifest.json'));
  const expectedManifest = acceptance.snapshot_manifest_sha256 || acceptance.manifest_sha256;
  const actualManifest = sha256(manifestBytes);
  if (actualManifest !== ACCEPTED_MANIFEST_SHA256 ||
      (expectedManifest && actualManifest !== expectedManifest)) {
    throw new Error('manifest hash mismatch');
  }
  const checksumLines = (await readFile(path.join(SNAPSHOT, 'files.sha256'), 'utf8'))
    .split('\n').filter(Boolean);
  for (const line of checksumLines) {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) throw new Error('invalid files.sha256 format');
    const candidate = path.resolve(SNAPSHOT, match[2]);
    if (!candidate.startsWith(`${resolvedSnapshot}${path.sep}`)) {
      throw new Error('unsafe path in files.sha256');
    }
    const bytes = await readFile(candidate);
    if (sha256(bytes) !== match[1]) throw new Error(`sealed file hash mismatch: ${match[2]}`);
  }
  const manifest = JSON.parse(manifestBytes);
  if (lower(manifest.tenant_id) !== TENANT) throw new Error('tenant mismatch');
  return { manifest, manifest_sha256: sha256(manifestBytes), tracked_files: checksumLines.length };
}

class SupabaseTarget {
  constructor(url, key) {
    const parsed = new URL(url);
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) &&
        process.env.VNO_ALLOW_REMOTE_REHEARSAL !== 'I_UNDERSTAND_THIS_IS_NOT_PRODUCTION') {
      throw new Error('remote target blocked; this D2 runner defaults to isolated localhost only');
    }
    this.url = url.replace(/\/$/, '');
    this.key = key;
    this.headers = { apikey: key, Authorization: `Bearer ${key}` };
  }
  async request(route, options = {}) {
    const response = await fetch(`${this.url}${route}`, {
      ...options,
      headers: { ...this.headers, ...(options.headers || {}) }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${options.method || 'GET'} ${route}: HTTP ${response.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
  select(table, query = '') {
    return this.request(`/rest/v1/${table}?${query}`);
  }
  async upsert(table, rows, onConflict, batchSize = 250) {
    for (let i = 0; i < rows.length; i += batchSize) {
      await this.request(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows.slice(i, i + batchSize))
      });
    }
  }
  async createAuthUser(row) {
    return this.request('/auth/v1/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(row)
    });
  }
  async upload(bucket, objectPath, bytes, mime) {
    const encoded = objectPath.split('/').map(encodeURIComponent).join('/');
    return this.request(`/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`, {
      method: 'POST',
      headers: { 'content-type': mime, 'x-upsert': 'true' },
      body: bytes
    });
  }
}

function chooseExisting(source, targets, fields, idField, legacyIdField) {
  const candidates = new Map();
  for (const [sourceField, targetField, normalize] of fields) {
    const value = normalize(source[sourceField]);
    if (!value) continue;
    const matches = targets.filter((target) => normalize(target[targetField]) === value);
    for (const match of matches) candidates.set(match[idField], match);
  }
  const primaryCollision = targets.find((target) => lower(target[idField]) === lower(source.Id));
  if (primaryCollision) candidates.set(primaryCollision[idField], primaryCollision);
  if (candidates.size > 1) throw new Error(`ambiguous existing match for ${source.Id}`);
  if (candidates.size === 1) {
    const match = [...candidates.values()][0];
    const restartOwned = lower(match[legacyIdField]) === lower(source.Id) &&
      lower(match.legacy_tenant_id) === TENANT;
    if (!restartOwned) {
      throw new Error(`unreviewed existing-row match for ${source.Id}; import stopped before overwrite`);
    }
    return match[idField];
  }
  return lower(source.Id);
}

function redact(database, table, row) {
  const clone = structuredClone(row);
  const redacted = [];
  const remove = (...fields) => fields.forEach((field) => {
    if (field in clone && clone[field] != null) {
      clone[field] = '[REDACTED_NOT_IMPORTED]';
      redacted.push(field);
    }
  });
  if (database === 'Emos_Identity' && table === 'AbpUsers')
    remove('PasswordHash', 'SecurityStamp', 'ConcurrencyStamp');
  if (database === 'Emos_Identity' && table === 'OpenIddictTokens')
    remove('Payload', 'ReferenceId', 'ConcurrencyStamp');
  if (database === 'Emos_Identity' && table === 'AbpUserTokens') remove('Value');
  if (/Credential|ConnectionString/i.test(table)) remove('Value', 'Secret', 'Password', 'PrivateKey');
  return { payload: clone, redacted };
}

async function main() {
  const seal = await verifySeal();
  const url = process.env.VNO_TARGET_URL;
  const key = process.env.VNO_TARGET_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('VNO_TARGET_URL and VNO_TARGET_SERVICE_ROLE_KEY are required');
  const target = new SupabaseTarget(url, key);
  const batchId = process.env.VNO_IMPORT_BATCH_ID || uuidFrom(`vno-snapshot-3:${seal.manifest_sha256}`);

  const load = async (db, table) => (await jsonl(`tables/${db}/dbo.${table}.jsonl`)).map((x) => x.row);
  const [restaurants, collaborators, categories, categoryLinks, transactions, updateRequests,
    merchantImages, users, userRoles, roles, restaurantUsers] = await Promise.all([
    load('Emos_MdmService', 'Restaurant'), load('Emos_MdmService', 'RestaurantMiddleman'),
    load('Emos_MdmService', 'RestaurantCategory'), load('Emos_MdmService', 'RestaurantCategoryMap'),
    load('Emos_MdmService', 'RestaurantComTrack'), load('Emos_MdmService', 'MerchantUpdateRequests'),
    load('Emos_MdmService', 'MerchantImages'), load('Emos_Identity', 'AbpUsers'),
    load('Emos_Identity', 'AbpUserRoles'), load('Emos_Identity', 'AbpRoles'),
    load('Emos_MdmService', 'RestaurantUserMap')
  ]);

  await target.upsert('legacy_tenant_evidence', [{
    legacy_tenant_id: TENANT, source_tenant_name: 'Vietnam Number One',
    source_normalized_name: 'VIETNAM NUMBER ONE', identification_status: 'verified',
    evidence: { sealed_manifest_sha256: seal.manifest_sha256, phase: 'D1-accepted' },
    verified_by: 'phase-d2-import-runner', verified_at: new Date().toISOString()
  }], 'legacy_tenant_id');
  await target.upsert('legacy_migration_batches', [{
    id: batchId, legacy_tenant_id: TENANT, source_snapshot_at: seal.manifest.created_at_utc,
    source_inventory_sha256: seal.manifest_sha256, status: 'loading', started_at: new Date().toISOString(),
    notes: 'Phase D2 isolated rehearsal; sealed snapshot-3'
  }], 'id');

  const [existingMerchants, existingCollaborators, existingCategories] = await Promise.all([
    target.select('merchant_details', 'select=merchant_system_id,legacy_restaurant_id,legacy_tenant_id,merchant_code,merchant_email,merchant_phone,merchant_name,owner_email,owner_phone,merchants_status'),
    target.select('collaborators', 'select=id,legacy_middleman_id,legacy_tenant_id,collaborators_code,collaborators_email,collaborators_phone,collaborators_name'),
    target.select('categories', 'select=id,legacy_category_id,legacy_tenant_id,category_name,category_name_vi,category_icon,is_active,display_order')
  ]);

  const merchantId = new Map();
  const merchantRows = restaurants.map((r) => {
    const targetId = chooseExisting(r, existingMerchants, [
      ['Id', 'legacy_restaurant_id', lower], ['Code', 'merchant_code', norm],
      ['Email', 'merchant_email', norm], ['Email', 'owner_email', norm],
      ['Phone', 'merchant_phone', digits], ['Phone', 'owner_phone', digits]
    ], 'merchant_system_id', 'legacy_restaurant_id');
    const existingTarget = existingMerchants.find((merchant) => lower(merchant.merchant_system_id) === lower(targetId));
    merchantId.set(lower(r.Id), targetId);
    return {
      merchant_system_id: targetId, merchant_code: r.Code, merchant_name: r.Name,
      merchant_email: r.Email, merchant_phone: r.Phone,
      merchant_commission_type: 'percentage', merchant_commission_value: r.CommissionPerc,
      merchant_discount_type: 'percentage', merchant_discount_value: r.DiscountPerc,
      merchant_priority: r.Priority, merchant_registered_date: toUtc(r.CreationTime),
      merchant_verified_date: toUtc(r.VerifiedDate), merchant_last_update: toUtc(r.LastUpdateRequestDate || r.CreationTime),
      merchant_verified: r.IsVerified, owner_name: r.OwnerName, owner_phone: r.Phone,
      owner_email: r.Email, owner_password: null, merchant_description: r.Description,
      merchant_contact_phone: r.ContactPhone, new_address_city: r.Province,
      new_address_ward: r.Ward, new_address_line: r.Address,
      // Source numeric status remains in legacy_status. Do not reinterpret it as
      // the V2 operational lifecycle; preserve any governed pre-existing state.
      merchants_status: existingTarget?.merchants_status ?? null, legacy_restaurant_id: lower(r.Id),
      legacy_tenant_id: lower(r.TenantId), legacy_status: r.Status,
      legacy_is_banned: r.IsBanned, legacy_min_commission: r.MinCommission,
      legacy_tax_code: r.TaxCode, legacy_geo_position: r.GeoPosition,
      legacy_extra_properties: r.ExtraProperties, legacy_short_name: r.ShortName,
      legacy_rating: r.Rating, legacy_owner_user_id: r.OwnerId ? lower(r.OwnerId) : null,
      legacy_is_update_requesting: r.IsUpdateRequesting, legacy_last_banned_at: r.LastBannedDate,
      legacy_last_update_request_at: r.LastUpdateRequestDate, legacy_province: r.Province,
      legacy_district: r.District, legacy_ward: r.Ward, legacy_country: r.Country,
      legacy_country_id: r.CountryId ? lower(r.CountryId) : null,
      legacy_province_id: r.ProvinceId ? lower(r.ProvinceId) : null,
      legacy_district_id: r.DistrictId ? lower(r.DistrictId) : null,
      legacy_ward_id: r.WardId ? lower(r.WardId) : null
    };
  });
  await target.upsert('merchant_details', merchantRows, 'merchant_system_id');

  const collaboratorId = new Map();
  const collaboratorRows = collaborators.map((r) => {
    const targetId = chooseExisting(r, existingCollaborators, [
      ['Id', 'legacy_middleman_id', lower], ['Code', 'collaborators_code', norm],
      ['Email', 'collaborators_email', norm], ['Phone', 'collaborators_phone', digits]
    ], 'id', 'legacy_middleman_id');
    collaboratorId.set(lower(r.Id), targetId);
    return {
      id: targetId, collaborators_verified: r.IsVerified, collaborators_code: r.Code,
      collaborators_name: r.Name, collaborators_rating: r.Rating,
      collaborators_phone: r.Phone, collaborators_email: r.Email,
      collaborators_bank_name: r.BankName, collaborators_bank_acc_name: r.AccountName,
      collaborators_bank_acc_number: r.AccountNumber,
      collaborators_registered_date: toUtc(r.CreationTime), collaborators_password: null,
      collaborators_status: String(r.Status), legacy_middleman_id: lower(r.Id),
      legacy_tenant_id: lower(r.TenantId), legacy_status: r.Status,
      legacy_is_banned: r.IsBanned, legacy_extra_properties: r.ExtraProperties,
      legacy_verified_at: r.VerifiedDate, legacy_last_banned_at: r.LastBannedDate,
      legacy_image_id: r.Image ? lower(r.Image) : null
    };
  });
  await target.upsert('collaborators', collaboratorRows, 'id');

  const categoryId = new Map();
  const categoryRows = categories.map((r) => {
    const found = existingCategories.find((c) => lower(c.legacy_category_id) === lower(r.Id)) ||
      existingCategories.find((c) => norm(c.category_name_vi) === norm(r.Name) || norm(c.category_name) === norm(r.Name));
    const targetId = found?.id || lower(r.Id);
    categoryId.set(lower(r.Id), targetId);
    return { id: targetId,
      category_name: found ? found.category_name : r.Name,
      category_name_vi: found ? found.category_name_vi : r.Name,
      category_icon: found ? found.category_icon : r.Icon,
      is_active: found ? found.is_active : r.IsActive !== false,
      display_order: found ? found.display_order : r.Order || 0,
      legacy_category_id: lower(r.Id), legacy_tenant_id: lower(r.TenantId) };
  });
  await target.upsert('categories', categoryRows, 'id');
  await target.upsert('merchant_category_links', categoryLinks.map((r) => ({
    merchant_id: merchantId.get(lower(r.ResId)), category_id: categoryId.get(lower(r.ResCatId)),
    legacy_tenant_id: lower(r.TenantId)
  })), 'merchant_id,category_id');

  const transactionRows = transactions.map((r) => ({
    id: lower(r.Id), legacy_transaction_id: lower(r.Id), legacy_tenant_id: lower(r.TenantId),
    merchant_id: merchantId.get(lower(r.RestaurantId)) || null,
    collaborator_id: collaboratorId.get(lower(r.MiddlemanId)) || null,
    legacy_restaurant_id: r.RestaurantId ? lower(r.RestaurantId) : null,
    legacy_middleman_id: r.MiddlemanId ? lower(r.MiddlemanId) : null,
    legacy_branch_id: r.BranchId ? lower(r.BranchId) : null, legacy_status: r.Status,
    lifecycle_status: 'unmapped', payment_status: 'unverified', document_number: r.DocNbr,
    document_index: r.DocInx, document_date: r.DocDate, posting_date: r.PostingDate?.startsWith('0001-') ? null : r.PostingDate,
    confirmed_at: r.ConfirmDate, commission_date: r.CommissionDate,
    document_total: r.DocTotal, document_discount_amount: r.DocDiscountAmt,
    document_discount_percent: r.DocDiscountPerc, commission_percent: r.CommissionPer,
    commission_amount: r.CommissionAmt, currency_code: 'VND',
    legacy_extra_properties: r.ExtraProperties, legacy_creator_id: r.CreatorId ? lower(r.CreatorId) : null,
    legacy_notes: r.Note, legacy_creator_name: r.CreatorName,
    legacy_restaurant_display_name: r.RestaurantDisplayName,
    legacy_middleman_display_name: r.MiddlemanDisplayName,
    legacy_last_modified_at: r.LastModificationTime, legacy_last_modifier_id: r.LastModifierId ? lower(r.LastModifierId) : null,
    legacy_concurrency_stamp: r.ConcurrencyStamp, legacy_creation_time: r.CreationTime,
    source_timezone: SOURCE_ZONE, document_date_utc: toUtc(r.DocDate), posting_date_utc: toUtc(r.PostingDate),
    confirmed_at_utc: toUtc(r.ConfirmDate), commission_date_utc: toUtc(r.CommissionDate),
    legacy_creation_time_utc: toUtc(r.CreationTime), legacy_last_modified_at_utc: toUtc(r.LastModificationTime)
  }));
  await target.upsert('referral_transactions', transactionRows, 'id');

  await target.upsert('merchant_update_requests', updateRequests.map((r) => ({
    id: lower(r.Id), legacy_request_id: lower(r.Id), legacy_tenant_id: lower(r.TenantId),
    merchant_id: merchantId.get(lower(r.MerchantId)) || null,
    legacy_merchant_id: r.MerchantId ? lower(r.MerchantId) : null,
    legacy_status: r.Status, requested_at: r.CreationTime, payload: r
  })), 'id');

  const roleById = new Map(roles.map((r) => [lower(r.Id), norm(r.Name)]));
  const rolesByUser = new Map();
  for (const link of userRoles) rolesByUser.set(lower(link.UserId), [...(rolesByUser.get(lower(link.UserId)) || []), roleById.get(lower(link.RoleId))]);
  const merchantByUser = new Map(restaurantUsers.map((r) => [lower(r.UserId), merchantId.get(lower(r.ResId))]));
  const roleMap = (names = []) => names.includes('admin') ? 'admin' : names.includes('bus') ? 'merchant' : names.includes('ctv') ? 'collaborator' : null;

  if (INCLUDE_AUTH) {
    const [existing, existingProfiles] = await Promise.all([
      target.request('/auth/v1/admin/users?page=1&per_page=1000'),
      target.select('user_profiles',
        'select=id,user_id,email,role,merchant_id,collaborator_id'),
    ]);
    const byEmail = new Map((existing.users || []).map((u) => [norm(u.email), u]));
    const byId = new Map((existing.users || []).map((u) => [lower(u.id), u]));
    const profilesById = new Map(existingProfiles.map((profile) => [lower(profile.id), profile]));
    const profilesByEmail = new Map(existingProfiles.map((profile) => [norm(profile.email), profile]));
    for (const user of users.filter((u) => !u.IsDeleted && u.IsActive !== false)) {
      const role = roleMap(rolesByUser.get(lower(user.Id)));
      if (!role || !user.Email) continue;
      const emailMatch = byEmail.get(norm(user.Email));
      const idMatch = byId.get(lower(user.Id));
      if (emailMatch && idMatch && emailMatch.id !== idMatch.id) {
        throw new Error(`conflicting Auth ID/email match for legacy user ${user.Id}`);
      }
      let auth = emailMatch || idMatch;
      if (auth) {
        const migrationOwned = lower(auth.app_metadata?.legacy_user_id) === lower(user.Id) &&
          auth.app_metadata?.role === role;
        if (!migrationOwned) {
          throw new Error(`unreviewed existing Auth match for legacy user ${user.Id}`);
        }
      }
      if (!auth) {
        auth = await target.createAuthUser({ id: lower(user.Id), email: user.Email,
          password: randomBytes(24).toString('base64url') + 'Aa1!', email_confirm: Boolean(user.EmailConfirmed),
          app_metadata: { role, legacy_user_id: lower(user.Id), password_reset_required: true },
          user_metadata: { full_name: [user.Name, user.Surname].filter(Boolean).join(' ') || null } });
      }
      const entity = role === 'merchant' ? merchantByUser.get(lower(user.Id)) :
        role === 'collaborator' ? collaboratorId.get(lower(user.Id)) : null;
      const profileById = profilesById.get(lower(user.Id));
      const profileByEmail = profilesByEmail.get(norm(user.Email));
      if (profileById && profileByEmail && profileById.id !== profileByEmail.id) {
        throw new Error(`conflicting profile ID/email match for legacy user ${user.Id}`);
      }
      const existingProfile = profileById || profileByEmail;
      if (existingProfile &&
          (lower(existingProfile.user_id) !== lower(auth.id) || existingProfile.role !== role)) {
        throw new Error(`unreviewed existing profile match for legacy user ${user.Id}`);
      }
      await target.upsert('user_profiles', [{ id: lower(user.Id), user_id: auth.id,
        email: user.Email, role, full_name: [user.Name, user.Surname].filter(Boolean).join(' ') || null,
        merchant_id: role === 'merchant' ? entity : null,
        collaborator_id: role === 'collaborator' ? entity : null,
        user_profiles_status: user.IsActive ? 'active' : 'inactive' }], 'id');
      await target.upsert('legacy_identity_map', [{ legacy_user_id: lower(user.Id),
        legacy_tenant_id: lower(user.TenantId), auth_user_id: auth.id, migration_status: 'rehearsed',
        source_email_sha256: sha256(norm(user.Email)), auth_strategy: 'password_reset',
        password_reset_required: true, migrated_at: new Date().toISOString() }], 'legacy_user_id');
      byEmail.set(norm(user.Email), auth);
      byId.set(lower(auth.id), auth);
    }
  }

  // Archive all tenant-scoped rows, but never copy reusable credential material.
  for (const table of seal.manifest.tables) {
    const entries = await jsonl(table.file);
    const archive = entries.map(({ row, line }) => {
      const { payload, redacted } = redact(table.database, table.table, row);
      const pk = (table.primary_key_columns || []).map((column) => row[column]).filter((v) => v != null).join('|') || sha256(line);
      return { source_database: table.database, source_schema: table.schema,
        source_table: table.table, source_primary_key: pk, legacy_tenant_id: lower(row.TenantId) || null,
        source_payload: payload, source_payload_sha256: sha256(line), import_batch_id: batchId,
        source_payload_redacted: redacted.length > 0, redacted_fields: redacted };
    });
    if (archive.length) await target.upsert('legacy_source_records', archive,
      'source_database,source_schema,source_table,source_primary_key');
    await target.upsert('legacy_migration_runs', [{ id: uuidFrom(`${batchId}:${table.database}:${table.schema}:${table.table}`), import_batch_id: batchId,
      source_snapshot_at: seal.manifest.created_at_utc, source_database: table.database,
      source_schema: table.schema, source_table: table.table, expected_rows: table.rows,
      imported_rows: archive.length, rejected_rows: 0, source_checksum: table.file_sha256,
      notes: 'sealed snapshot-3; credentials redacted where applicable' }], 'id');
  }

  let mediaImported = 0;
  if (INCLUDE_MEDIA) {
    const csv = (await readFile(path.join(SNAPSHOT, 'media-checksums.csv'), 'utf8')).split('\n').filter(Boolean);
    const headers = csv.shift().split(',').map((value) => value.trim());
    const parseCsv = (line) => {
      const values = line.split(',').map((value) => value.trim());
      return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    };
    const imageByName = new Map(merchantImages.map((r) => [lower(r.ImageId), r]));
    const partnerByImage = new Map(collaborators.filter((r) => r.Image).map((r) => [lower(r.Image), r]));
    for (const line of csv) {
      const media = parseCsv(line);
      const bytes = await readFile(path.join(SNAPSHOT, media.relative_file));
      if (bytes.length !== Number(media.bytes) || sha256(bytes) !== media.sha256) throw new Error(`media hash mismatch: ${media.source_id}`);
      const merchantImage = imageByName.get(lower(media.source_name));
      const partner = partnerByImage.get(lower(media.source_name));
      const bucket = partner ? 'partner-media' : 'merchant-media';
      const extension = media.detected_mime === 'image/png' ? 'png' : media.detected_mime === 'image/webp' ? 'webp' : 'jpg';
      const kind = media.provenance === 'cms' ? 'legacy-cms' : media.provenance === 'unreferenced' ? 'legacy-unreferenced' : `legacy-${media.provenance}`;
      const objectPath = `${kind}/${media.database}/${lower(media.source_id)}.${extension}`;
      await target.upload(bucket, objectPath, bytes, media.detected_mime);
      await target.upsert('media_assets', [{ id: lower(media.source_id),
        legacy_image_id: isUuid(media.source_name) ? lower(media.source_name) : null,
        legacy_blob_id: lower(media.source_id), legacy_tenant_id: TENANT,
        merchant_id: merchantImage ? merchantId.get(lower(merchantImage.ResId)) : null,
        collaborator_id: partner ? collaboratorId.get(lower(partner.Id)) : null,
        bucket_id: bucket, object_path: objectPath, original_filename: media.source_name,
        mime_type: media.detected_mime, sha256_hex: media.sha256, size_bytes: Number(media.bytes),
        is_hero: merchantImage?.IsHero || false, display_order: merchantImage?.Order || 0,
        transfer_status: 'verified', legacy_merchant_image_id: merchantImage ? lower(merchantImage.Id) : null,
        legacy_blob_database: media.database, legacy_blob_name: media.source_name }], 'id');
      mediaImported += 1;
    }
  }

  await target.upsert('legacy_migration_batches', [{ id: batchId, legacy_tenant_id: TENANT,
    source_snapshot_at: seal.manifest.created_at_utc, source_inventory_sha256: seal.manifest_sha256,
    status: 'validating', started_at: new Date().toISOString(), notes: 'Phase D2 isolated rehearsal' }], 'id');

  const summary = { batch_id: batchId, manifest_sha256: seal.manifest_sha256,
    rows: { merchants: merchantRows.length, collaborators: collaboratorRows.length,
      categories: categoryRows.length, merchant_category_links: categoryLinks.length,
      transactions: transactionRows.length, merchant_update_requests: updateRequests.length },
    transaction_totals: Object.fromEntries(Object.entries(transactions.reduce((a, r) => ({
      document_total: a.document_total + decimal4(r.DocTotal),
      discount_total: a.discount_total + decimal4(r.DocDiscountAmt),
      commission_total: a.commission_total + decimal4(r.CommissionAmt)
    }), { document_total: 0n, discount_total: 0n, commission_total: 0n })).map(([k, v]) => [k, format4(v)])),
    missing_restaurant_relationships: transactionRows.filter((r) => r.legacy_restaurant_id && !r.merchant_id).length,
    auth_included: INCLUDE_AUTH, media_imported: mediaImported };
  const serializable = JSON.parse(JSON.stringify(summary, (_, value) => typeof value === 'bigint' ? value.toString() : value));
  await mkdir(PRIVATE_DIR, { recursive: true, mode: 0o700 });
  await writeFile(path.join(PRIVATE_DIR, 'rehearsal-import-summary.json'), `${JSON.stringify(serializable, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(serializable, null, 2));
}

await main();
