import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CreateUserProfileDto } from './user-profiles.dto';

@Injectable()
export class UserProfilesService {
  constructor(private readonly supabase: SupabaseService) {}

  async findAll() {
    const { data, error } = await this.supabase.getClient()
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch user profiles: ${error.message}`);
    }

    return data || [];
  }

  async findByEmail(email: string) {
    const { data, error } = await this.supabase.getClient()
      .from('user_profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch user profile: ${error.message}`);
    }

    return data;
  }

  async findById(id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('user_profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw new Error(`Failed to fetch user profile: ${error.message}`);
    }

    return data;
  }

  async createOrUpdate(dto: CreateUserProfileDto & { user_id?: string; password?: string }) {
    // Check if profile exists
    const existing = await this.findByEmail(dto.email);

    if (existing) {
      // Update existing profile
      const { data, error } = await this.supabase.getClient()
        .from('user_profiles')
        .update({
          role: dto.role,
          merchant_id: dto.merchant_id,
          collaborator_id: dto.collaborator_id,
        })
        .eq('email', dto.email)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update user profile: ${error.message}`);
      }

      return data;
    } else {
      // Get or create auth user
      let userId = dto.user_id;
      
      if (!userId) {
        // Check if auth user exists
        const { data: authUsers } = await this.supabase.getClient().auth.admin.listUsers();
        const existingAuthUser = (authUsers?.users as any[])?.find((u: any) => u.email === dto.email);
        
        if (existingAuthUser) {
          userId = existingAuthUser.id;
        } else {
          // Create auth user
          const password = dto.password || `Temp${Math.random().toString(36).slice(2)}!`;
          const { data: newAuthUser, error: authError } = await this.supabase.getClient().auth.admin.createUser({
            email: dto.email,
            password: password,
            email_confirm: true,
          });
          
          if (authError || !newAuthUser.user) {
            throw new Error(`Failed to create auth user: ${authError?.message || 'Unknown error'}`);
          }
          
          userId = newAuthUser.user.id;
        }
      }

      // Create new profile
      const { data, error } = await this.supabase.getClient()
        .from('user_profiles')
        .insert({
          user_id: userId,
          email: dto.email,
          role: dto.role,
          merchant_id: dto.merchant_id,
          collaborator_id: dto.collaborator_id,
          login_count: 0,
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create user profile: ${error.message}`);
      }

      return data;
    }
  }

  async trackLogin(email: string) {
    const profile = await this.findByEmail(email);
    
    if (!profile) {
      return null;
    }

    const { data, error } = await this.supabase.getClient()
      .from('user_profiles')
      .update({
        last_login_at: new Date().toISOString(),
        login_count: (profile.login_count || 0) + 1,
      })
      .eq('email', email)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to track login: ${error.message}`);
    }

    return data;
  }

  async backfillFromApprovedMerchantsAndCollaborators() {
    const results = {
      merchants: { created: 0, skipped: 0, errors: [] as string[] },
      collaborators: { created: 0, skipped: 0, errors: [] as string[] },
    };

    // Backfill approved merchants
    const { data: merchants, error: merchantError } = await this.supabase.getClient()
      .from('merchant_details')
      .select('merchant_system_id, owner_email, owner_password, merchant_verified')
      .eq('merchant_verified', true);

    if (merchantError) {
      results.merchants.errors.push(`Failed to fetch merchants: ${merchantError.message}`);
    } else if (merchants) {
      for (const merchant of merchants) {
        if (!merchant.owner_email) {
          results.merchants.skipped++;
          continue;
        }

        try {
          const existing = await this.findByEmail(merchant.owner_email);
          if (existing) {
            results.merchants.skipped++;
            console.log(`Merchant user profile already exists: ${merchant.owner_email}`);
          } else {
            // Check if auth user exists
            const { data: authUser } = await this.supabase.getClient().auth.admin.listUsers();
            const existingAuthUser = (authUser?.users as any[])?.find((u: any) => u.email === merchant.owner_email);
            
            let userId: string;
            if (existingAuthUser) {
              userId = existingAuthUser.id;
              console.log(`Auth user already exists for ${merchant.owner_email}`);
            } else {
              // Create auth user with their password (if available) or temporary password
              const password = merchant.owner_password || `Temp${Math.random().toString(36).slice(2)}!`;
              const { data: newAuthUser, error: authError } = await this.supabase.getClient().auth.admin.createUser({
                email: merchant.owner_email,
                password: password,
                email_confirm: true, // Auto-confirm email
              });
              
              if (authError || !newAuthUser.user) {
                throw new Error(`Failed to create auth user: ${authError?.message || 'Unknown error'}`);
              }
              
              userId = newAuthUser.user.id;
              console.log(`Created auth user for ${merchant.owner_email}`);
            }

            // Create user profile
            const { error: profileError } = await this.supabase.getClient()
              .from('user_profiles')
              .insert({
                user_id: userId,
                email: merchant.owner_email,
                role: 'merchant',
                merchant_id: merchant.merchant_system_id,
                collaborator_id: null,
                login_count: 0,
              });

            if (profileError) {
              throw new Error(`Failed to create user profile: ${profileError.message}`);
            }

            results.merchants.created++;
            console.log(`Created user profile for merchant: ${merchant.owner_email}`);
          }
        } catch (err: any) {
          results.merchants.errors.push(`${merchant.owner_email}: ${err.message}`);
        }
      }
    }

    // Backfill approved collaborators
    const { data: collaborators, error: collaboratorError } = await this.supabase.getClient()
      .from('collaborators')
      .select('id, collaborators_email, collaborators_password, collaborators_verified')
      .eq('collaborators_verified', true);

    if (collaboratorError) {
      results.collaborators.errors.push(`Failed to fetch collaborators: ${collaboratorError.message}`);
    } else if (collaborators) {
      for (const collaborator of collaborators) {
        if (!collaborator.collaborators_email) {
          results.collaborators.skipped++;
          continue;
        }

        try {
          const existing = await this.findByEmail(collaborator.collaborators_email);
          if (existing) {
            results.collaborators.skipped++;
            console.log(`Collaborator user profile already exists: ${collaborator.collaborators_email}`);
          } else {
            // Check if auth user exists
            const { data: authUser } = await this.supabase.getClient().auth.admin.listUsers();
            const existingAuthUser = (authUser?.users as any[])?.find((u: any) => u.email === collaborator.collaborators_email);
            
            let userId: string;
            if (existingAuthUser) {
              userId = existingAuthUser.id;
              console.log(`Auth user already exists for ${collaborator.collaborators_email}`);
            } else {
              // Create auth user with their password (if available) or temporary password
              const password = collaborator.collaborators_password || `Temp${Math.random().toString(36).slice(2)}!`;
              const { data: newAuthUser, error: authError } = await this.supabase.getClient().auth.admin.createUser({
                email: collaborator.collaborators_email,
                password: password,
                email_confirm: true, // Auto-confirm email
              });
              
              if (authError || !newAuthUser.user) {
                throw new Error(`Failed to create auth user: ${authError?.message || 'Unknown error'}`);
              }
              
              userId = newAuthUser.user.id;
              console.log(`Created auth user for ${collaborator.collaborators_email}`);
            }

            // Create user profile
            const { error: profileError } = await this.supabase.getClient()
              .from('user_profiles')
              .insert({
                user_id: userId,
                email: collaborator.collaborators_email,
                role: 'collaborator',
                merchant_id: null,
                collaborator_id: collaborator.id,
                login_count: 0,
              });

            if (profileError) {
              throw new Error(`Failed to create user profile: ${profileError.message}`);
            }

            results.collaborators.created++;
            console.log(`Created user profile for collaborator: ${collaborator.collaborators_email}`);
          }
        } catch (err: any) {
          results.collaborators.errors.push(`${collaborator.collaborators_email}: ${err.message}`);
        }
      }
    }

    return results;
  }
}
