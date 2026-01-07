import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CreateOrganizationProfileDto, UpdateOrganizationProfileDto } from './organization-profile.dto';

@Injectable()
export class OrganizationProfileService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Get the organization profile (should only be one record)
   */
  async get() {
    const { data, error } = await this.supabase.getClient()
      .from('organization_profile')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch organization profile: ${error.message}`);
    }

    return data;
  }

  /**
   * Create organization profile (should only be called once)
   */
  async create(dto: CreateOrganizationProfileDto) {
    // Check if profile already exists
    const existing = await this.get();
    if (existing) {
      throw new Error('Organization profile already exists. Use update instead.');
    }

    const { data, error } = await this.supabase.getClient()
      .from('organization_profile')
      .insert(dto)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create organization profile: ${error.message}`);
    }

    return data;
  }

  /**
   * Update organization profile
   */
  async update(dto: UpdateOrganizationProfileDto) {
    // Get existing profile
    const existing = await this.get();
    
    if (!existing) {
      throw new Error('Organization profile does not exist. Create one first.');
    }

    const { data, error } = await this.supabase.getClient()
      .from('organization_profile')
      .update(dto)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update organization profile: ${error.message}`);
    }

    return data;
  }

  /**
   * Create or update organization profile (upsert)
   */
  async createOrUpdate(dto: CreateOrganizationProfileDto | UpdateOrganizationProfileDto) {
    const existing = await this.get();
    
    if (existing) {
      return this.update(dto);
    } else {
      return this.create(dto as CreateOrganizationProfileDto);
    }
  }

  /**
   * Delete organization profile (admin only - use with caution)
   */
  async delete() {
    const existing = await this.get();
    
    if (!existing) {
      throw new Error('Organization profile does not exist.');
    }

    const { error } = await this.supabase.getClient()
      .from('organization_profile')
      .delete()
      .eq('id', existing.id);

    if (error) {
      throw new Error(`Failed to delete organization profile: ${error.message}`);
    }

    return { success: true };
  }
}
