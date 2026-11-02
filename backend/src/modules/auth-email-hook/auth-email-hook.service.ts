import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as nodemailer from 'nodemailer';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuthEmailPayload, composeMessage, decide, parseAllowlist, verifyHookSignature } from './email-policy';

type Sender = (message: { to: string; from: string; subject: string; html: string; text: string }) => Promise<unknown>;

/**
 * Gateway for the Supabase Auth "Send Email" hook. Inactive until AUTH_EMAIL_HOOK_SECRET is configured; with the hook disabled in Auth this
 * code is never called. Even when called, nothing is sent unless AUTH_EMAIL_DELIVERY=enabled AND the recipient is allowlisted AND is not a migrated identity.
 * A suppressed message still returns 200 so signup/recovery responses do not reveal which addresses exist or are allowlisted.
 */
@Injectable()
export class AuthEmailHookService {
  private readonly log = new Logger('AuthEmailHook');
  private sender: Sender | null = null;
  constructor(private readonly supabase: SupabaseService) {}

  /** test seam */
  useSender(sender: Sender) { this.sender = sender; }

  private getSender(): Sender {
    if (this.sender) return this.sender;
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) throw new ServiceUnavailableException('SMTP is not configured');
    const transport = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT || 587), secure: Number(SMTP_PORT) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS }, requireTLS: Number(SMTP_PORT) !== 465, connectionTimeout: 3000, greetingTimeout: 3000, socketTimeout: 4000 }); // Auth abandons a hook call after a few seconds
    return (m) => transport.sendMail(m);
  }

  /**
   * A recipient is a migrated V1 identity when legacy_identity_map holds its V2 Auth user id (auth_user_id) OR the sha256 of its normalised address
   * (source_email_sha256, same normalisation as the importer). Returns the Auth id (lower-case) when migrated so decide() can block it.
   */
  private async migratedIds(userId: string | undefined, email: string): Promise<Set<string>> {
    const hash = createHash('sha256').update(email.trim().toLocaleLowerCase('en-US')).digest('hex');
    const uid = userId && /^[0-9a-f-]{36}$/.test(userId) ? userId : undefined;
    const filter = [uid ? `auth_user_id.eq.${uid}` : null, `source_email_sha256.eq.${hash}`].filter(Boolean).join(',');
    const { data, error } = await this.supabase.getClient().from('legacy_identity_map').select('auth_user_id').or(filter).limit(1);
    if (error) throw new ServiceUnavailableException('Recipient policy is unavailable'); // fail closed
    // Any hit blocks; when only the e-mail hash matched, block under a synthetic id so decide() still suppresses.
    return new Set((data || []).length ? [uid ?? '*'] : []);
  }

  async handle(headers: Record<string, string | undefined>, rawBody: Buffer) {
    const secret = process.env.AUTH_EMAIL_HOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException('Auth e-mail hook is not configured');
    const ok = verifyHookSignature({ secret, id: headers['webhook-id'], timestamp: headers['webhook-timestamp'], signature: headers['webhook-signature'], rawBody });
    if (!ok) throw new UnauthorizedException('Invalid hook signature');

    const payload = JSON.parse(rawBody.toString('utf8')) as AuthEmailPayload;
    const email = payload.user?.email;
    if (!email) throw new UnauthorizedException('Malformed hook payload');
    const userId = payload.user.id?.toLowerCase();
    const decision = decide({
      email, userId, allowlist: parseAllowlist(process.env.AUTH_EMAIL_ALLOWLIST),
      migratedUserIds: await this.migratedIds(userId, email), enabled: process.env.AUTH_EMAIL_DELIVERY === 'enabled',
    });
    const masked = email.replace(/^(.).*@/, '$1***@');
    if (decision.action === 'suppress') {
      this.log.warn(`suppressed ${payload.email_data.email_action_type} to ${masked}: ${decision.reason}`);
      return { suppressed: true };
    }
    const from = process.env.SMTP_FROM;
    if (!from) throw new ServiceUnavailableException('SMTP_FROM is not configured');
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const message = composeMessage(supabaseUrl, payload, process.env.AUTH_EMAIL_SUBJECT_PREFIX ?? '[UAT] ');
    await this.getSender()({ to: email, from, ...message });
    this.log.log(`sent ${payload.email_data.email_action_type} to ${masked}`);
    return { sent: true };
  }
}
