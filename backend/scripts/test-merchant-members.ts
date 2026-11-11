// Unit tests (no database) for the Members hardening: input normalisation + field-level validation, duplicate comparison, privacy projections,
// limits parsing, and the shape of the retired Partner route. The behaviour against a real database and over HTTP is in
// scripts/integration-merchant-members.ts (rehearsal database).
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';
import { describeZodError } from '../src/common/validation/field-errors';
import { JwtGuard } from '../src/common/auth/jwt.guard';
import {
  CreateMerchantMemberSchema, escapeLike, maskEmail, maskPhone, memberLimits, normalizeEmail, normalizePhone, parseCreateMemberRpc, hasMatchingCreationAudit, MEMBER_CREATED_ACTION, sameMemberData, toCreatedMemberView, toMemberListItem,
} from '../src/modules/merchants/merchant-members';
import { CollaboratorsController } from '../src/modules/collaborators/collaborators.controller';
import { MerchantsController } from '../src/modules/merchants/merchants.controller';

let controls = 0;
const ok = (label: string, fn: () => void) => { try { fn(); controls += 1; } catch (e) { console.error(`FAIL: ${label}`); throw e; } };
const good = { collaborators_name: 'Nguyễn Văn A', collaborators_phone: '0912345678', collaborators_email: 'a@x.vn' };
const parse = (o: unknown) => CreateMerchantMemberSchema.safeParse(o);
const errorsOf = (o: unknown) => { const r = parse(o); assert.equal(r.success, false, `expected a validation failure for ${JSON.stringify(o)}`); return describeZodError((r as any).error); };
const VIETNAMESE = /[À-ỹ]/;

// ---- normalisation -----------------------------------------------------------------------------------------------------------------------------------
ok('input is trimmed and normalised (name spaces, lower-case e-mail, phone/account without separators)', () => {
  const r = parse({ collaborators_name: '  Nguyễn   Văn  A ', collaborators_phone: ' +84 (912) 345-678 ', collaborators_email: '  A.B_C@Example.COM ', collaborators_bank_name: ' Vietcombank  ', collaborators_bank_acc_number: '0123 4567-89' });
  assert.equal(r.success, true); if (!r.success) return;
  assert.deepEqual(r.data, { collaborators_name: 'Nguyễn Văn A', collaborators_phone: '+84912345678', collaborators_email: 'a.b_c@example.com', collaborators_bank_name: 'Vietcombank', collaborators_bank_acc_number: '0123456789' });
});
ok('optional bank fields: blank / whitespace / missing all mean "not provided" (the page sends empty strings)', () => {
  for (const blank of ['', '   ', undefined]) {
    const r = parse({ ...good, collaborators_bank_name: blank, collaborators_bank_acc_number: blank }); assert.equal(r.success, true);
    if (r.success) { assert.equal(r.data.collaborators_bank_name, undefined); assert.equal(r.data.collaborators_bank_acc_number, undefined); }
  }
  assert.equal(parse(good).success, true);
});
ok('helpers: normalizeEmail / normalizePhone', () => {
  assert.equal(normalizeEmail('  X@Y.Vn '), 'x@y.vn'); assert.equal(normalizePhone('09 12.34-56 78'), '0912345678'); assert.equal(normalizePhone('+84 912 345 678'), '+84912345678');
});

// ---- rejections: every failure names its field with a Vietnamese sentence ---------------------------------------------------------------------------
const bad: Array<[string, Record<string, unknown>, string]> = [
  ['empty name', { ...good, collaborators_name: '' }, 'collaborators_name'],
  ['one-character name', { ...good, collaborators_name: 'A' }, 'collaborators_name'],
  ['name with markup', { ...good, collaborators_name: '<script>alert(1)</script>' }, 'collaborators_name'],
  ['name with a control character', { ...good, collaborators_name: 'Ng\u0000uyen' }, 'collaborators_name'],
  ['name over 120 characters', { ...good, collaborators_name: 'a'.repeat(121) }, 'collaborators_name'],
  ['phone with letters', { ...good, collaborators_phone: '09abc45678' }, 'collaborators_phone'],
  ['phone too short', { ...good, collaborators_phone: '12345' }, 'collaborators_phone'],
  ['phone too long', { ...good, collaborators_phone: '1'.repeat(16) }, 'collaborators_phone'],
  ['phone that is only a plus', { ...good, collaborators_phone: '+' }, 'collaborators_phone'],
  ['e-mail without a domain', { ...good, collaborators_email: 'abc@' }, 'collaborators_email'],
  ['e-mail with a dot before @', { ...good, collaborators_email: 'abc.@x.vn' }, 'collaborators_email'],
  ['e-mail with consecutive dots', { ...good, collaborators_email: 'a..b@x.vn' }, 'collaborators_email'],
  ['e-mail over 254 characters', { ...good, collaborators_email: `${'a'.repeat(250)}@x.vn` }, 'collaborators_email'],
  ['bank name with markup', { ...good, collaborators_bank_name: '<b>Bank</b>' }, 'collaborators_bank_name'],
  ['one-character bank name', { ...good, collaborators_bank_name: 'B' }, 'collaborators_bank_name'],
  ['account number with letters', { ...good, collaborators_bank_acc_number: '12345abc' }, 'collaborators_bank_acc_number'],
  ['account number too short', { ...good, collaborators_bank_acc_number: '12345' }, 'collaborators_bank_acc_number'],
  ['account number too long', { ...good, collaborators_bank_acc_number: '1'.repeat(21) }, 'collaborators_bank_acc_number'],
];
for (const [label, body, field] of bad) {
  ok(`rejected with a field-level Vietnamese message: ${label}`, () => {
    const errs = errorsOf(body); const e = errs.find((x) => x.field === field);
    assert.ok(e, `expected an error on ${field}, got ${JSON.stringify(errs)}`); assert.match(e!.message, VIETNAMESE); assert.doesNotMatch(e!.message, /Validation failed/);
  });
}
ok('unknown / privileged keys are refused (no way to set status, merchant, code, verified ...)', () => {
  for (const key of ['merchant_system_id', 'collaborators_status', 'collaborators_verified', 'collaborators_code', 'collaborators_bank_acc_name', 'collaborators_rating', 'id', 'idempotency_key']) {
    assert.equal(parse({ ...good, [key]: 'x' }).success, false, key);
  }
});
ok('the Zod pipe turns a failure into 400 VALIDATION_FAILED with errors[] (existing contract)', () => {
  try { new ZodValidationPipe(CreateMerchantMemberSchema).transform({ ...good, collaborators_email: 'abc@' }); assert.fail('should throw'); }
  catch (e: any) { assert.equal(e.getStatus(), 400); const b = e.getResponse(); assert.equal(b.code, 'VALIDATION_FAILED'); assert.equal(b.errors[0].field, 'collaborators_email'); assert.match(b.errors[0].message, VIETNAMESE); }
});

// ---- duplicates --------------------------------------------------------------------------------------------------------------------------------------
const dto = (over: Record<string, unknown> = {}) => { const r = parse({ ...good, collaborators_bank_name: 'Vietcombank', collaborators_bank_acc_number: '0123456789', ...over }); assert.equal(r.success, true); return (r as any).data; };
const row = (over: Record<string, unknown> = {}) => ({ id: 'r1', merchant_system_id: 'm1', collaborators_name: 'Nguyễn Văn A', collaborators_phone: '0912345678', collaborators_email: 'a@x.vn', collaborators_bank_name: 'Vietcombank', collaborators_bank_acc_number: '0123456789', collaborators_status: 'pending', collaborators_verified: false, collaborators_registered_date: '2026-11-10T01:00:00.000Z', ...over });
ok('sameMemberData: identical normalised details are the same submission (case, spacing, separators ignored)', () => {
  assert.equal(sameMemberData(row(), dto()), true);
  assert.equal(sameMemberData(row({ collaborators_name: 'nguyễn  văn a', collaborators_phone: '09 1234 5678', collaborators_email: 'A@X.VN', collaborators_bank_acc_number: '0123 456 789' }), dto()), true);
  assert.equal(sameMemberData(row({ collaborators_bank_name: null, collaborators_bank_acc_number: null }), dto({ collaborators_bank_name: '', collaborators_bank_acc_number: '' })), true);
});
ok('sameMemberData: any difference is a different submission', () => {
  for (const over of [{ collaborators_name: 'Khác' }, { collaborators_phone: '0987654321' }, { collaborators_email: 'b@x.vn' }, { collaborators_bank_name: 'ACB' }, { collaborators_bank_acc_number: '999999999' }, { collaborators_bank_name: null }]) {
    assert.equal(sameMemberData(row(over), dto()), false, JSON.stringify(over));
  }
});
ok('parseCreateMemberRpc: CREATED needs a member with an id; EMAIL_HELD / NOT_ALLOWED are recognised; anything else fails closed (INVALID)', () => {
  const member = { id: '11111111-1111-1111-1111-111111111111', collaborators_code: 'COLABC1234', collaborators_status: 'pending', collaborators_verified: false };
  assert.deepEqual(parseCreateMemberRpc({ outcome: 'CREATED', member }), { kind: 'CREATED', row: member });
  assert.deepEqual(parseCreateMemberRpc([{ outcome: 'CREATED', member }]), { kind: 'CREATED', row: member }, 'an array-wrapped answer is accepted');
  assert.deepEqual(parseCreateMemberRpc({ outcome: 'EMAIL_HELD' }), { kind: 'EMAIL_HELD' });
  assert.deepEqual(parseCreateMemberRpc({ outcome: 'NOT_ALLOWED' }), { kind: 'NOT_ALLOWED' });
  for (const bad of [null, undefined, 'CREATED', 42, [], {}, { outcome: 'CREATED' }, { outcome: 'CREATED', member: {} }, { outcome: 'CREATED', member: { id: '' } }, { outcome: 'CREATED', member: { id: 7 } }, { outcome: 'created', member }, { outcome: 'EMAIL_HELD_', member }, { member }]) {
    assert.deepEqual(parseCreateMemberRpc(bad), { kind: 'INVALID' }, JSON.stringify(bad));
  }
});
ok('hasMatchingCreationAudit: only a creation event for THIS application, by a merchant actor, naming THIS Merchant, counts; nothing else (action, entity, id, role, Merchant, malformed rows) does', () => {
  const M = '11111111-1111-4111-8111-111111111111'; const X = 'abcdefab-cdef-4bcd-8cde-abcdefabcdef'; const OTHER = '33333333-3333-4333-8333-333333333333';
  const good = { action: MEMBER_CREATED_ACTION, entity_type: 'collaborator', entity_id: M, actor_role: 'merchant', details: { merchant_id: X, auth_invitation_required: true } };
  assert.equal(MEMBER_CREATED_ACTION, 'collaborator.member_application_created');
  assert.equal(hasMatchingCreationAudit([good], M, X), true);
  assert.equal(hasMatchingCreationAudit([{ ...good, entity_id: OTHER }, good], M, X), true, 'one matching event among others is enough');
  const rejected: Array<[string, any]> = [          // [label, the event list handed to the check]
    ['no events', []], ['null list', null], ['undefined list', undefined],
    ['another application', [{ ...good, entity_id: OTHER }]], ['another Merchant', [{ ...good, details: { merchant_id: OTHER } }]], ['no details', [{ ...good, details: null }]], ['details not an object', [{ ...good, details: 'x' }]],
    ['a different action (e.g. an Admin creation)', [{ ...good, action: 'collaborator.created' }]], ['the removed reconciliation action', [{ ...good, action: 'collaborator.member_application_audit_reconciled' }]],
    ['a different entity type', [{ ...good, entity_type: 'merchant' }]], ['an admin actor', [{ ...good, actor_role: 'admin' }]], ['an unknown actor', [{ ...good, actor_role: 'unknown' }]],
    ['a string instead of an event', ['collaborator.member_application_created']], ['a null event', [null]],
  ];
  for (const [label, events] of rejected) assert.equal(hasMatchingCreationAudit(events, M, X), false, label);
  assert.equal(hasMatchingCreationAudit([{ ...good, details: { merchant_id: X.toUpperCase() } }], M, X), false, 'ids are compared exactly, not case-folded');
});
ok('escapeLike: LIKE wildcards in an e-mail are matched literally', () => { assert.equal(escapeLike('a_b%c\\d@x.vn'), 'a\\_b\\%c\\\\d@x.vn'); });

// ---- privacy projections -----------------------------------------------------------------------------------------------------------------------------
ok('masks', () => {
  assert.equal(maskEmail('nguyen.van@gmail.com'), 'n***@gmail.com'); assert.equal(maskEmail('a@x.vn'), 'a***@x.vn'); assert.equal(maskEmail(''), null); assert.equal(maskEmail(null), null); assert.equal(maskEmail('no-at-sign'), '***');
  assert.equal(maskPhone('0912345678'), '*******678'); assert.equal(maskPhone('+84 912 345 678'), '********678'); assert.equal(maskPhone('12'), '***'); assert.equal(maskPhone(null), null);
});
ok('list projection: contact masked, no bank / code / internal columns, even when the row carries them', () => {
  const item = toMemberListItem({ ...row(), collaborators_code: 'COL1', collaborators_avatar_url: 'u', extra_internal: 'secret' } as any);
  assert.deepEqual(Object.keys(item).sort(), ['collaborators_avatar_url', 'collaborators_email', 'collaborators_name', 'collaborators_phone', 'collaborators_registered_date', 'collaborators_status', 'collaborators_verified', 'id']);
  assert.equal(item.collaborators_email, 'a***@x.vn'); assert.equal(item.collaborators_phone, '*******678');
  const text = JSON.stringify(item); assert.doesNotMatch(text, /0123456789|Vietcombank|0912345678|a@x\.vn|secret|COL1/);
});
ok('create answer: identification and state only (no phone, e-mail, bank data)', () => {
  const view = toCreatedMemberView({ ...row(), collaborators_code: 'COL9' } as any, false);
  assert.deepEqual(Object.keys(view).sort(), ['collaborators_code', 'collaborators_name', 'collaborators_registered_date', 'collaborators_status', 'collaborators_verified', 'id', 'idempotent_replay']);
  assert.equal(view.idempotent_replay, false); assert.equal(toCreatedMemberView(row() as any, true).idempotent_replay, true);
  assert.doesNotMatch(JSON.stringify(view), /0123456789|Vietcombank|0912345678|a@x\.vn/);
});

// ---- limits ------------------------------------------------------------------------------------------------------------------------------------------
ok('limits: documented defaults, environment override, invalid values fall back', () => {
  assert.deepEqual(memberLimits({}), { perHour: 10, perDay: 40, pendingCap: 50 });
  assert.deepEqual(memberLimits({ MERCHANT_MEMBER_CREATES_PER_HOUR: '3', MERCHANT_MEMBER_CREATES_PER_DAY: '7', MERCHANT_MEMBER_PENDING_CAP: '9' }), { perHour: 3, perDay: 7, pendingCap: 9 });
  assert.deepEqual(memberLimits({ MERCHANT_MEMBER_CREATES_PER_HOUR: '0', MERCHANT_MEMBER_CREATES_PER_DAY: 'abc', MERCHANT_MEMBER_PENDING_CAP: '-5' }), { perHour: 10, perDay: 40, pendingCap: 50 });
  assert.deepEqual(memberLimits({ MERCHANT_MEMBER_CREATES_PER_HOUR: '1000000' }), { perHour: 10, perDay: 40, pendingCap: 50 });
});

// ---- routes ------------------------------------------------------------------------------------------------------------------------------------------
ok('Partner POST /collaborators/members is retired: 410 FEATURE_RETIRED, no body parameter, controller still behind JwtGuard', () => {
  const ctl = new (CollaboratorsController as any)({} as any);
  assert.throws(() => ctl.createMemberRetired(), (e: any) => e instanceof HttpException && e.getStatus() === 410 && e.getResponse().code === 'FEATURE_RETIRED' && /Đối tác/.test(e.getResponse().message));
  assert.equal(Reflect.getMetadata('__routeArguments__', CollaboratorsController, 'createMemberRetired'), undefined, 'the retired route must not read or validate a body');
  assert.ok((Reflect.getMetadata('__guards__', CollaboratorsController) || []).includes(JwtGuard), 'anonymous callers are refused by the guard before the handler');
  assert.equal(Reflect.getMetadata('path', CollaboratorsController.prototype.createMemberRetired), 'members'); assert.equal(Reflect.getMetadata('method', CollaboratorsController.prototype.createMemberRetired), 1 /* POST */);
});
ok('Merchant POST /merchants/members and both GET list routes are still routed and guarded', () => {
  assert.equal(Reflect.getMetadata('path', MerchantsController.prototype.createMember), 'members'); assert.equal(Reflect.getMetadata('method', MerchantsController.prototype.createMember), 1);
  assert.equal(Reflect.getMetadata('path', MerchantsController.prototype.listMembers), 'members'); assert.equal(Reflect.getMetadata('method', MerchantsController.prototype.listMembers), 0);
  assert.equal(Reflect.getMetadata('path', CollaboratorsController.prototype.listMembers), 'members'); assert.equal(Reflect.getMetadata('method', CollaboratorsController.prototype.listMembers), 0);
  assert.ok((Reflect.getMetadata('__guards__', MerchantsController) || []).includes(JwtGuard));
});

console.log(`merchant-members unit tests: ${controls} controls PASS`);
