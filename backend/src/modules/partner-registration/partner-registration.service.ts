import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { SlidingWindowLimiter } from '../../common/http/rate-limiter';
import { PartnerRegistrationDto, RegistrationResult, normalisePhone } from './partner-registration.dto';

const err = (status: HttpStatus, code: string, message: string) => new HttpException({ code, message }, status);
const PENDING_CAP_PER_HOUR = () => Math.max(1, Number(process.env.PARTNER_REGISTRATION_HOURLY_CAP) || 60);

type ExistingState = 'pending' | 'active' | 'support';

/** Exact, case-insensitive match for ilike: "_" and "%" are LIKE wildcards and must not widen an e-mail lookup. */
const likeExact = (value: string) => value.replace(/[\\%_]/g, '\\$&');

/**
 * Partner registration: ONE call creates the whole application, with no e-mail confirmation first and no second form.
 *
 *   Auth identity (unconfirmed, NO password)  +  collaborators row (pending)  +  linked user_profiles row (pending)
 *
 * Why there is no password: the identity is created before anybody has proven they own the mailbox. A password chosen at that point would let
 * a stranger who typed somebody else's address log in as that person once the Partner is approved. Instead, approval e-mails a single-use
 * link to the mailbox (ActivationService); opening it is the proof of ownership and signs the person in. A password can be set afterwards.
 *
 * All-or-nothing: Supabase's client has no multi-table transaction, so each step is undone if a later one fails (and the final state is
 * re-checked), and the unique index on user_profiles(email) arbitrates concurrent submissions of the same address.
 *
 * An address that is already known never creates anything: it gets a coarse state back. That answer is the only thing this endpoint reveals,
 * and it is rate limited per address and per client, capped per hour overall, and guarded by a honeypot field.
 */
@Injectable()
export class PartnerRegistrationService {
  private readonly log = new Logger('PartnerRegistration');
  private readonly byIp = new SlidingWindowLimiter(10, 10 * 60_000);
  private readonly byEmail = new SlidingWindowLimiter(3, 10 * 60_000);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
  ) {}

  private get db() { return this.supabase.getClient(); }

  /** Existing registration for this address, from the Partner/profile tables. Null = unknown address. Case-insensitive, like the unique index. */
  private async existingState(email: string): Promise<ExistingState | null> {
    const unavailable = () => err(HttpStatus.SERVICE_UNAVAILABLE, 'REGISTRATION_UNAVAILABLE', 'Registration is temporarily unavailable');
    const exact = likeExact(email);
    const { data: profile, error } = await this.db.from('user_profiles').select('user_profiles_status').ilike('email', exact).limit(1).maybeSingle();
    if (error) throw unavailable();
    if (profile) {
      if (profile.user_profiles_status === 'pending') return 'pending';
      if (profile.user_profiles_status === 'active') return 'active';
      return 'support'; // rejected / suspended / inactive
    }
    // A record nobody can sign in to (Admin-created, V1-imported), a Merchant that owns this address, or an invitation still waiting to be claimed:
    // none of them may be turned into a second identity here. Only an Admin can sort those out.
    const checks = await Promise.all([
      this.db.from('collaborators').select('id').ilike('collaborators_email', exact).limit(1),
      this.db.from('merchant_details').select('merchant_system_id').ilike('owner_email', exact).limit(1),
      this.db.from('invitations').select('id').ilike('owner_email', exact).eq('status', 'pending').limit(1),
    ]);
    if (checks.some((c) => c.error)) throw unavailable();
    return checks.some((c) => (c.data || []).length) ? 'support' : null;
  }

  private async findAuthUser(email: string) {
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await this.db.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw err(HttpStatus.SERVICE_UNAVAILABLE, 'REGISTRATION_UNAVAILABLE', 'Registration is temporarily unavailable');
      const hit = (data.users as any[]).find((u) => (u.email || '').trim().toLowerCase() === email);
      if (hit) return hit;
      if (data.users.length < 1000) return null;
    }
    return null;
  }

  async register(dto: PartnerRegistrationDto, ip: string): Promise<RegistrationResult> {
    const email = dto.email;
    if (dto.website && dto.website.trim()) {
      // Honeypot: look successful, create nothing, spend nothing.
      this.log.warn('honeypot field filled; registration ignored');
      return { outcome: 'created', status: 'pending', reference: `COL-${randomBytes(8).toString('hex').toUpperCase()}` };
    }
    if (!this.byIp.take(ip) || !this.byEmail.take(email)) throw err(HttpStatus.TOO_MANY_REQUESTS, 'REGISTRATION_RATE_LIMITED', 'Too many attempts; try again later');

    const known = await this.existingState(email);
    if (known) return { outcome: 'exists', state: known };

    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await this.db.from('audit_events').select('id', { count: 'exact', head: true }).eq('action', 'collaborator.application_submitted').gte('occurred_at', since);
    if ((count || 0) >= PENDING_CAP_PER_HOUR()) throw err(HttpStatus.SERVICE_UNAVAILABLE, 'REGISTRATION_BUSY', 'Registration is busy; try again later');

    // --- identity -------------------------------------------------------------------------------------------------------------------------------
    let userId: string; let createdAuth = false; let adoptedMetadata: Record<string, unknown> | null = null;
    const created = await this.db.auth.admin.createUser({
      email, email_confirm: false,
      user_metadata: { requested_role: 'collaborator' },
      app_metadata: { role: 'collaborator', account_status: 'pending', activation_password_reset: true },
    });
    if (created.error) {
      if ((created.error as { code?: string }).code !== 'email_exists') throw err(HttpStatus.BAD_GATEWAY, 'REGISTRATION_FAILED', 'Registration could not be completed');
      // The address already has an Auth identity but no Partner/profile (e.g. an earlier two-step signup that was never finished).
      const existing = await this.findAuthUser(email);
      if (!existing) throw err(HttpStatus.SERVICE_UNAVAILABLE, 'REGISTRATION_UNAVAILABLE', 'Registration is temporarily unavailable');
      if (existing.user_metadata?.requested_role && existing.user_metadata.requested_role !== 'collaborator') return { outcome: 'exists', state: 'support' };
      userId = existing.id; adoptedMetadata = existing.app_metadata || {};
      if (!existing.email_confirmed_at) {
        adoptedMetadata = { ...adoptedMetadata, activation_password_reset: true };   // also untrusted until the activation click, even if it is signed up again
        // Nobody has proven they own this mailbox, so a password somebody set earlier must stop working before this identity can be approved.
        const { error: resetError } = await this.db.auth.admin.updateUserById(userId, { password: randomBytes(24).toString('base64url') });
        if (resetError) throw err(HttpStatus.BAD_GATEWAY, 'REGISTRATION_FAILED', 'Registration could not be completed');
      }
    } else {
      userId = created.data.user.id; createdAuth = true;
    }

    // --- Partner record + linked profile, undone together on any failure --------------------------------------------------------------------------
    let collaboratorId: string | null = null; let profileCreated = false;
    const undo = async () => {
      if (profileCreated) await this.db.from('user_profiles').delete().eq('user_id', userId).eq('collaborator_id', collaboratorId as string);
      if (collaboratorId) await this.db.from('collaborators').delete().eq('id', collaboratorId);
      if (createdAuth) await this.db.auth.admin.deleteUser(userId);
    };
    try {
      const { data: row, error: insertError } = await this.db.from('collaborators').insert({
        collaborators_name: dto.full_name.trim(), collaborators_phone: normalisePhone(dto.phone), collaborators_email: email,
        collaborators_password: null, collaborators_code: `COL-${randomBytes(8).toString('hex').toUpperCase()}`,
        collaborators_verified: false, collaborators_status: 'pending', collaborators_registered_date: new Date().toISOString(),
      }).select('id,collaborators_code').single();
      if (insertError || !row) throw new Error(`partner_insert_failed:${insertError?.code || 'unknown'}`);
      collaboratorId = row.id;

      // Inserted directly (never "create or update"): if another request registered this address first, the unique index on user_profiles(email)
      // rejects this insert and nothing of theirs is touched.
      const { error: profileError } = await this.db.from('user_profiles').insert({
        user_id: userId, email, role: 'collaborator', merchant_id: null, collaborator_id: row.id, login_count: 0,
        user_profiles_status: 'pending', full_name: dto.full_name.trim(),
      });
      if (profileError) throw new Error(`profile_insert_failed:${profileError.code || 'unknown'}`);
      profileCreated = true;
      if (adoptedMetadata) {
        const { error: metaError } = await this.db.auth.admin.updateUserById(userId, { app_metadata: { ...adoptedMetadata, role: 'collaborator', account_status: 'pending' } });
        if (metaError) throw new Error('auth_metadata_failed');
      }
      await this.audit.record({ id: userId, role: 'collaborator' }, 'collaborator.application_submitted', 'collaborator', row.id, {
        channel: 'public_registration', email_verified: false, identity: createdAuth ? 'created' : 'adopted',
      });
      return { outcome: 'created', status: 'pending', reference: row.collaborators_code };
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'unknown';
      await undo().catch((undoError) => this.log.error(`registration rollback incomplete: ${undoError instanceof Error ? undoError.message : 'unknown'}`));
      // Somebody else registered this address a moment ago: report what now exists instead of an error.
      const nowKnown = await this.existingState(email).catch(() => null);
      if (nowKnown) return { outcome: 'exists', state: nowKnown };
      this.log.error(`registration failed and was rolled back: ${message}`);
      throw err(HttpStatus.INTERNAL_SERVER_ERROR, 'REGISTRATION_FAILED', 'Registration could not be completed; nothing was created');
    }
  }
}
