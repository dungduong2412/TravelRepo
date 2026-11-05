import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { RecipientPolicy, isRecipientAllowed, maskEmail } from '../../common/email/recipient-policy';
import { SmtpConfigError, createSmtpTransport, readSmtpSettings } from './smtp-config';
import { renderWelcomeEmail } from './email-templates';

/**
 * Sends application-level transactional emails (not Supabase Auth hook events) over the same
 * OxMail SMTP infrastructure used by the hook gateway.
 *
 * Policy (identical to the hook gateway):
 *  - AUTH_EMAIL_DELIVERY must be 'enabled'
 *  - recipient must be on AUTH_EMAIL_ALLOWLIST
 *  - recipient must NOT be a migrated V1 identity
 *
 * Delivery failures are LOGGED but never thrown: a failed welcome email must not roll back a
 * successfully created Merchant.
 */
@Injectable()
export class ApplicationEmailService {
  private readonly log = new Logger('ApplicationEmail');
  private readonly policy: RecipientPolicy;

  constructor(supabase: SupabaseService) {
    this.policy = new RecipientPolicy(supabase);
  }

  /**
   * Sends a welcome email to the Merchant owner after successful profile creation.
   * Fire-and-forget: awaiting this is optional; it never rejects.
   */
  async sendMerchantWelcome(to: string, merchantName: string): Promise<void> {
    const masked = maskEmail(to);
    try {
      const enabled = process.env.AUTH_EMAIL_DELIVERY === 'enabled';
      if (!enabled) { this.log.log(`welcome email suppressed to ${masked}: delivery_disabled`); return; }
      if (!isRecipientAllowed(to)) { this.log.log(`welcome email suppressed to ${masked}: not_allowlisted`); return; }
      const migrated = await this.policy.isMigrated(undefined, to);
      if (migrated) { this.log.log(`welcome email suppressed to ${masked}: migrated_identity`); return; }

      const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
      const workspaceUrl = `${frontendUrl}/merchant/dashboard`;
      const subjectPrefix = process.env.AUTH_EMAIL_SUBJECT_PREFIX ?? '[UAT] ';
      const message = renderWelcomeEmail({ merchantName, workspaceUrl, subjectPrefix });

      let settings;
      try { settings = readSmtpSettings(); } catch (err) {
        this.log.error(`welcome email skipped for ${masked}: SMTP misconfigured — ${err instanceof SmtpConfigError ? err.message : 'unreadable'}`);
        return;
      }
      const transport = createSmtpTransport(settings);
      await transport.sendMail({
        to, from: settings.from, replyTo: settings.replyTo,
        subject: message.subject, html: message.html, text: message.text,
        headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
      });
      this.log.log(`sent merchant_welcome to ${masked}`);
    } catch (err: unknown) {
      // Delivery failures must never propagate to callers.
      this.log.error(`merchant_welcome delivery failed for ${masked}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
