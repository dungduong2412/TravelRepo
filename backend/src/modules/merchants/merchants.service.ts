import { BadRequestException, ForbiddenException, Injectable, Inject, forwardRef } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import {
  AdminCreateMerchantDto,
  AdminUpdateMerchantDto,
  CreateMerchantDto,
  CreateMerchantMemberDto,
  UpdateMerchantDto,
} from './merchants.dto';
import { UserProfilesService } from '../user-profiles/user-profiles.service';
import { AuditActor, AuditService } from '../audit/audit.service';

@Injectable()
export class MerchantsService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => UserProfilesService))
    private readonly userProfilesService: UserProfilesService,
    private readonly audit: AuditService,
  ) {}

  private generateMerchantCode(): string {
    // Generate 8-character uppercase alphanumeric code (e.g., "MCH12AB3")
    return 'MCH' + randomBytes(4).toString('hex').toUpperCase().slice(0, 5);
  }

  private withoutPassword<T extends Record<string, any>>(row: T) {
    if (!row) return row;
    const { owner_password: _password, ...safe } = row;
    return safe;
  }

  async findAll() {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .select('*')
      .order('merchant_registered_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch merchants: ${error.message}`);
    }

    return (data || []).map((row) => this.withoutPassword(row));
  }

  async findById(id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .select('*')
      .eq('merchant_system_id', id)
      .single();

    if (error) {
      throw new Error(`Failed to fetch merchant: ${error.message}`);
    }

    return this.withoutPassword(data);
  }

  async findByIdForActor(userId: string, id: string) {
    const { data: profile } = await this.supabase.getClient().from('user_profiles')
      .select('role,user_profiles_status,merchant_id').eq('user_id', userId).maybeSingle();
    if (!profile || profile.user_profiles_status !== 'active' ||
        (profile.role !== 'admin' && !(profile.role === 'merchant' && profile.merchant_id === id))) {
      throw new ForbiddenException('Merchant access denied');
    }
    return this.findById(id);
  }

  async findByEmail(email: string) {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .select('*')
      .eq('owner_email', email)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch merchant: ${error.message}`);
    }

    return data;
  }

  async findVerified() {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .select('*')
      .eq('merchant_verified', true)
      .order('merchant_registered_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch verified merchants: ${error.message}`);
    }

    return (data || []).map((row) => this.withoutPassword(row));
  }

  async create(dto: CreateMerchantDto) {
    await this.userProfilesService.assertIdentityAvailable(dto.owner_email);
    const merchantCode = this.generateMerchantCode();
    
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .insert({
        merchant_code: merchantCode,
        owner_email: dto.owner_email,
        owner_password: null,
        merchant_name: dto.merchant_name,
        merchant_description: dto.merchant_description,
        merchant_phone: dto.merchant_phone,
        merchant_email: dto.merchant_email,
        merchant_contact_phone: dto.merchant_contact_phone,
        new_address_city: dto.new_address_city,
        new_address_ward: dto.new_address_ward,
        new_address_line: dto.new_address_line,
        merchant_commission_type: dto.merchant_commission_type,
        merchant_commission_value: dto.merchant_commission_value,
        merchant_discount_type: dto.merchant_discount_type,
        merchant_discount_value: dto.merchant_discount_value,
        merchant_verified: false, // Default to false
        merchants_status: 'pending', // Default to pending
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create merchant: ${error.message}`);
    }

    try {
      await this.userProfilesService.createOrUpdate({
        email: dto.owner_email,
        role: 'merchant',
        merchant_id: data.merchant_system_id,
        collaborator_id: null,
        password: dto.owner_password,
        status: 'pending',
      });
    } catch (identityError) {
      await this.supabase.getClient().from('merchant_details')
        .delete().eq('merchant_system_id', data.merchant_system_id);
      throw identityError;
    }
    return this.withoutPassword(data);
  }

  async createByAdmin(actor: AuditActor, dto: AdminCreateMerchantDto) {
    const { data, error } = await this.supabase.getClient().from('merchant_details').insert({
      ...dto,
      merchant_code: this.generateMerchantCode(),
      owner_password: null,
      merchant_verified: false,
      merchants_status: 'pending',
    }).select().single();
    if (error) throw new BadRequestException(`Failed to create merchant: ${error.message}`);
    await this.audit.record(actor, 'merchant.created', 'merchant', data.merchant_system_id, {
      merchant_code: data.merchant_code,
      status: data.merchants_status,
    });
    return this.withoutPassword(data);
  }

  async update(id: string, dto: UpdateMerchantDto) {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .update(dto)
      .eq('merchant_system_id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update merchant: ${error.message}`);
    }

    return this.withoutPassword(data);
  }

  async updateForActor(userId: string, id: string, dto: UpdateMerchantDto) {
    const { data: profile } = await this.supabase.getClient().from('user_profiles')
      .select('role,user_profiles_status,merchant_id').eq('user_id', userId).maybeSingle();
    if (!profile || profile.user_profiles_status !== 'active' ||
        !(profile.role === 'merchant' && profile.merchant_id === id)) {
      throw new ForbiddenException('Merchant update access denied');
    }
    return this.update(id, dto);
  }

  async updateByAdmin(actor: AuditActor, id: string, dto: AdminUpdateMerchantDto) {
    const before = await this.findById(id);
    const updated = await this.update(id, dto);
    await this.audit.record(actor, 'merchant.updated', 'merchant', id, {
      changed_fields: Object.keys(dto),
      previous_status: before.merchants_status,
      status: updated.merchants_status,
    });
    return updated;
  }

  private async requireActiveMerchantProfile(userId: string) {
    const { data: profile, error } = await this.supabase.getClient().from('user_profiles')
      .select('id,role,user_profiles_status,merchant_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !profile || profile.role !== 'merchant' ||
        profile.user_profiles_status !== 'active' || !profile.merchant_id) {
      throw new ForbiddenException('Active merchant access required');
    }
    return profile;
  }

  async listMembers(userId: string) {
    const profile = await this.requireActiveMerchantProfile(userId);
    const { data, error } = await this.supabase.getClient().from('collaborators')
      .select('id,collaborators_name,collaborators_phone,collaborators_email,collaborators_avatar_url,collaborators_registered_date,collaborators_verified,collaborators_status')
      .eq('merchant_system_id', profile.merchant_id)
      .order('collaborators_registered_date', { ascending: false });
    if (error) throw new Error(`Failed to fetch merchant members: ${error.message}`);
    return data || [];
  }

  async createMember(userId: string, dto: CreateMerchantMemberDto) {
    const profile = await this.requireActiveMerchantProfile(userId);
    const client = this.supabase.getClient();
    await this.userProfilesService.assertIdentityAvailable(dto.collaborators_email);

    const { data, error } = await client.from('collaborators').insert({
      merchant_system_id: profile.merchant_id,
      collaborators_code: `COL${randomBytes(4).toString('hex').toUpperCase().slice(0, 7)}`,
      collaborators_name: dto.collaborators_name,
      collaborators_phone: dto.collaborators_phone,
      collaborators_email: dto.collaborators_email,
      collaborators_bank_name: dto.collaborators_bank_name,
      collaborators_bank_acc_number: dto.collaborators_bank_acc_number,
      collaborators_password: null,
      collaborators_registered_date: new Date().toISOString(),
      collaborators_verified: false,
      collaborators_status: 'pending',
    }).select().single();
    if (error) throw new BadRequestException(`Failed to create member: ${error.message}`);

    try {
      await this.userProfilesService.createOrUpdate({
        email: dto.collaborators_email,
        role: 'collaborator',
        merchant_id: null,
        collaborator_id: data.id,
        password: dto.collaborators_password,
        status: 'pending',
      });
    } catch (error) {
      await client.from('collaborators').delete().eq('id', data.id);
      throw error;
    }
    return data;
  }

  async deactivate(actor: AuditActor, id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .update({ merchant_verified: false, merchants_status: 'inactive' })
      .eq('merchant_system_id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to deactivate merchant: ${error.message}`);
    }
    await this.supabase.getClient().from('user_profiles')
      .update({ user_profiles_status: 'inactive' })
      .eq('merchant_id', id)
      .eq('role', 'merchant');
    await this.audit.record(actor, 'merchant.deactivated', 'merchant', id);
    return this.withoutPassword(data);
  }

  async approve(actor: AuditActor, id: string) {
    // Get merchant details
    const merchant = await this.findById(id);
    
    if (!merchant) {
      console.error(`[MerchantsService] Merchant not found: ${id}`);
      throw new Error('Merchant not found');
    }

    // Validate required fields for user profile creation
    if (!merchant.owner_email) {
      console.error(`[MerchantsService] Missing owner_email for merchant ${id}`);
      throw new Error('Cannot approve merchant: owner_email is required');
    }

    // Update merchant status
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .update({
        merchant_verified: true,
        merchants_status: 'active',
      })
      .eq('merchant_system_id', id)
      .select()
      .single();

    if (error) {
      console.error(`[MerchantsService] Failed to update merchant:`, error);
      throw new Error(`Failed to approve merchant: ${error.message}`);
    }

    // Create user profile for login access (use owner_email as username)
    try {
      await this.userProfilesService.createOrUpdate({
        email: merchant.owner_email,
        role: 'merchant',
        merchant_id: merchant.merchant_system_id,
        collaborator_id: null,
        status: 'active',
      });
      await this.audit.record(actor, 'merchant.approved', 'merchant', id);
      return this.withoutPassword(data);
    } catch (profileError) {
      console.error('[MerchantsService] Failed to create user profile:', profileError);
      await this.supabase.getClient().from('merchant_details').update({
        merchant_verified: merchant.merchant_verified,
        merchants_status: merchant.merchants_status,
      }).eq('merchant_system_id', id);
      throw new Error(`Merchant approved but failed to create user profile: ${profileError.message}`);
    }
  }

  async reject(actor: AuditActor, id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .update({
        merchant_verified: false,
        merchants_status: 'blocked',
      })
      .eq('merchant_system_id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to reject merchant: ${error.message}`);
    }

    await this.supabase.getClient().from('user_profiles')
      .update({ user_profiles_status: 'blocked' })
      .eq('merchant_id', id)
      .eq('role', 'merchant');
    await this.audit.record(actor, 'merchant.rejected', 'merchant', id);
    return this.withoutPassword(data);
  }
}
