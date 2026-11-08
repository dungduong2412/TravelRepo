import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { RecipientPolicy, isRecipientAllowed, maskEmail } from '../../common/email/recipient-policy';
import { SmtpConfigError, classifySmtpError, createSmtpTransport, readSmtpSettings } from './smtp-config';
import { renderPartnerActivationEmail, renderWelcomeEmail } from './email-templates';

/** What happened to one outgoing message. `reason` is a stable class only (never server text, addresses or links). */
export type DeliveryOutcome = { status: 'sent' | 'suppressed' | 'failed'; reason?: string };
export type SuppressionReason = 'delivery_disabled' | 'not_allowlisted' | 'migrated_identity' | 'policy_unavailable';

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
   * Single recipient gate for application e-mails (same policy as the Auth hook gateway). Returns null when the recipient may be mailed, otherwise
   * the reason it must not be. Callers check this BEFORE touching any account so a suppressed message changes nothing.
   */
  async suppressionFor(to: string, userId?: string): Promise<SuppressionReason | null> {
    if (process.env.AUTH_EMAIL_DELIVERY !== 'enabled') return 'delivery_disabled';
    if (!isRecipientAllowed(to)) return 'not_allowlisted';
    try { if (await this.policy.isMigrated(userId, to)) return 'migrated_identity'; } catch { return 'policy_unavailable'; } // fails closed
    return null;
  }

  /**
   * Sends the Partner activation e-mail and REPORTS the outcome instead of hiding it, so the caller can record it and offer a retry.
   * It never throws: a mail problem must not undo an approval. The link and the token are never logged.
   */
  async sendPartnerActivation(to: string, p: { partnerName: string; activationUrl: string; requestNewLinkUrl: string; ttlHours: number; userId?: string }): Promise<DeliveryOutcome> {
    const masked = maskEmail(to);
    try {
      const blocked = await this.suppressionFor(to, p.userId);
      if (blocked) { this.log.log(`partner_activation suppressed to ${masked}: ${blocked}`); return { status: 'suppressed', reason: blocked }; }
      let settings;
      try { settings = readSmtpSettings(); } catch (err) {
        this.log.error(`partner_activation skipped for ${masked}: SMTP misconfigured — ${err instanceof SmtpConfigError ? err.message : 'unreadable'}`);
        return { status: 'failed', reason: 'smtp_not_configured' };
      }
      const message = renderPartnerActivationEmail({ ...p, subjectPrefix: process.env.AUTH_EMAIL_SUBJECT_PREFIX ?? '[UAT] ' });
      const info = await createSmtpTransport(settings).sendMail({
        to, from: settings.from, replyTo: settings.replyTo,
        subject: message.subject, html: message.html, text: message.text,
        headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
      });
      const accepted = Array.isArray((info as { accepted?: unknown[] })?.accepted) ? (info as { accepted: unknown[] }).accepted.length : 'n/a';
      this.log.log(`sent partner_activation to ${masked} accepted=${accepted}`);
      return { status: 'sent' };
    } catch (err: unknown) {
      const reason = classifySmtpError(err);
      this.log.error(`partner_activation delivery failed for ${masked}: ${reason}`);
      return { status: 'failed', reason };
    }
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
