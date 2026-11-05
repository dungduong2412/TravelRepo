#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PARTNER_CODE_REMAP, derivePartnerCodeDuplicates, pinnedPartnerRemap, replacementCode } from './partner-code-remap.mjs';
const snap = process.argv[2];
const real = snap ? readFileSync(`${snap}/tables/Emos_MdmService/dbo.RestaurantMiddleman.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : null;
let n = 0; const t = (name, fn) => { try { fn(); n++; console.log(`PASS ${name}`); } catch (e) { console.error(`FAIL ${name}\n`, e); process.exitCode = 1; } };
const P = (Id, Code) => ({ Id: Id.toUpperCase(), Code });
const base = () => [...Object.entries(PARTNER_CODE_REMAP).flatMap(([c, ids]) => ids.map((i) => P(i, c))), P('aaaaaaaa-0000-0000-0000-000000000001', 'C1'), P('aaaaaaaa-0000-0000-0000-000000000002', 'C2')];
t('pinned set is accepted and yields 4 unique replacement codes', () => {
  const r = pinnedPartnerRemap(base()); assert.equal(r.length, 4);
  assert.deepEqual(r.map((x) => x.replacement_code).sort(), ['C2500228-DUP-2c495a87', 'C2500228-DUP-77f4a15e', 'C2500240-DUP-2852d043', 'C2500240-DUP-55cb956a']);
  assert.ok(r.every((x) => x.sibling_legacy_ids.length === 1));
});
t('case/space variants of a code count as duplicates', () => assert.equal(derivePartnerCodeDuplicates([P('a', 'X1'), P('b', ' x1 ')]).length, 1));
t('a third duplicate code outside the pinned set aborts', () => assert.throws(() => pinnedPartnerRemap([...base(), P('bbbbbbbb-0000-0000-0000-000000000001', 'C9'), P('bbbbbbbb-0000-0000-0000-000000000002', 'C9')]), /not exactly the pinned E1 set/));
t('a third holder of a pinned code aborts', () => assert.throws(() => pinnedPartnerRemap([...base(), P('cccccccc-0000-0000-0000-000000000001', 'C2500228')]), /not exactly the pinned E1 set/));
t('a missing holder (duplicate resolved upstream) aborts instead of silently passing', () => assert.throws(() => pinnedPartnerRemap(base().slice(1)), /not exactly the pinned E1 set/));
t('a replacement code that collides with an existing code aborts', () => assert.throws(() => pinnedPartnerRemap([...base(), P('dddddddd-0000-0000-0000-000000000001', 'C2500228-DUP-2c495a87')]), /not unique/));
t('replacement is deterministic and independent of row order', () => assert.deepEqual(pinnedPartnerRemap(base()), pinnedPartnerRemap(base().reverse())));
t('replacementCode lower-cases the id prefix', () => assert.equal(replacementCode('C1', 'ABCDEF12-0000'), 'C1-DUP-abcdef12'));
if (real) t('the sealed Snapshot-5 Partners contain exactly the pinned duplicates', () => { assert.equal(real.length, 312); assert.equal(pinnedPartnerRemap(real).length, 4); });
console.log(`${n} passed`);
