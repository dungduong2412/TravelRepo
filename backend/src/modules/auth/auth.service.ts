import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { createClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(private readonly supabase: SupabaseService) {}
  
  // Create a fresh Supabase client for authentication to avoid any cached/scoped issues
  private getAuthClient() {
    return createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }

  async login(email: string, password: string, userType: 'merchant' | 'collaborator') {
    if (userType === 'collaborator') {
      return this.loginCollaborator(email, password);
    } else if (userType === 'merchant') {
      return this.loginMerchant(email, password);
    }
    throw new UnauthorizedException('Invalid user type');
  }

  private async loginCollaborator(email: string, password: string) {
    // Use fresh client to avoid any scope/cache issues
    const authClient = this.getAuthClient();
    
    // STEP 1: Find user_profile by email
    const { data: profile, error: profileError } = await authClient
      .from('user_profiles')
      .select('*')
      .eq('email', email)
      .eq('role', 'collaborator')
      .single();
    
    if (profileError || !profile) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // STEP 2: Check if collaborator_id exists
    if (!profile.collaborator_id) {
      throw new UnauthorizedException('Collaborator profile not found. Please contact admin.');
    }

    // STEP 3: Get collaborator details
    const { data: collaborator, error: collabError } = await authClient
      .from('collaborators')
      .select('*')
      .eq('id', profile.collaborator_id)
      .maybeSingle();

    if (collabError || !collaborator) {
      throw new UnauthorizedException('Collaborator details not found. Please contact admin.');
    }

    // STEP 4: Check if verified
    if (!collaborator.collaborators_verified) {
      throw new UnauthorizedException('Account not verified yet. Please wait for admin approval.');
    }

    // STEP 5: Verify password
    if (!collaborator.collaborators_password) {
      throw new UnauthorizedException('Password not set for this account');
    }

    const isValidPassword = await bcrypt.compare(password, collaborator.collaborators_password);
    
    if (!isValidPassword) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // STEP 6: Try to sign in with Supabase using the auth user
    let session = await authClient.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (session.error) {
      // If Supabase auth fails, try to sync the password
      try {
        // Update Supabase auth user password to match the one user registered with
        await authClient.auth.admin.updateUserById(profile.user_id, {
          password: password,
        });
        
        // Retry sign in
        session = await authClient.auth.signInWithPassword({
          email: email,
          password: password,
        });
        
        if (session.error) {
          throw new Error(session.error.message);
        }
      } catch (syncError: any) {
        throw new UnauthorizedException('Login failed. Please contact support.');
      }
    }

    return {
      user: {
        id: profile.user_id,
        email: profile.email,
        role: 'collaborator',
        collaborator_id: collaborator.id,
        name: collaborator.collaborators_name,
      },
      collaborator: {
        id: collaborator.id,
        code: collaborator.collaborators_code,
        name: collaborator.collaborators_name,
        verified: collaborator.collaborators_verified,
      },
      access_token: session.data.session?.access_token,
      refresh_token: session.data.session?.refresh_token,
    };
  }

  private async loginMerchant(email: string, password: string) {
    // STEP 1: Find user_profile by email
    const { data: profile, error: profileError } = await this.supabase.getClient()
      .from('user_profiles')
      .select('*')
      .eq('email', email)
      .eq('role', 'merchant')
      .single();

    if (profileError || !profile) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // STEP 2: Check if merchant_id exists
    if (!profile.merchant_id) {
      throw new UnauthorizedException('Merchant profile not found. Please contact admin.');
    }

    // STEP 3: Get merchant details
    const { data: merchant, error: merchantError } = await this.supabase.getClient()
      .from('merchant_details')
      .select('*')
      .eq('id', profile.merchant_id)
      .maybeSingle();

    if (merchantError || !merchant) {
      throw new UnauthorizedException('Merchant details not found. Please contact admin.');
    }

    // STEP 4: Check if verified
    if (!merchant.merchant_verified) {
      throw new UnauthorizedException('Account not verified yet. Please wait for admin approval.');
    }

    // STEP 5: Verify password
    if (!merchant.owner_password) {
      throw new UnauthorizedException('Password not set for this account');
    }

    const isValidPassword = await bcrypt.compare(password, merchant.owner_password);
    if (!isValidPassword) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // STEP 6: Try to sign in with Supabase using the auth user
    let session = await this.supabase.getClient().auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (session.error) {
      // If Supabase auth fails, try to sync the password
      console.log('Supabase auth failed, attempting to sync password:', session.error.message);
      
      try {
        // Update Supabase auth user password to match the one user registered with
        await this.supabase.getClient().auth.admin.updateUserById(profile.user_id, {
          password: password,
        });
        
        console.log('Password synced successfully, retrying login');
        
        // Retry sign in
        session = await this.supabase.getClient().auth.signInWithPassword({
          email: email,
          password: password,
        });
        
        if (session.error) {
          throw new Error(session.error.message);
        }
      } catch (syncError: any) {
        console.error('Failed to sync password:', syncError);
        throw new UnauthorizedException('Login failed. Please contact support.');
      }
    }

    return {
      user: {
        id: profile.user_id,
        email: profile.email,
        role: 'merchant',
        merchant_id: merchant.id,
        name: merchant.merchant_name,
      },
      merchant: {
        id: merchant.id,
        code: merchant.merchant_code,
        name: merchant.merchant_name,
        verified: merchant.merchant_verified,
      },
      access_token: session.data.session?.access_token,
      refresh_token: session.data.session?.refresh_token,
    };
  }
}
