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
  CreateMerchantMemberSchema, escapeLike, maskEmail, maskPhone, memberLimits, normalizeEmail, normalizePhone, parseCreateMemberRpc, selectCreationAudit, checkCreationActor, MEMBER_CREATED_ACTION, MEMBER_AUDIT_SOURCE, sameMemberData, toCreatedMemberView, toMemberListItem,
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
// ---- replay verification: stage 1 (the creation audit event) and stage 2 (its actor) -----------------------------------------------------------------
const RM = '11111111-1111-4111-8111-111111111111';          // the application
const RX = 'abcdefab-cdef-4bcd-8cde-abcdefabcdef';          // the requesting Merchant (hex letters: ids are compared exactly, not case-folded)
const ROTHER = '33333333-3333-4333-8333-333333333333';      // another application / Merchant
const RACTOR = 'abcdef01-2345-4678-89ab-cdef01234567';      // the user who created it
const goodEvent = { id: 7, occurred_at: '2026-11-11T10:00:00+00:00', actor_auth_user_id: RACTOR, actor_role: 'merchant', action: MEMBER_CREATED_ACTION, entity_type: 'collaborator', entity_id: RM,
  source: 'v2-admin-api', details: { merchant_id: RX, auth_invitation_required: true } };
const goodProfile = { user_id: RACTOR, role: 'merchant', merchant_id: RX, created_at: '2026-10-01T08:00:00+00:00' };
/** The matcher of the REJECTED candidate ecefe2c, kept verbatim as evidence: it never looked at actor_auth_user_id, source or the actor's profile, and any one of several events sufficed. */
const matcherOfRejectedCandidateEcefe2c = (events: any[] | null | undefined, memberId: string, merchantId: string) => (events ?? []).some((e) => {
  if (!e || typeof e !== 'object') return false;
  return e.action === MEMBER_CREATED_ACTION && e.entity_type === 'collaborator' && e.entity_id === memberId && e.actor_role === 'merchant' && !!e.details && typeof e.details === 'object' && e.details.merchant_id === merchantId;
});
ok('selectCreationAudit: exactly ONE creation event for THIS application, coherent (merchant role, this Merchant, API audit source, a real actor id, a valid time), is accepted', () => {
  assert.equal(MEMBER_CREATED_ACTION, 'collaborator.member_application_created'); assert.equal(MEMBER_AUDIT_SOURCE, 'v2-admin-api');
  assert.deepEqual(selectCreationAudit([goodEvent], RM, RX), { ok: true, auditId: 7, actorUserId: RACTOR, occurredAt: goodEvent.occurred_at });
  assert.equal(selectCreationAudit([{ ...goodEvent, entity_id: ROTHER }, goodEvent], RM, RX).ok, true, 'events of other applications are ignored, not counted');
  assert.equal(selectCreationAudit([{ ...goodEvent, action: 'collaborator.created' }, goodEvent], RM, RX).ok, true, 'events with another action are ignored, not counted');
  assert.equal(selectCreationAudit([{ ...goodEvent, details: { merchant_id: RX } }], RM, RX).ok, true, 'the auth_invitation_required flag is not part of the evidence');
});
ok('selectCreationAudit: every other shape is refused WITH the specific reason (none, several, role, Merchant, source, actor, time, malformed)', () => {
  const why = (events: any, expected: string, label: string) => { const r = selectCreationAudit(events, RM, RX); assert.equal(r.ok, false, label); assert.equal((r as any).reason, expected, label); };
  why([], 'NO_CREATION_AUDIT', 'no events'); why(null, 'NO_CREATION_AUDIT', 'null list'); why(undefined, 'NO_CREATION_AUDIT', 'undefined list');
  why([{ ...goodEvent, entity_id: ROTHER }], 'NO_CREATION_AUDIT', 'another application\'s event'); why([{ ...goodEvent, action: 'collaborator.created' }], 'NO_CREATION_AUDIT', 'a different action (an Admin creation)');
  why([{ ...goodEvent, action: 'collaborator.member_application_audit_reconciled' }], 'NO_CREATION_AUDIT', 'the removed reconciliation action'); why([{ ...goodEvent, entity_type: 'merchant' }], 'NO_CREATION_AUDIT', 'a different entity type');
  why(['collaborator.member_application_created'], 'NO_CREATION_AUDIT', 'a string instead of an event'); why([null], 'NO_CREATION_AUDIT', 'a null event');
  why([goodEvent, { ...goodEvent, id: 8 }], 'MULTIPLE_CREATION_AUDITS', 'two identical valid events'); why([goodEvent, { ...goodEvent, id: 8, actor_role: 'admin' }], 'MULTIPLE_CREATION_AUDITS', 'one valid + one forged: ambiguous, refused');
  why([{ ...goodEvent, id: 8, actor_auth_user_id: null }, goodEvent], 'MULTIPLE_CREATION_AUDITS', 'the order of the events never matters (forged first)');
  why([{ ...goodEvent, actor_role: 'admin' }], 'AUDIT_ROLE_NOT_MERCHANT', 'an Admin role'); why([{ ...goodEvent, actor_role: 'collaborator' }], 'AUDIT_ROLE_NOT_MERCHANT', 'a Partner role'); why([{ ...goodEvent, actor_role: 'unknown' }], 'AUDIT_ROLE_NOT_MERCHANT', 'an unknown role');
  why([{ ...goodEvent, actor_role: null }], 'AUDIT_ROLE_NOT_MERCHANT', 'a null role'); why([{ ...goodEvent, actor_role: 'Merchant' }], 'AUDIT_ROLE_NOT_MERCHANT', 'the role is compared exactly');
  why([{ ...goodEvent, details: { merchant_id: ROTHER } }], 'AUDIT_MERCHANT_MISMATCH', 'another Merchant'); why([{ ...goodEvent, details: null }], 'AUDIT_MERCHANT_MISMATCH', 'no details'); why([{ ...goodEvent, details: 'x' }], 'AUDIT_MERCHANT_MISMATCH', 'details not an object');
  why([{ ...goodEvent, details: {} }], 'AUDIT_MERCHANT_MISMATCH', 'details without a Merchant'); why([{ ...goodEvent, details: { merchant_id: RX.toUpperCase() } }], 'AUDIT_MERCHANT_MISMATCH', 'ids are compared exactly, not case-folded');
  for (const src of ['v2', 'legacy-import', '', null, undefined]) why([{ ...goodEvent, source: src }], 'AUDIT_SOURCE_UNEXPECTED', `source ${JSON.stringify(src)} is not an API audit writer`);
  for (const actor of [null, undefined, '', 'not-a-uuid', 123, {}, `${RACTOR} `]) why([{ ...goodEvent, actor_auth_user_id: actor }], 'AUDIT_ACTOR_MISSING', `actor ${JSON.stringify(actor)}`);
  for (const at of [null, undefined, '', 'yesterday', 1762855200000]) why([{ ...goodEvent, occurred_at: at }], 'AUDIT_TIME_INVALID', `time ${JSON.stringify(at)}`);
});
ok('checkCreationActor: the actor must be a Merchant profile bound to THIS Merchant that already existed when the event was written; anything else is refused with its reason', () => {
  const sel = { actorUserId: RACTOR, occurredAt: goodEvent.occurred_at };
  assert.deepEqual(checkCreationActor(sel, goodProfile, RX), { ok: true });
  assert.deepEqual(checkCreationActor(sel, { ...goodProfile, user_profiles_status: 'inactive' } as any, RX), { ok: true }, 'today\'s status is not creation-time evidence: it neither proves nor disproves anything');
  assert.deepEqual(checkCreationActor(sel, { ...goodProfile, created_at: goodEvent.occurred_at }, RX), { ok: true }, 'a profile created in the same instant is not "later"');
  // PostgREST returns microsecond timestamps with an offset; they must compare correctly
  const sel6 = { actorUserId: RACTOR, occurredAt: '2026-11-11T10:00:00.123456+00:00' };
  assert.deepEqual(checkCreationActor(sel6, { ...goodProfile, created_at: '2026-11-11T09:59:59.999999+00:00' }, RX), { ok: true }, 'microsecond timestamps, profile earlier');
  assert.deepEqual(checkCreationActor(sel6, { ...goodProfile, created_at: '2026-11-11T17:00:00.000000+07:00' }, RX), { ok: true }, 'a different UTC offset for the same instant');
  assert.equal(checkCreationActor(sel6, { ...goodProfile, created_at: '2026-11-11T10:00:00.124000+00:00' }, RX).ok, false, 'microsecond timestamps, profile later');
  const why = (profile: any, expected: string, label: string) => { const r = checkCreationActor(sel, profile, RX); assert.equal(r.ok, false, label); assert.equal((r as any).reason, expected, label); };
  why(null, 'ACTOR_PROFILE_MISSING', 'no such user'); why(undefined, 'ACTOR_PROFILE_MISSING', 'undefined'); why('x', 'ACTOR_PROFILE_MISSING', 'not an object');
  why({ ...goodProfile, user_id: ROTHER }, 'ACTOR_PROFILE_MISMATCH', 'a profile of somebody else'); why({ ...goodProfile, user_id: null }, 'ACTOR_PROFILE_MISMATCH', 'a profile without user id');
  why({ ...goodProfile, role: 'admin', merchant_id: null }, 'ACTOR_NOT_A_MERCHANT_USER', 'an Admin'); why({ ...goodProfile, role: 'collaborator', merchant_id: null }, 'ACTOR_NOT_A_MERCHANT_USER', 'a Partner');
  why({ ...goodProfile, role: null }, 'ACTOR_NOT_A_MERCHANT_USER', 'no role'); why({ ...goodProfile, role: 'Merchant' }, 'ACTOR_NOT_A_MERCHANT_USER', 'role compared exactly');
  why({ ...goodProfile, merchant_id: ROTHER }, 'ACTOR_BOUND_TO_OTHER_MERCHANT', 'a user of another Merchant'); why({ ...goodProfile, merchant_id: null }, 'ACTOR_BOUND_TO_OTHER_MERCHANT', 'a user of no Merchant (moved away)');
  why({ ...goodProfile, merchant_id: RX.toUpperCase() }, 'ACTOR_BOUND_TO_OTHER_MERCHANT', 'Merchant ids are compared exactly');
  why({ ...goodProfile, created_at: '2026-11-11T10:00:00.001+00:00' }, 'ACTOR_PROFILE_POSTDATES_AUDIT', 'a profile created a millisecond AFTER the event'); why({ ...goodProfile, created_at: '2027-01-01T00:00:00+00:00' }, 'ACTOR_PROFILE_POSTDATES_AUDIT', 'created long after');
  why({ ...goodProfile, created_at: null }, 'ACTOR_PROFILE_POSTDATES_AUDIT', 'no creation time: not provable'); why({ ...goodProfile, created_at: 'soon' }, 'ACTOR_PROFILE_POSTDATES_AUDIT', 'an unreadable creation time');
});
ok('REGRESSION (finding 1, Medium): the matcher of the rejected candidate ecefe2c accepted events whose ACTOR was never checked; the new two-stage check refuses each of them', () => {
  // events that claim "merchant" + this Merchant but whose actor is wrong, plus the profile the actor really has. ecefe2c accepted ALL of them.
  const cases: Array<[string, any, any, string]> = [
    ['a null actor', { ...goodEvent, actor_auth_user_id: null }, null, 'AUDIT_ACTOR_MISSING'],
    ['an Admin user wearing the role "merchant"', goodEvent, { ...goodProfile, role: 'admin', merchant_id: null }, 'ACTOR_NOT_A_MERCHANT_USER'],
    ['a Partner user wearing the role "merchant"', goodEvent, { ...goodProfile, role: 'collaborator', merchant_id: null }, 'ACTOR_NOT_A_MERCHANT_USER'],
    ['a user of ANOTHER Merchant', goodEvent, { ...goodProfile, merchant_id: ROTHER }, 'ACTOR_BOUND_TO_OTHER_MERCHANT'],
    ['an actor id that is not a user at all', goodEvent, null, 'ACTOR_PROFILE_MISSING'],
    ['an event from another source (not an API audit writer)', { ...goodEvent, source: 'legacy-import' }, goodProfile, 'AUDIT_SOURCE_UNEXPECTED'],
    ['a profile created after the event', goodEvent, { ...goodProfile, created_at: '2026-12-01T00:00:00+00:00' }, 'ACTOR_PROFILE_POSTDATES_AUDIT'],
  ];
  const verdict = (event: any, profile: any) => { const s = selectCreationAudit([event], RM, RX); if (s.ok === false) return s.reason; const c = checkCreationActor(s, profile, RX); return c.ok === false ? c.reason : 'ACCEPTED'; };
  for (const [label, event, profile, expected] of cases) {
    assert.equal(matcherOfRejectedCandidateEcefe2c([event], RM, RX), true, `${label}: the old matcher accepted it - that was the finding`);
    assert.equal(verdict(event, profile), expected, `${label}: the new check refuses it`);
  }
  // the old matcher also accepted "one good event among several"; the new check treats several as ambiguous
  assert.equal(matcherOfRejectedCandidateEcefe2c([goodEvent, { ...goodEvent, id: 8, actor_auth_user_id: null }], RM, RX), true);
  assert.equal(verdict(goodEvent, goodProfile), 'ACCEPTED', 'the legitimate case is still accepted'); assert.equal(selectCreationAudit([goodEvent, { ...goodEvent, id: 8, actor_auth_user_id: null }], RM, RX).ok, false);
});
ok('cross-actor replay: ANOTHER Merchant user of the same Merchant replaying is judged by the CREATOR\'s binding, not by who is asking (the requester is not an input to either stage)', () => {
  assert.equal(selectCreationAudit.length, 3); assert.equal(checkCreationActor.length, 3);          // (events, application, merchant) / (selection, profile, merchant): no requester parameter exists
  const s = selectCreationAudit([goodEvent], RM, RX); assert.equal(s.ok, true); assert.deepEqual(checkCreationActor(s as any, goodProfile, RX), { ok: true });
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
