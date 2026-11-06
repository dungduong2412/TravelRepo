import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { RecipientPolicy, isRecipientAllowed, maskEmail, parseAllowlist } from '../../common/email/recipient-policy';
import { AuthEmailPayload, composeMessage, decide, verifyHookSignature } from './email-policy';
import { SmtpConfigError, classifySmtpError, createSmtpTransport, readSmtpSettings } from './smtp-config';

type Outgoing = { to: string; from: string | { name?: string; address: string }; subject: string; html: string; text: string; replyTo?: string; headers?: Record<string, string> };
type Sender = (message: Outgoing) => Promise<unknown>;

/**
 * Gateway for the Supabase Auth "Send Email" hook. Inactive until AUTH_EMAIL_HOOK_SECRET is configured; with the hook disabled in Auth this
 * code is never called. Even when called, nothing is sent unless AUTH_EMAIL_DELIVERY=enabled AND the recipient is allowlisted AND is not a migrated identity.
 * A suppressed message still returns 200 so signup/recovery responses do not reveal which addresses exist or are allowlisted.
 * A delivery failure returns 503 with a stable class only (no server text, no credentials), which Auth surfaces as a failed request.
 */
@Injectable()
export class AuthEmailHookService {
  private readonly log = new Logger('AuthEmailHook');
  private sender: Sender | null = null;
  private readonly policy: RecipientPolicy;
  constructor(supabase: SupabaseService) { this.policy = new RecipientPolicy(supabase); }

  /** test seam */
  useSender(sender: Sender) { this.sender = sender; }

  private getSender(): Sender {
    if (this.sender) return this.sender;
    let settings;
    try { settings = readSmtpSettings(); } catch (err) {
      this.log.error(`SMTP configuration rejected: ${err instanceof SmtpConfigError ? err.message : 'unreadable'}`);
      throw new ServiceUnavailableException('SMTP is not configured');
    }
    const transport = createSmtpTransport(settings);
    this.sender = (m) => transport.sendMail({ ...m, from: settings.from, replyTo: settings.replyTo, headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' } });
    return this.sender;
  }

  async handle(headers: Record<string, string | undefined>, rawBody: Buffer) {
    const secret = process.env.AUTH_EMAIL_HOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException('Auth e-mail hook is not configured');
    const ok = verifyHookSignature({ secret, id: headers['webhook-id'], timestamp: headers['webhook-timestamp'], signature: headers['webhook-signature'], rawBody });
    if (!ok) throw new UnauthorizedException('Invalid hook signature');

    let payload: AuthEmailPayload;
    try { payload = JSON.parse(rawBody.toString('utf8')) as AuthEmailPayload; } catch { throw new UnauthorizedException('Malformed hook payload'); }
    const email = payload.user?.email;
    const action = payload.email_data?.email_action_type;
    if (!email || !action) throw new UnauthorizedException('Malformed hook payload');
    const userId = payload.user.id?.toLowerCase();

    const enabled = process.env.AUTH_EMAIL_DELIVERY === 'enabled';
    // Identity lookup only matters when delivery is on; when it is off nothing is sent either way.
    const migrated = enabled ? await this.policy.isMigrated(userId, email) : false;
    const decision = decide({
      email, userId, allowlist: parseAllowlist(process.env.AUTH_EMAIL_ALLOWLIST), allowed: isRecipientAllowed(email),
      migratedUserIds: new Set(migrated ? ['*'] : []), enabled,
    });
    const masked = maskEmail(email);
    if (decision.action === 'suppress') {
      this.log.warn(`suppressed ${action} to ${masked}: ${decision.reason}`);
      return { suppressed: true };
    }
    const message = composeMessage(process.env.SUPABASE_URL || '', payload, process.env.AUTH_EMAIL_SUBJECT_PREFIX ?? '[UAT] ', process.env.FRONTEND_URL || '');
    const send = this.getSender();
    let info: unknown;
    try {
      info = await send({ to: email, from: process.env.SMTP_FROM || '', ...message });
    } catch (err) {
      const failure = classifySmtpError(err);
      this.log.error(`delivery failed for ${action} to ${masked}: ${failure}`);
      throw new ServiceUnavailableException(`Email delivery failed (${failure})`);
    }
    const receipt = info as { messageId?: unknown; accepted?: unknown[] } | undefined;
    const messageId = typeof receipt?.messageId === 'string' ? receipt.messageId.replace(/[^\w<>@.\-+]/g, '').slice(0, 120) : 'n/a';
    this.log.log(`sent ${action} to ${masked} accepted=${Array.isArray(receipt?.accepted) ? receipt!.accepted!.length : 'n/a'} message_id=${messageId}`);
    return { sent: true };
  }
}
