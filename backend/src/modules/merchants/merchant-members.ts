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
/** The audit action written, in the same transaction as the application row, by create_merchant_member_application. */
export const MEMBER_CREATED_ACTION = 'collaborator.member_application_created';
export type AuditEventRow = { action?: unknown; entity_type?: unknown; entity_id?: unknown; actor_role?: unknown; details?: unknown };
/**
 * Does the audit trail contain a creation event that MATCHES this application? An idempotent replay may be answered with success only when it does.
 * Matching means all of: the creation action, entity type 'collaborator', THIS application's id, actor role 'merchant', and details.merchant_id equal to the
 * Merchant making the request. The shape of the application's code, its age or its state prove nothing here: only an audit event that really exists counts, and
 * nothing is ever written to make one exist.
 */
export function hasMatchingCreationAudit(events: readonly AuditEventRow[] | null | undefined, memberId: string, merchantId: string): boolean {
  return (events ?? []).some((e) => {
    if (!e || typeof e !== 'object') return false;
    const details = e.details as { merchant_id?: unknown } | null | undefined;
    return e.action === MEMBER_CREATED_ACTION && e.entity_type === 'collaborator' && e.entity_id === memberId && e.actor_role === 'merchant'
      && !!details && typeof details === 'object' && details.merchant_id === merchantId;
  });
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
