// Run: npx tsx lib/merchant-profile.selftest.ts
import assert from 'node:assert/strict';
import { buildPatch, changedFields, formFieldOf, legacyProblems, pctToFraction, ProfileForm, savedMessage, validateField } from './merchant-profile';

const loaded: ProfileForm = {
  merchant_name: 'Nha Khoa Vinh An', merchant_email: 'nhakhoavinhan.@gmail.com', merchant_phone: '', merchant_contact_phone: '0900000000', merchant_description: 'Mô tả', merchant_description_format: 'plain_text',
  owner_name: 'Chủ', owner_phone: '', owner_tax_code: '', new_address_country: 'VN', new_address_province: '', new_address_district: '', new_address_city: 'Hà Nội', new_address_ward: '', new_address_line: '',
  category_ids: ['a', 'b'], discount_pct: '5', commission_pct: '10',
};
const edit = (patch: Partial<ProfileForm>): ProfileForm => ({ ...loaded, ...patch });

// the reproduced failure: untouched invalid legacy values must not block an unrelated change
let r = buildPatch(loaded, edit({ merchant_name: 'Nha Khoa Vinh An 2' }));
assert.deepEqual(r.changed, ['merchant_name']); assert.deepEqual(r.errors, {}); assert.deepEqual(r.payload, { merchant_name: 'Nha Khoa Vinh An 2' });
// nothing changed -> nothing sent
r = buildPatch(loaded, edit({ merchant_phone: '  ' })); assert.deepEqual(r.changed, []); assert.deepEqual(r.payload, {});
assert.equal(savedMessage([]), 'Không có thay đổi nào để lưu.');
// a changed field is validated, in Vietnamese, per field
r = buildPatch(loaded, edit({ merchant_email: 'abc@', merchant_phone: '123', merchant_name: '  ' }));
assert.match(r.errors.merchant_email!, /Email không hợp lệ/); assert.match(r.errors.merchant_phone!, /từ 7 đến 20 ký tự/); assert.match(r.errors.merchant_name!, /không được để trống/); assert.deepEqual(r.payload, {});
// clearing sends null (not a validation error), a valid change is trimmed
r = buildPatch(loaded, edit({ merchant_contact_phone: '', merchant_email: ' ten@congty.vn ', owner_name: ' Chủ mới ' }));
assert.deepEqual(r.payload, { merchant_contact_phone: null, merchant_email: 'ten@congty.vn', owner_name: 'Chủ mới' });
// rates: percentage points typed, fractions sent; blank = leave as it is; out of range refused
assert.equal(pctToFraction('5'), '0.0500'); assert.equal(pctToFraction('7,5'), '0.0750'); assert.equal(pctToFraction('100'), '1.0000'); assert.equal(pctToFraction('0.25'), '0.0025');
r = buildPatch(loaded, edit({ discount_pct: '7,5', commission_pct: '' })); assert.deepEqual(r.payload, { merchant_discount_type: 'percentage', merchant_discount_value: '0.0750' }); assert.deepEqual(r.changed, ['discount_pct']);
for (const bad of ['101', '5.555', 'abc', '-1', '1e2']) assert.match(buildPatch(loaded, edit({ discount_pct: bad })).errors.discount_pct ?? '', /từ 0 đến 100/, bad);
// categories
assert.deepEqual(changedFields(loaded, edit({ category_ids: ['b', 'a'] })), []); assert.match(buildPatch(loaded, edit({ category_ids: ['a', 'b', 'c', 'd'] })).errors.category_ids!, /tối đa 3/);
assert.deepEqual(buildPatch(loaded, edit({ category_ids: ['a', 'c'] })).payload, { category_ids: ['a', 'c'] });
// e-mail rule equals the server's: these are valid / invalid
for (const good of ['a@b.vn', 'ten.ho@congty.com.vn', "o'neil+tag@x.org"]) assert.equal(validateField('merchant_email', good), null, good);
for (const bad of ['nhakhoavinhan.@gmail.com', '.a@b.vn', 'a..b@c.vn', 'a b@c.vn', 'a@b', 'a@', '@b.vn']) assert.ok(validateField('merchant_email', bad), bad);
// legacy problems are surfaced as warnings (never as blockers)
const legacy = legacyProblems(loaded); assert.match(legacy.merchant_email!, /dữ liệu cũ/); assert.match(legacy.merchant_phone!, /chưa có số điện thoại/);
assert.equal(legacyProblems(edit({ merchant_email: 'ok@x.vn', merchant_phone: '0912345678' })).merchant_email, undefined);
// API field names map back to the form
assert.equal(formFieldOf('merchant_discount_value'), 'discount_pct'); assert.equal(formFieldOf('merchant_email'), 'merchant_email'); assert.equal(formFieldOf('_'), null);
console.log('merchant-profile selftest: all assertions passed');
