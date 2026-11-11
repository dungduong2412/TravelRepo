import { z } from 'zod';

/**
 * Merchant "Members" (a Merchant adds a pending Partner application): input normalisation and validation, duplicate comparison, limits and
 * the PRIVACY projections. Everything here is pure so it can be tested without a database.
 *
 * Privacy rules (the reason this module exists):
 *  - a Merchant is shown only masked contact details of the Partners tagged to it (they may be real Partners it merely shares a history with);
 *  - bank details are never returned by any Members route, to anybody;
 *  - the answer to "create" carries no contact or bank data at all (the Merchant typed it a moment ago);
 *  - "this e-mail is already used" never discloses who or what holds it.
 */

// ---- limits (policy values; overridable by environment, defaults chosen for a Merchant adding a handful of people) ----------------------------------
export type MemberLimits = { perHour: number; perDay: number; pendingCap: number };
const intFromEnv = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
export function memberLimits(env: Record<string, string | undefined> = process.env): MemberLimits {
  return {
    perHour: intFromEnv(env.MERCHANT_MEMBER_CREATES_PER_HOUR, 10, 1, 1000),
    perDay: intFromEnv(env.MERCHANT_MEMBER_CREATES_PER_DAY, 40, 1, 10_000),
    pendingCap: intFromEnv(env.MERCHANT_MEMBER_PENDING_CAP, 50, 1, 100_000),
  };
}

// ---- normalisation ---------------------------------------------------------------------------------------------------------------------------------
export const collapseSpaces = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
export const normalizeEmail = (s: string) => s.trim().toLowerCase();
/** Phone numbers are stored without separators: digits with an optional leading "+". */
export const normalizePhone = (s: string) => {
  const t = s.trim();
  const plus = t.startsWith('+') ? '+' : '';
  return plus + t.replace(/^\+/, '').replace(/[\s.\-()]/g, '');
};
export const normalizeAccountNumber = (s: string) => s.trim().replace(/[\s\-]/g, '');

const CONTROL_OR_MARKUP = /[\p{Cc}\p{Cf}<>]/u;
const BANK_NAME_CHARS = /^[\p{L}\p{N} .,&()/'-]+$/u;
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const nameSchema = z.string().transform(collapseSpaces).pipe(z.string().min(2).max(120).refine((v) => !CONTROL_OR_MARKUP.test(v)));
const phoneSchema = z.string().transform(normalizePhone).pipe(z.string().regex(/^\+?\d{8,15}$/));
const emailSchema = z.string().transform(normalizeEmail).pipe(z.string().max(254).email().refine((v) => !/\.\.|\.@|^\./.test(v)));
const bankNameSchema = z.preprocess(emptyToUndefined, z.string().transform(collapseSpaces).pipe(z.string().min(2).max(100).regex(BANK_NAME_CHARS)).optional());
const accountSchema = z.preprocess(emptyToUndefined, z.string().transform(normalizeAccountNumber).pipe(z.string().regex(/^\d{6,20}$/)).optional());

/** `.strict()`: an unknown key is an error, so nothing the caller sends can reach the insert except these five fields. */
export const CreateMerchantMemberSchema = z.object({
  collaborators_name: nameSchema,
  collaborators_phone: phoneSchema,
  collaborators_email: emailSchema,
  collaborators_bank_name: bankNameSchema,
  collaborators_bank_acc_number: accountSchema,
}).strict();
export type CreateMerchantMemberDto = z.infer<typeof CreateMerchantMemberSchema>;

// ---- duplicate comparison ----------------------------------------------------------------------------------------------------------------------------
export type MemberRow = {
  id: string;
  merchant_system_id?: string | null;
  collaborators_code?: string | null;
  collaborators_name?: string | null;
  collaborators_phone?: string | null;
  collaborators_email?: string | null;
  collaborators_bank_name?: string | null;
  collaborators_bank_acc_number?: string | null;
  collaborators_avatar_url?: string | null;
  collaborators_status?: string | null;
  collaborators_verified?: boolean | null;
  collaborators_registered_date?: string | null;
};

const fold = (s: string | null | undefined) => collapseSpaces(String(s ?? '')).toLowerCase();
/** Is an existing row the very same submission? (an idempotent replay). Compares the NORMALISED values only. */
export function sameMemberData(row: MemberRow, dto: CreateMerchantMemberDto): boolean {
  return fold(row.collaborators_name) === fold(dto.collaborators_name)
    && normalizePhone(String(row.collaborators_phone ?? '')) === dto.collaborators_phone
    && normalizeEmail(String(row.collaborators_email ?? '')) === dto.collaborators_email
    && fold(row.collaborators_bank_name) === fold(dto.collaborators_bank_name)
    && normalizeAccountNumber(String(row.collaborators_bank_acc_number ?? '')) === String(dto.collaborators_bank_acc_number ?? '');
}

// ---- the database function (supabase/migrations/20261111000001): its answer is parsed STRICTLY and anything unexpected fails closed ------------------------
/** create_merchant_member_application: the application row and its creation audit event are written by one database transaction. */
export type CreateMemberRpcResult = { kind: 'CREATED'; row: MemberRow } | { kind: 'EMAIL_HELD' } | { kind: 'NOT_ALLOWED' } | { kind: 'INVALID' };
export function parseCreateMemberRpc(data: unknown): CreateMemberRpcResult {
  const d = (Array.isArray(data) ? data[0] : data) as { outcome?: unknown; member?: Record<string, unknown> } | null | undefined;
  if (!d || typeof d !== 'object') return { kind: 'INVALID' };
  if (d.outcome === 'EMAIL_HELD') return { kind: 'EMAIL_HELD' };
  if (d.outcome === 'NOT_ALLOWED') return { kind: 'NOT_ALLOWED' };
  if (d.outcome === 'CREATED' && d.member && typeof d.member === 'object' && typeof d.member.id === 'string' && d.member.id) return { kind: 'CREATED', row: d.member as unknown as MemberRow };
  return { kind: 'INVALID' };
}

// ---- replay verification ---------------------------------------------------------------------------------------------------------------------------------
/**
 * An idempotent replay is answered with success ONLY when the application's creation audit event can be read AND names a legitimate Merchant user of the
 * requesting Merchant as its actor. Two pure stages, with one read-only lookup between them (the actor's profile):
 *   1. selectCreationAudit  - exactly ONE creation event exists for the application, and its own claims are coherent (merchant actor role, this Merchant, the
 *                             API's audit source, a real actor id);
 *   2. checkCreationActor   - that actor id belongs to a Merchant profile bound to THIS Merchant that already existed when the event was written.
 * Nothing is ever written to make an event exist, and the shape of the application's code, its age or its state prove nothing here.
 *
 * WHAT STAGE 2 DOES AND DOES NOT PROVE. The event is the creation-time evidence: it is written in the same transaction as the application row, after that
 * transaction has checked the actor's profile, and nothing else in the product writes this action. Today's profile is NOT creation-time evidence (profiles can be
 * moved, re-roled, deactivated or deleted and re-created, and there is no history table); it is used only as a NECESSARY consistency condition, never as a
 * sufficient one: a claim ("a Merchant user of M created this") that today's profile contradicts - another Merchant, another role, no such user, a profile that
 * did not exist yet when the event was written - is refused. The price is conservative: if the original creator has since been moved or removed, the replay is
 * refused (generic 409 plus a log line) instead of guessed; a human decides. A different Merchant user of the SAME Merchant replaying the creator's submission is
 * accepted: what is checked is the creator's binding to the Merchant, not that the requester is the creator.
 */
/** The audit action written, in the same transaction as the application row, by create_merchant_member_application. */
export const MEMBER_CREATED_ACTION = 'collaborator.member_application_created';
/** The `source` stamped by every API-side audit writer (AuditService and create_merchant_member_application). An event with another source did not come from them. */
export const MEMBER_AUDIT_SOURCE = 'v2-admin-api';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AuditEventRow = { id?: unknown; occurred_at?: unknown; actor_auth_user_id?: unknown; actor_role?: unknown; action?: unknown; entity_type?: unknown; entity_id?: unknown; source?: unknown; details?: unknown };
export type ActorProfileRow = { user_id?: unknown; role?: unknown; merchant_id?: unknown; created_at?: unknown };

/** Why a replay was refused. Logged (with identifiers only) and never shown to the caller, who gets the generic e-mail-unavailable answer. */
export type ReplayRefusal =
  | 'NO_CREATION_AUDIT' | 'MULTIPLE_CREATION_AUDITS' | 'AUDIT_ROLE_NOT_MERCHANT' | 'AUDIT_MERCHANT_MISMATCH' | 'AUDIT_SOURCE_UNEXPECTED' | 'AUDIT_ACTOR_MISSING' | 'AUDIT_TIME_INVALID'
  | 'ACTOR_PROFILE_MISSING' | 'ACTOR_PROFILE_MISMATCH' | 'ACTOR_NOT_A_MERCHANT_USER' | 'ACTOR_BOUND_TO_OTHER_MERCHANT' | 'ACTOR_PROFILE_POSTDATES_AUDIT'
  | 'EMAIL_HELD_BY_MULTIPLE_ROWS';

export type CreationAuditSelection = { ok: true; auditId: unknown; actorUserId: string; occurredAt: string } | { ok: false; reason: ReplayRefusal };
export type CreationActorCheck = { ok: true } | { ok: false; reason: ReplayRefusal };

/**
 * Stage 1. `events` are the audit rows the caller read for THIS application; this function re-filters them (action, entity type, entity id) so it does not rely on the
 * query alone. More than one creation event for one application is an integrity anomaly and is refused whatever the events say: which of them is "the real one"
 * cannot be decided here, and the answer must not depend on which rows a query happened to return.
 */
export function selectCreationAudit(events: readonly AuditEventRow[] | null | undefined, memberId: string, merchantId: string): CreationAuditSelection {
  const mine = (events ?? []).filter((e): e is AuditEventRow => !!e && typeof e === 'object' && e.action === MEMBER_CREATED_ACTION && e.entity_type === 'collaborator' && e.entity_id === memberId);
  if (mine.length === 0) return { ok: false, reason: 'NO_CREATION_AUDIT' };
  if (mine.length > 1) return { ok: false, reason: 'MULTIPLE_CREATION_AUDITS' };
  const e = mine[0];
  const details = e.details as { merchant_id?: unknown } | null | undefined;
  if (e.actor_role !== 'merchant') return { ok: false, reason: 'AUDIT_ROLE_NOT_MERCHANT' };
  if (!details || typeof details !== 'object' || details.merchant_id !== merchantId) return { ok: false, reason: 'AUDIT_MERCHANT_MISMATCH' };
  if (e.source !== MEMBER_AUDIT_SOURCE) return { ok: false, reason: 'AUDIT_SOURCE_UNEXPECTED' };
  if (typeof e.actor_auth_user_id !== 'string' || !UUID_RE.test(e.actor_auth_user_id)) return { ok: false, reason: 'AUDIT_ACTOR_MISSING' };
  if (typeof e.occurred_at !== 'string' || Number.isNaN(Date.parse(e.occurred_at))) return { ok: false, reason: 'AUDIT_TIME_INVALID' };
  return { ok: true, auditId: e.id, actorUserId: e.actor_auth_user_id, occurredAt: e.occurred_at };
}

/** Stage 2. `profile` is the row read for `selection.actorUserId` (or null when there is none). */
export function checkCreationActor(selection: { actorUserId: string; occurredAt: string }, profile: ActorProfileRow | null | undefined, merchantId: string): CreationActorCheck {
  if (!profile || typeof profile !== 'object') return { ok: false, reason: 'ACTOR_PROFILE_MISSING' };
  if (profile.user_id !== selection.actorUserId) return { ok: false, reason: 'ACTOR_PROFILE_MISMATCH' };
  if (profile.role !== 'merchant') return { ok: false, reason: 'ACTOR_NOT_A_MERCHANT_USER' };
  if (profile.merchant_id !== merchantId) return { ok: false, reason: 'ACTOR_BOUND_TO_OTHER_MERCHANT' };
  // a profile created AFTER the event was written cannot be the user who wrote it (a deleted-and-recreated profile, or a forged actor that joined later)
  const created = typeof profile.created_at === 'string' ? Date.parse(profile.created_at) : Number.NaN;
  if (Number.isNaN(created) || created > Date.parse(selection.occurredAt)) return { ok: false, reason: 'ACTOR_PROFILE_POSTDATES_AUDIT' };
  return { ok: true };
}

/** Escapes LIKE wildcards so an e-mail such as a_b@x.vn is matched literally by ILIKE. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// ---- privacy projections -----------------------------------------------------------------------------------------------------------------------------
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length <= 3 ? '***' : `${'*'.repeat(Math.max(3, digits.length - 3))}${digits.slice(-3)}`;
}

/** One row of a Members list: contact details masked, NO bank details, no code, no internal columns. */
export function toMemberListItem(row: MemberRow) {
  return {
    id: row.id,
    collaborators_name: row.collaborators_name ?? null,
    collaborators_phone: maskPhone(row.collaborators_phone),
    collaborators_email: maskEmail(row.collaborators_email),
    collaborators_avatar_url: row.collaborators_avatar_url ?? null,
    collaborators_registered_date: row.collaborators_registered_date ?? null,
    collaborators_verified: row.collaborators_verified ?? false,
    collaborators_status: row.collaborators_status ?? null,
  };
}

/** The answer to a successful create: identification and state only. */
export function toCreatedMemberView(row: MemberRow, replay: boolean) {
  return {
    id: row.id,
    collaborators_code: row.collaborators_code ?? null,
    collaborators_name: row.collaborators_name ?? null,
    collaborators_status: row.collaborators_status ?? 'pending',
    collaborators_verified: row.collaborators_verified ?? false,
    collaborators_registered_date: row.collaborators_registered_date ?? null,
    idempotent_replay: replay,
  };
}
