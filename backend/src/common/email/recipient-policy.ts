import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

/**
 * ONE recipient policy for every e-mail the platform can cause, whichever path triggers it:
 *   - Supabase Auth messages (signup, recovery, invite, magic link) through the Send Email hook gateway;
 *   - admin invitations that call Auth's inviteUserByEmail.
 * A recipient may be mailed only if (1) it is on the tester allowlist and (2) it is not a migrated V1 identity (checked by Auth user id AND
 * by the SHA-256 of the normalised address, so it holds even if the Auth user does not exist yet). The migrated check fails closed.
 */

/** Public mailbox providers: a whole-domain allowlist entry for one of these would open delivery to the world, so such entries are ignored. */
export const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com', 'me.com',
  'proton.me', 'protonmail.com', 'aol.com', 'zoho.com', 'gmx.com', 'mail.com', 'yandex.com', 'qq.com', '163.com',
]);

export function parseAllowlist(raw: string | undefined): string[] {
  return (raw || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
}

/** Entries are exact addresses (a plus alias is matched literally: "a+uat1@x.com" does not authorise "a@x.com") or "@domain" for a domain the owner controls. */
export function isAllowlisted(email: string, allowlist: string[]): boolean {
  const target = email.trim().toLowerCase();
  if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(target)) return false;
  return allowlist.some((entry) => {
    if (!entry.startsWith('@')) return target === entry;
    return !PUBLIC_MAIL_DOMAINS.has(entry.slice(1)) && target.endsWith(entry) && target.length > entry.length;
  });
}

/** Allowlist entries that cannot work as written (public-provider domains, malformed): reported at start-up so a typo is not silently "no delivery". */
export function allowlistProblems(allowlist: string[]): string[] {
  return allowlist.flatMap((entry) => {
    if (entry.startsWith('@')) return PUBLIC_MAIL_DOMAINS.has(entry.slice(1)) ? [`"${entry}" is a public mailbox provider and is ignored; list exact addresses`] : /^@[a-z0-9.-]+\.[a-z]{2,}$/.test(entry) ? [] : [`"${entry}" is not a valid domain entry`];
    return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(entry) ? [] : [`"${entry}" is not a valid address`];
  });
}

/**
 * Effective allowlist check. AUTH_EMAIL_ALLOWLIST is the single source of truth. INVITATION_EMAIL_ALLOWLIST is kept only for backwards compatibility:
 * when it is also set it can only NARROW delivery (an address must be on both), never widen it. Neither set = nobody is allowed.
 */
export function isRecipientAllowed(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const lists = [env.AUTH_EMAIL_ALLOWLIST, env.INVITATION_EMAIL_ALLOWLIST].filter((v) => v !== undefined && v.trim() !== '').map(parseAllowlist);
  return lists.length > 0 && lists.every((list) => isAllowlisted(email, list));
}

export function emailSha256(email: string): string {
  return createHash('sha256').update(email.trim().toLocaleLowerCase('en-US')).digest('hex'); // same normalisation as the importer
}

/** "t***@example.com": enough to correlate a log line with a tester, not enough to identify a customer. */
export function maskEmail(email: string): string {
  return (email || '').replace(/^(.).*@/, '$1***@');
}

export class RecipientPolicy {
  constructor(private readonly supabase: SupabaseService) {}

  /** True when the address or the Auth user id belongs to a migrated V1 identity. Throws (fail closed) when the lookup is unavailable. */
  async isMigrated(userId: string | undefined, email: string): Promise<boolean> {
    const uid = userId && /^[0-9a-fA-F-]{36}$/.test(userId) ? userId.toLowerCase() : undefined;
    const filter = [uid ? `auth_user_id.eq.${uid}` : null, `source_email_sha256.eq.${emailSha256(email)}`].filter(Boolean).join(',');
    const { data, error } = await this.supabase.getClient().from('legacy_identity_map').select('auth_user_id').or(filter).limit(1);
    if (error) throw new ServiceUnavailableException('Recipient policy is unavailable');
    return (data || []).length > 0;
  }
}
