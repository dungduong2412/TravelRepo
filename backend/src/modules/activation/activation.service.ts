import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import { ApplicationEmailService } from '../auth-email-hook/application-email.service';
import { maskEmail } from '../../common/email/recipient-policy';
import { SlidingWindowLimiter } from '../../common/http/rate-limiter';
import { activationSecret, activationTtlHours, newNonce, sameSecret, signActivationToken, verifyActivationToken } from './activation-token';

export type ActivationTrigger = 'approval' | 'admin_resend' | 'user_resend';
export type ActivationDelivery = { status: 'sent' | 'suppressed' | 'failed' | 'not_eligible'; reason?: string; trigger: ActivationTrigger; at: string };

const NORMALISE = (v?: string | null) => (v || '').trim().toLowerCase();
const likeExact = (value: string) => value.replace(/[\\%_]/g, '\\$&'); // ilike without wildcards
const fail = (status: HttpStatus, code: string, message: string) => new HttpException({ code, message }, status);
const DELIVERY_ACTIONS = ['collaborator.activation_email_sent', 'collaborator.activation_email_suppressed', 'collaborator.activation_email_failed'];

/**
 * Everything about the "approved -> activation e-mail -> click -> Partner Portal" step.
 *
 *  - sendActivation   issues a fresh link (superseding every older one) and e-mails it; reports the outcome and audits it. Never throws, so an
 *                     approval is never undone by a mail problem, and it can be repeated (Admin retry, user resend) without touching the approval.
 *  - requestLink      public "send me a new link": always answers the same, whoever asks, and does its work in the background.
 *  - verify / consume the redemption side used by AuthService.activate (see activation-token.ts for the acceptance rules).
 */
@Injectable()
export class ActivationService {
  private readonly log = new Logger('Activation');
  private readonly byEmail = new SlidingWindowLimiter(3, 60 * 60_000);
  private readonly byIp = new SlidingWindowLimiter(10, 60 * 60_000);
  private readonly redeemByIp = new SlidingWindowLimiter(30, 10 * 60_000);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
    private readonly appEmail: ApplicationEmailService,
  ) {}

  private get db() { return this.supabase.getClient(); }

  /** Web base for links: https, or loopback for local development. Anything else is refused rather than mailed. */
  private webBase(): string | null {
    const raw = (process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
    try {
      const u = new URL(raw);
      const loopback = ['localhost', '127.0.0.1'].includes(u.hostname);
      if (u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) return u.origin;
    } catch { /* fall through */ }
    return null;
  }

  /** The approved Partner, its single linked account and Auth identity — or the reason it cannot be activated. */
  private async partnerFor(collaboratorId: string) {
    const { data: collab } = await this.db.from('collaborators')
      .select('id,collaborators_name,collaborators_email,collaborators_status,collaborators_verified').eq('id', collaboratorId).maybeSingle();
    if (!collab) return { reason: 'partner_not_found' as const };
    if (!collab.collaborators_verified || collab.collaborators_status !== 'active') return { reason: 'not_approved' as const };
    const { data: profiles } = await this.db.from('user_profiles')
      .select('id,user_id,email,role,user_profiles_status,collaborator_id,login_count').eq('collaborator_id', collaboratorId).eq('role', 'collaborator');
    if (!profiles?.length) return { reason: 'owner_not_linked' as const };
    if (profiles.length > 1) return { reason: 'owner_ambiguous' as const };
    const profile = profiles[0];
    if (profile.user_profiles_status !== 'active') return { reason: 'profile_not_active' as const };
    if ((profile.login_count || 0) > 0) return { reason: 'already_activated' as const };
    const { data: auth } = await this.db.auth.admin.getUserById(profile.user_id);
    const authUser = auth?.user;
    if (!authUser?.email) return { reason: 'identity_missing' as const };
    if (NORMALISE(authUser.email) !== NORMALISE(profile.email) || NORMALISE(authUser.email) !== NORMALISE(collab.collaborators_email)) return { reason: 'email_mismatch' as const };
    return { collab, profile, authUser };
  }

  private async record(actor: AuditActor, collaboratorId: string, d: ActivationDelivery, recipient?: string) {
    if (d.status === 'not_eligible') return;
    try {
      await this.audit.record(actor, `collaborator.activation_email_${d.status}`, 'collaborator', collaboratorId, {
        trigger: d.trigger, ...(d.reason ? { reason: d.reason } : {}), ...(recipient ? { recipient: maskEmail(recipient) } : {}), ttl_hours: activationTtlHours(),
      });
    } catch (err) {
      this.log.error(`could not audit activation e-mail outcome (${d.status}) for ${collaboratorId}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  async sendActivation(collaboratorId: string, trigger: ActivationTrigger, actor: AuditActor): Promise<ActivationDelivery> {
    const at = new Date().toISOString();
    const result = async (status: ActivationDelivery['status'], reason?: string, to?: string): Promise<ActivationDelivery> => {
      const d: ActivationDelivery = { status, ...(reason ? { reason } : {}), trigger, at };
      await this.record(actor, collaboratorId, d, to);
      return d;
    };
    try {
      const p = await this.partnerFor(collaboratorId);
      if ('reason' in p) return result('not_eligible', p.reason);
      const to = p.authUser.email as string;

      // 1. Recipient policy first: a message that will not be sent must not change the account at all.
      const blocked = await this.appEmail.suppressionFor(to, p.profile.user_id);
      if (blocked) return result('suppressed', blocked, to);
      const base = this.webBase();
      if (!base) return result('failed', 'unsafe_link_base', to);

      // 2. A new nonce supersedes every earlier link for this account.
      const previous = (p.authUser.app_metadata as Record<string, unknown> | undefined)?.activation_nonce;
      const nonce = newNonce();
      const { error: nonceError } = await this.db.auth.admin.updateUserById(p.profile.user_id, { app_metadata: { ...(p.authUser.app_metadata || {}), activation_nonce: nonce } });
      if (nonceError) return result('failed', 'auth_update_failed', to);

      const ttl = activationTtlHours();
      const token = signActivationToken({ u: p.profile.user_id, c: collaboratorId, n: nonce, e: Date.now() + ttl * 3_600_000 }, activationSecret());
      const outcome = await this.appEmail.sendPartnerActivation(to, {
        partnerName: p.collab.collaborators_name || to, activationUrl: `${base}/auth/activate#token=${token}`, requestNewLinkUrl: `${base}/auth/activate`, ttlHours: ttl, userId: p.profile.user_id,
      });
      if (outcome.status !== 'sent') {
        // Nothing reached the person: put the previous link back in force instead of leaving the account with no usable link.
        await this.db.auth.admin.updateUserById(p.profile.user_id, { app_metadata: { ...(p.authUser.app_metadata || {}), activation_nonce: typeof previous === 'string' ? previous : null } }).catch(() => undefined);
      }
      return result(outcome.status, outcome.reason, to);
    } catch (err) {
      this.log.error(`activation e-mail step failed for ${collaboratorId}: ${err instanceof Error ? err.message : 'unknown'}`);
      return result('failed', 'internal_error');
    }
  }

  /** Public "send me a new link". Identical, immediate answer for everyone; the real work happens afterwards and only for an eligible account. */
  requestLink(email: unknown, ip: string): void {
    const clean = NORMALISE(typeof email === 'string' ? email : '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.length > 254) return;
    if (!this.byIp.take(ip) || !this.byEmail.take(clean)) return;
    void this.resendNow(clean).catch((err) => this.log.error(`public activation resend failed: ${err instanceof Error ? err.message : 'unknown'}`));
  }

  /** Exposed for tests; see requestLink. */
  async resendNow(email: string): Promise<ActivationDelivery | null> {
    const { data: profile } = await this.db.from('user_profiles').select('id,user_id,collaborator_id,role,user_profiles_status').ilike('email', likeExact(NORMALISE(email))).limit(1).maybeSingle();
    if (!profile || profile.role !== 'collaborator' || profile.user_profiles_status !== 'active' || !profile.collaborator_id) return null;
    // Cool-down: at most one automatic mail per account every two minutes, whoever asks.
    const since = new Date(Date.now() - 2 * 60_000).toISOString();
    const { data: recent } = await this.db.from('audit_events').select('id').eq('entity_id', profile.collaborator_id).in('action', DELIVERY_ACTIONS).gte('occurred_at', since).limit(1);
    if (recent?.length) return null;
    return this.sendActivation(profile.collaborator_id, 'user_resend', { id: profile.user_id, role: 'collaborator' });
  }

  /** What the Admin sees next to the Partner: the latest delivery attempts and whether the person has entered the portal yet. */
  async status(collaboratorId: string) {
    const [{ data: events }, { data: profile }] = await Promise.all([
      this.db.from('audit_events').select('action,occurred_at,details').eq('entity_id', collaboratorId).in('action', DELIVERY_ACTIONS).order('occurred_at', { ascending: false }).limit(5),
      this.db.from('user_profiles').select('login_count,last_login_at,user_profiles_status').eq('collaborator_id', collaboratorId).eq('role', 'collaborator').maybeSingle(),
    ]);
    const attempts = (events || []).map((e: any) => ({ status: String(e.action).replace('collaborator.activation_email_', ''), at: e.occurred_at, trigger: e.details?.trigger ?? null, reason: e.details?.reason ?? null }));
    return {
      activated: Boolean(profile && (profile.login_count || 0) > 0), last_login_at: profile?.last_login_at ?? null, profile_status: profile?.user_profiles_status ?? null,
      last_attempt: attempts[0] ?? null, attempts,
    };
  }

  // ---- redemption -------------------------------------------------------------------------------------------------------------------------------

  /** Validates a token against the database. Throws a stable, non-leaking error when anything is off; the thrown code says what the person should do. */
  async verify(token: unknown, ip: string) {
    if (!this.redeemByIp.take(ip)) throw fail(HttpStatus.TOO_MANY_REQUESTS, 'ACTIVATION_RATE_LIMITED', 'Too many attempts; try again later');
    const invalid = (why: string) => { this.log.warn(`activation refused: ${why}`); return fail(HttpStatus.UNAUTHORIZED, 'ACTIVATION_LINK_INVALID', 'The activation link is invalid or has expired'); };
    const check = verifyActivationToken(token, activationSecret());
    if (check.ok !== true) throw invalid(`token_${(check as { reason: string }).reason}`);
    const { u, c, n } = (check as { claims: { u: string; c: string; n: string } }).claims;

    const { data: profile } = await this.db.from('user_profiles')
      .select('id,user_id,email,role,full_name,user_profiles_status,merchant_id,collaborator_id,login_count').eq('user_id', u).maybeSingle();
    if (!profile || profile.role !== 'collaborator' || profile.collaborator_id !== c) throw invalid('account_mismatch');
    const { data: auth } = await this.db.auth.admin.getUserById(u);
    const authUser = auth?.user;
    if (!authUser?.email || NORMALISE(authUser.email) !== NORMALISE(profile.email)) throw invalid('identity_mismatch');
    if (!sameSecret((authUser.app_metadata as Record<string, unknown> | undefined)?.activation_nonce, n)) throw invalid('superseded');
    if (profile.user_profiles_status === 'pending') throw fail(HttpStatus.FORBIDDEN, 'ACTIVATION_NOT_APPROVED', 'This account has not been approved');
    if (profile.user_profiles_status !== 'active') throw invalid('profile_not_active');
    const { data: collab } = await this.db.from('collaborators').select('id,collaborators_code,collaborators_name,collaborators_verified,collaborators_status').eq('id', c).maybeSingle();
    if (!collab?.collaborators_verified || collab.collaborators_status !== 'active') throw invalid('partner_not_active');
    if ((profile.login_count || 0) > 0) throw fail(HttpStatus.UNAUTHORIZED, 'ACTIVATION_LINK_USED', 'This activation link has already been used');
    return { profile, collab, authUser };
  }

  /** Single use: only the request that moves login_count from 0 to 1 wins; any concurrent redemption of the same link loses. */
  async consume(profileId: string): Promise<boolean> {
    const { data, error } = await this.db.from('user_profiles')
      .update({ login_count: 1, last_login_at: new Date().toISOString() })
      .eq('id', profileId).or('login_count.eq.0,login_count.is.null').select('id');
    if (error) throw fail(HttpStatus.INTERNAL_SERVER_ERROR, 'ACTIVATION_FAILED', 'Activation could not be completed');
    return (data || []).length === 1;
  }

  /** After a successful redemption the nonce is spent, so the link stays dead even if the login counter is ever reset. */
  async spendNonce(authUser: { id: string; app_metadata?: Record<string, unknown> }) {
    const { activation_nonce: _spent, ...rest } = authUser.app_metadata || {};
    await this.db.auth.admin.updateUserById(authUser.id, { app_metadata: { ...rest, activation_nonce: null } }).catch(() => undefined);
  }
}
