import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { ActivationService, UNVERIFIED_IDENTITY_FLAG } from '../activation/activation.service';

type AppRole = 'merchant' | 'collaborator' | 'admin';

@Injectable()
export class AuthService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly activation: ActivationService,
    private readonly audit: AuditService,
  ) {}

  private getAuthClient() {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error('Supabase public Auth configuration is missing');
    return createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async loginAuto(email: string, password: string, requestedRole?: AppRole) {
    // Supabase Auth is the only password verifier. Legacy/domain password hashes
    // and failed-login password synchronization are deliberately unsupported.
    const { data: session, error: authError } = await this.getAuthClient().auth
      .signInWithPassword({ email, password });
    if (authError || !session.user || !session.session) {
      throw new UnauthorizedException('Invalid email or password');
    }
    // Created before the mailbox was proven (public Partner registration): the only way in is the emailed activation link.
    if ((session.user.app_metadata as Record<string, unknown> | undefined)?.[UNVERIFIED_IDENTITY_FLAG] === true) {
      throw new UnauthorizedException('Account requires the activation link');
    }

    const { data: profile, error: profileError } = await this.supabase.getClient()
      .from('user_profiles')
      .select('id,user_id,email,role,full_name,user_profiles_status,merchant_id,collaborator_id,login_count')
      .eq('user_id', session.user.id)
      .maybeSingle();
    // A freshly onboarded owner is 'pending' until Admin approval: say so instead of implying the account is suspended.
    if (!profileError && profile?.user_profiles_status === 'pending') {
      throw new UnauthorizedException('Account is not approved');
    }
    if (profileError || !profile || profile.user_profiles_status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }
    if (requestedRole && profile.role !== requestedRole) {
      throw new UnauthorizedException('Account role does not match');
    }

    let entity: Record<string, unknown> | null = null;
    if (profile.role === 'merchant') {
      const { data } = await this.supabase.getClient().from('merchant_details')
        .select('merchant_system_id,merchant_code,merchant_name,merchant_verified,merchants_status')
        .eq('merchant_system_id', profile.merchant_id).maybeSingle();
      if (!data?.merchant_verified || data.merchants_status === 'blocked') {
        throw new UnauthorizedException('Merchant account is not approved');
      }
      entity = data;
    } else if (profile.role === 'collaborator') {
      const { data } = await this.supabase.getClient().from('collaborators')
        .select('id,collaborators_code,collaborators_name,collaborators_verified,collaborators_status')
        .eq('id', profile.collaborator_id).maybeSingle();
      if (!data?.collaborators_verified || data.collaborators_status === 'blocked') {
        throw new UnauthorizedException('Collaborator account is not approved');
      }
      entity = data;
    } else if (profile.role !== 'admin') {
      throw new UnauthorizedException('Unsupported account role');
    }

    await this.supabase.getClient().from('user_profiles').update({
      login_count: (profile.login_count || 0) + 1,
      last_login_at: new Date().toISOString(),
    }).eq('id', profile.id);

    return {
      user: {
        id: profile.user_id,
        email: profile.email,
        role: profile.role,
        name: profile.full_name,
        merchant_id: profile.merchant_id,
        collaborator_id: profile.collaborator_id,
      },
      entity,
      // Keep the established frontend contract while exposing the generic
      // entity field for newer consumers.
      merchant: profile.role === 'merchant' ? entity : null,
      collaborator: profile.role === 'collaborator' ? entity : null,
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
    };
  }

  /**
   * Partner activation: the person clicked the link in the "your account is approved" e-mail. No password, no second form.
   *  1. ActivationService.verify    — signed, unexpired, account-bound, current (not used or superseded), approved
   *  2. settleCredentials           — the click is the first proof of mailbox ownership: any password set before it is replaced
   *  3. a one-time Auth session is minted server-side for exactly that account (this also confirms the e-mail address)
   *  4. ActivationService.consume   — compare-and-set on login_count; a concurrent redemption loses and ONLY its own session is revoked
   * Redemptions for one account run one at a time. The answer has the same shape as /auth/login, so the web app establishes the session the same way.
   */
  async activate(token: unknown, ip: string) {
    const uid = this.activation.peekUserId(token);
    return uid ? this.activation.locked(`redeem:${uid}`, () => this.activateNow(token, ip)) : this.activateNow(token, ip); // unsigned tokens fail inside verify()
  }

  private async activateNow(token: unknown, ip: string) {
    const { profile, collab, authUser } = await this.activation.verify(token, ip);
    const failed = () => new HttpException({ code: 'ACTIVATION_FAILED', message: 'Activation could not be completed; request a new link' }, HttpStatus.BAD_GATEWAY);

    await this.activation.settleCredentials(profile.user_id);
    const { data: link, error: linkError } = await this.supabase.getClient().auth.admin.generateLink({ type: 'magiclink', email: authUser.email as string });
    const hashed = link?.properties?.hashed_token;
    if (linkError || !hashed) throw failed();
    const { data: opened, error: otpError } = await this.getAuthClient().auth.verifyOtp({
      token_hash: hashed, type: link?.properties?.verification_type === 'signup' ? 'signup' : 'magiclink',
    });
    if (otpError || !opened.session || opened.user?.id !== profile.user_id) throw failed();

    if (!(await this.activation.consume(profile.id, profile.login_count))) {
      // Lost a race: revoke only the session minted for THIS request (a global sign-out would also kill the winner's session).
      await this.supabase.getClient().auth.admin.signOut(opened.session.access_token, 'local').catch(() => undefined);
      throw new HttpException({ code: 'ACTIVATION_LINK_USED', message: 'This activation link has already been used' }, HttpStatus.UNAUTHORIZED);
    }
    await this.activation.spendNonce(profile.user_id);
    await this.audit.record({ id: profile.user_id, role: 'collaborator' }, 'collaborator.activated', 'collaborator', collab.id, { method: 'activation_link' })
      .catch(() => undefined); // the activation already happened; a missing audit row must not strand the person outside the portal

    const entity = { id: collab.id, collaborators_code: collab.collaborators_code, collaborators_name: collab.collaborators_name, collaborators_verified: collab.collaborators_verified, collaborators_status: collab.collaborators_status };
    return {
      user: { id: profile.user_id, email: profile.email, role: profile.role, name: profile.full_name, merchant_id: profile.merchant_id, collaborator_id: profile.collaborator_id },
      entity, merchant: null, collaborator: entity,
      access_token: opened.session.access_token, refresh_token: opened.session.refresh_token, activated: true,
    };
  }

  login(email: string, password: string, role: AppRole) {
    return this.loginAuto(email, password, role);
  }
}
