import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

type AppRole = 'merchant' | 'collaborator' | 'admin';

@Injectable()
export class AuthService {
  constructor(private readonly supabase: SupabaseService) {}

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

    const { data: profile, error: profileError } = await this.supabase.getClient()
      .from('user_profiles')
      .select('id,user_id,email,role,full_name,user_profiles_status,merchant_id,collaborator_id,login_count')
      .eq('user_id', session.user.id)
      .maybeSingle();
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

  login(email: string, password: string, role: AppRole) {
    return this.loginAuto(email, password, role);
  }
}
