// Contract tests for the anonymous catalog projection (no network, no database).
import assert from 'node:assert/strict';
import { PUBLIC_MERCHANT_COLUMNS, excerpt, iconSlug, plainText, publicOffer, toPublicDetail, toPublicListing } from '../src/modules/public-catalog/public-catalog.projection';

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log(`PASS ${name}`); };

t('allow-list never includes owner identity, commission or legacy fields', () => {
  for (const col of PUBLIC_MERCHANT_COLUMNS) assert.doesNotMatch(col, /^(owner_|merchant_email$|merchant_phone$|merchant_commission|legacy_(?!is_banned$)|owner_tax)/, col);
});
const row = {
  merchant_system_id: '11111111-1111-1111-1111-111111111111', merchant_code: 'M1', merchant_name: 'Phở Tài Lộc',
  merchant_description: '**[Glosbe](https://x.example) ** là <b>thương hiệu</b>\n\n\n\nđẹp', merchant_contact_phone: ' 0900 111 222 ',
  merchant_discount_type: 'percentage', merchant_discount_value: 0.05, new_address_line: '34 Trần Hưng Đạo', new_address_ward: 'Phường A', new_address_city: 'TP.HCM',
  owner_name: 'SECRET', owner_email: 'secret@x.vn', merchant_email: 'secret@x.vn', merchant_phone: '0999', merchant_commission_value: 0.2, legacy_tax_code: 'TAX',
};
t('listing/detail carry no private field even if the row contains them', () => {
  const json = JSON.stringify([toPublicListing(row, [], null), toPublicDetail(row, [], ['a'])]);
  for (const secret of ['SECRET', 'secret@x.vn', '0999', 'TAX', 'commission']) assert.ok(!json.includes(secret), secret);
});
t('contact phone is the business contact only, trimmed', () => assert.equal(toPublicDetail(row, [], []).phone, '0900 111 222'));
t('missing contact phone is null, not the owner phone', () => assert.equal(toPublicDetail({ ...row, merchant_contact_phone: '' }, [], []).phone, null));
t('markdown and html are flattened to plain text', () => { const d = plainText(row.merchant_description); assert.ok(!/[<>*\[\]]/.test(d)); assert.ok(d.includes('Glosbe') && d.includes('thương hiệu')); });
t('excerpt is bounded', () => assert.ok(excerpt('x'.repeat(500)).length <= 140));
t('offers: percentage, rounding, zero and null', () => {
  assert.equal(publicOffer('percentage', 0.05)?.label, 'Giảm 5%');
  assert.equal(publicOffer('percentage', 0.015)?.label, 'Giảm 1,5%');
  assert.equal(publicOffer('percentage', 0), null);
  assert.equal(publicOffer(null, null), null);
  assert.equal(publicOffer('percentage', 1.5), null);
});
t('image urls are stable same-origin API paths, never signed storage URLs', () => {
  assert.equal(toPublicListing(row, [], 'abc').image_url, '/public/media/abc');
  assert.equal(toPublicListing(row, [], null).image_url, null);
});
t('category icon slugs: font-awesome class strings and junk', () => {
  assert.equal(iconSlug('fa-regular fa-shirt'), 'shirt');
  assert.equal(iconSlug('fa-regular fa-map-location-dot'), 'map-location-dot');
  assert.equal(iconSlug('Sing '), null);
  assert.equal(iconSlug(null), null);
});
console.log(`${n} passed`);
