// Merchant profile save, field-level validation and Partner-Merchant assignment audit, against an in-memory Supabase fake.
// The scenarios are the ones reproduced on hosted UAT: a V1 e-mail with a typo and a record with no phone made an UNCHANGED profile unsaveable ("Validation failed", no field named).
import assert from 'node:assert/strict';
import { MerchantsService } from '../src/modules/merchants/merchants.service';
import { CollaboratorsService } from '../src/modules/collaborators/collaborators.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MerchantSelfUpdateEnvelopeSchema } from '../src/modules/merchants/merchants.dto';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';
import { describeZodError } from '../src/common/validation/field-errors';
import { z } from 'zod';

type Row = Record<string, any>;
class Fake {
  tables: Record<string, Row[]> = { user_profiles: [], merchant_details: [], merchant_category_links: [], audit_events: [], collaborators: [] };
  writes: Array<{ table: string; patch: Row }> = []; rpcs: Array<{ name: string; args: any }> = [];
  from(table: string) {
    const db = this; const filters: Array<(r: Row) => boolean> = []; let mode: 'select' | 'update' | 'insert' = 'select'; let patch: Row = {};
    const rows = () => (db.tables[table] || []).filter((r) => filters.every((f) => f(r)));
    const q: any = {
      select: () => q, eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      update: (p: Row) => { mode = 'update'; patch = p; return q; },
      insert: (row: Row) => { mode = 'insert'; (db.tables[table] ||= []).push({ id: `${table}-${db.tables[table].length + 1}`, ...row }); db.writes.push({ table, patch: row }); return q; },
      single: async () => { if (mode === 'update') { const r = rows(); r.forEach((x) => Object.assign(x, patch)); db.writes.push({ table, patch }); return { data: r[0] ?? null, error: r[0] ? null : { message: 'none' } }; } return { data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'none' } }; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: mode === 'insert' ? null : rows(), error: null }).then(res, rej),
    };
    return q;
  }
  async rpc(name: string, args: any) { this.rpcs.push({ name, args }); if (name === 'set_merchant_categories') { this.tables.merchant_category_links = (args.p_category_ids as string[]).map((c) => ({ merchant_id: args.p_merchant_id, category_id: c })); } return { error: null }; }
}

const ME = 'user-m1'; const MID = 'm-1'; const OTHER = 'user-m2';
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function world(merchant: Row = {}) {
  const db = new Fake();
  db.tables.user_profiles = [
    { user_id: ME, role: 'merchant', user_profiles_status: 'active', merchant_id: MID }, { user_id: OTHER, role: 'merchant', user_profiles_status: 'active', merchant_id: 'm-2' },
    { user_id: 'user-p', role: 'collaborator', user_profiles_status: 'active', collaborator_id: 'c-1' }, { user_id: 'user-admin', role: 'admin', user_profiles_status: 'active' },
  ];
  db.tables.merchant_details = [{ merchant_system_id: MID, merchant_name: 'Nha Khoa Vinh An', merchant_email: 'nhakhoavinhan.@gmail.com', merchant_phone: null, merchant_contact_phone: '0900000000', merchant_description: 'Mô tả', merchant_description_format: 'plain_text',
    owner_name: 'Chủ', owner_phone: null, owner_tax_code: null, new_address_country: 'VN', new_address_province: null, new_address_district: null, new_address_city: 'Hà Nội', new_address_ward: null, new_address_line: null,
    merchant_discount_type: 'percentage', merchant_discount_value: 0.05, merchant_commission_type: 'percentage', merchant_commission_value: 0.1, owner_password: 'x', ...merchant }];
  db.tables.merchant_category_links = [{ merchant_id: MID, category_id: UUID(1) }, { merchant_id: MID, category_id: UUID(2) }];
  const supabase: any = { getClient: () => db };
  const audit = new AuditService(supabase);
  const merchants = new MerchantsService(supabase, {} as any, audit, {} as any);
  const collabs = new CollaboratorsService(supabase, {} as any, audit, {} as any, {} as any);
  return { db, merchants, collabs };
}
const codeOf = (e: any) => e?.getResponse?.().code; const statusOf = (e: any) => e?.getStatus?.();
const fieldsOf = (e: any): Record<string, string> => Object.fromEntries((e?.getResponse?.().errors || []).map((x: any) => [x.field, x.message]));
const audits = (w: ReturnType<typeof world>, action: string) => w.db.tables.audit_events.filter((e) => e.action === action);
let controls = 0; const ok = (label: string, fn: () => void | Promise<void>) => Promise.resolve(fn()).then(() => { controls += 1; }, (e) => { console.error(`FAIL: ${label}`); throw e; });

(async () => {
  // ---- the reproduced failures ------------------------------------------------------------------------------------------------------------------
  await ok('U1 an invalid LEGACY e-mail (V1 data) and an empty phone no longer block an unrelated change: the page re-sends them unchanged', async () => {
    const w = world();
    const everything = { merchant_name: 'Nha Khoa Vinh An 2', merchant_email: 'nhakhoavinhan.@gmail.com', merchant_phone: '', merchant_contact_phone: '0900000000', owner_phone: '', new_address_city: 'Hà Nội', merchant_description_format: 'plain_text' };
    const r: any = await w.merchants.updateForActor(ME, MID, everything);
    assert.deepEqual(r.changed_fields, ['merchant_name']); assert.equal(w.db.tables.merchant_details[0].merchant_name, 'Nha Khoa Vinh An 2');
    assert.equal(w.db.tables.merchant_details[0].merchant_email, 'nhakhoavinhan.@gmail.com', 'the untouched legacy value is left exactly as it was');
    assert.deepEqual(audits(w, 'merchant.profile_updated').map((e) => e.details.changed_fields), [['merchant_name']], 'the audit row names what really changed');
  });
  await ok('U2 saving an unchanged profile is a no-op: nothing written, nothing audited', async () => {
    const w = world(); const before = JSON.stringify(w.db.tables.merchant_details);
    const r: any = await w.merchants.updateForActor(ME, MID, { merchant_name: 'Nha Khoa Vinh An', merchant_phone: '', merchant_email: 'nhakhoavinhan.@gmail.com' });
    assert.deepEqual(r.changed_fields, []); assert.equal(JSON.stringify(w.db.tables.merchant_details), before); assert.equal(w.db.writes.length, 0); assert.equal(w.db.tables.audit_events.length, 0);
  });

  // ---- real errors name the field, in Vietnamese ------------------------------------------------------------------------------------------------
  await ok('U3 invalid values that the Merchant DID enter are refused with the field and a Vietnamese, actionable message — and nothing is written', async () => {
    const w = world();
    await assert.rejects(w.merchants.updateForActor(ME, MID, { merchant_email: 'abc@', merchant_phone: '123', merchant_name: '   ', owner_tax_code: 'x'.repeat(101), merchant_description: 'y'.repeat(20001) }), (e: any) => {
      const f = fieldsOf(e);
      assert.equal(statusOf(e), 400); assert.equal(codeOf(e), 'VALIDATION_FAILED'); assert.equal(e.getResponse().message, 'Validation failed');
      assert.match(f.merchant_email, /Email không hợp lệ/); assert.match(f.merchant_phone, /từ 7 đến 20 ký tự/); assert.match(f.merchant_name, /không được để trống/); assert.match(f.owner_tax_code, /tối đa 100 ký tự/); assert.match(f.merchant_description, /tối đa 20000/);
      for (const m of Object.values(f)) assert.match(m, /[À-ỹ]/); return true;
    });
    assert.equal(w.db.writes.length, 0); assert.equal(w.db.tables.audit_events.length, 0);
  });
  await ok('U4 clearing an optional field is allowed; a changed valid value is saved', async () => {
    const w = world({ merchant_phone: '0912345678' });
    const r: any = await w.merchants.updateForActor(ME, MID, { merchant_phone: '', merchant_contact_phone: ' 0911 222 333 ', merchant_email: 'ten@congty.vn' });
    assert.deepEqual(r.changed_fields.sort(), ['merchant_contact_phone', 'merchant_email', 'merchant_phone']);
    assert.deepEqual([w.db.tables.merchant_details[0].merchant_phone, w.db.tables.merchant_details[0].merchant_contact_phone, w.db.tables.merchant_details[0].merchant_email], [null, '0911 222 333', 'ten@congty.vn']);
  });
  await ok('U5 commercial rates: validated against the EFFECTIVE type; unchanged rates are not re-validated', async () => {
    const w = world();
    await assert.rejects(w.merchants.updateForActor(ME, MID, { merchant_discount_value: '5' }), (e: any) => /Tỷ lệ giảm giá/.test(fieldsOf(e).merchant_discount_value));   // 5 = 500%: only the stored "percentage" type reveals it
    await assert.rejects(w.merchants.updateForActor(ME, MID, { merchant_commission_type: 'percentage', merchant_commission_value: '1.5' }), (e: any) => /Tỷ lệ hoa hồng/.test(fieldsOf(e).merchant_commission_value));
    const r: any = await w.merchants.updateForActor(ME, MID, { merchant_discount_type: 'percentage', merchant_discount_value: '0.0500', merchant_commission_value: '0.0750' });   // discount unchanged (0.05), commission changed
    assert.deepEqual(r.changed_fields, ['merchant_commission_value']); assert.equal(w.db.tables.merchant_details[0].merchant_commission_value, '0.0750');
  });
  await ok('U6 categories: unchanged selection is not a change; more than 3 / duplicates are refused with a message', async () => {
    const w = world();
    assert.deepEqual(((await w.merchants.updateForActor(ME, MID, { category_ids: [UUID(2), UUID(1)] })) as any).changed_fields, []); assert.equal(w.db.rpcs.length, 0);
    await assert.rejects(w.merchants.updateForActor(ME, MID, { category_ids: [UUID(1), UUID(2), UUID(3), UUID(4)] }), (e: any) => /tối đa 3 danh mục/.test(fieldsOf(e).category_ids));
    await assert.rejects(w.merchants.updateForActor(ME, MID, { category_ids: [UUID(1), UUID(1)] }), (e: any) => /danh mục/.test(fieldsOf(e).category_ids));
    const r: any = await w.merchants.updateForActor(ME, MID, { category_ids: [UUID(1), UUID(3)] }); assert.deepEqual(r.changed_fields, ['category_ids']); assert.equal(w.db.rpcs.length, 1);
  });

  // ---- repeated submission, isolation -----------------------------------------------------------------------------------------------------------
  await ok('U7 a repeated / simultaneous submission produces ONE change and ONE audit row', async () => {
    const w = world(); const payload = { merchant_name: 'Tên mới', new_address_line: '12 Phố Huế' };
    const results: any[] = await Promise.all([1, 2, 3].map(() => w.merchants.updateForActor(ME, MID, payload)));
    assert.equal(results.filter((r) => r.changed_fields.length).length, 1); assert.equal(audits(w, 'merchant.profile_updated').length, 1);
    assert.equal(w.db.writes.filter((x) => x.table === 'merchant_details').length, 1);
  });
  await ok('U8 isolation: another Merchant, a Partner and an Admin cannot use the Merchant self-service save; unknown fields are refused at the door', async () => {
    const w = world();
    for (const user of [OTHER, 'user-p', 'user-admin', 'nobody']) await assert.rejects(w.merchants.updateForActor(user, MID, { merchant_name: 'Hacked' }), (e: any) => statusOf(e) === 403, user);
    assert.equal(w.db.tables.merchant_details[0].merchant_name, 'Nha Khoa Vinh An');
    const pipe = new ZodValidationPipe(MerchantSelfUpdateEnvelopeSchema);
    for (const bad of [{ merchant_verified: true }, { merchants_status: 'active' }, { owner_email: 'x@y.test' }, { merchant_code: 'X' }, { owner_password: 'x' }]) assert.throws(() => pipe.transform(bad), (e: any) => codeOf(e) === 'VALIDATION_FAILED', JSON.stringify(bad));
    assert.doesNotThrow(() => pipe.transform({ merchant_name: 'ok', merchant_phone: '' }));
  });

  // ---- the shared validation contract -----------------------------------------------------------------------------------------------------------
  await ok('V1 every API validation failure keeps "Validation failed" and adds field, code and a Vietnamese message', () => {
    const schema = z.object({ gross_amount: z.string().regex(/^\d+$/), collaborator_code: z.string().min(1), mime_type: z.enum(['image/png']), size_bytes: z.number().max(5 * 1024 * 1024) }).strict();
    const pipe = new ZodValidationPipe(schema);
    try { pipe.transform({ gross_amount: 'abc', collaborator_code: '', mime_type: 'image/gif', size_bytes: 9_999_999, extra: 1 }); assert.fail('must throw'); }
    catch (e: any) {
      const body = e.getResponse(); assert.equal(body.message, 'Validation failed'); assert.equal(body.code, 'VALIDATION_FAILED'); assert.equal(e.getStatus(), 400);
      const byField = Object.fromEntries(body.errors.map((x: any) => [x.field, x.message]));
      assert.match(byField.collaborator_code, /không được để trống/); assert.match(byField.mime_type, /JPEG, PNG hoặc WebP/); assert.match(byField.size_bytes, /5 MB/);
      assert.ok(body.errors.every((x: any) => x.message && x.code && x.field));
    }
    assert.deepEqual(describeZodError(null), []);
  });

  // ---- Partner-Merchant assignment audit --------------------------------------------------------------------------------------------------------
  await ok('A1 Admin assigns / reassigns / unassigns a Partner: each real change is audited with before and after; a no-op is not; an unknown Merchant is refused', async () => {
    const w = world(); w.db.tables.collaborators = [{ id: 'c-1', collaborators_code: 'COL-X', collaborators_status: 'active', merchant_system_id: null }];
    (w.db.tables.merchant_details as Row[]).push({ merchant_system_id: 'm-2', merchant_name: 'Second' });
    const admin = { id: 'user-admin', role: 'admin' };
    await w.collabs.updateByAdmin(admin, 'c-1', { merchant_system_id: MID } as any);
    await w.collabs.updateByAdmin(admin, 'c-1', { merchant_system_id: MID } as any);                      // same value again: nothing to record
    await w.collabs.updateByAdmin(admin, 'c-1', { merchant_system_id: 'm-2' } as any);
    await w.collabs.updateByAdmin(admin, 'c-1', { merchant_system_id: null } as any);
    assert.deepEqual(audits(w, 'collaborator.merchant_association_changed').map((e) => [e.details.change, e.details.previous_merchant_id, e.details.merchant_id]), [['assigned', null, MID], ['reassigned', MID, 'm-2'], ['unassigned', 'm-2', null]]);
    await assert.rejects(w.collabs.updateByAdmin(admin, 'c-1', { merchant_system_id: 'nope' } as any), (e: any) => codeOf(e) === 'MERCHANT_NOT_FOUND' && /nhà cung cấp/.test(fieldsOf(e).merchant_system_id));
    assert.equal(w.db.tables.collaborators[0].merchant_system_id, null);
  });

  console.log(JSON.stringify({ status: 'PASS', controls }));
})().catch((e) => { console.error(e); process.exit(1); });
