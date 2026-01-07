import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CreateMerchantDto, UpdateMerchantDto } from './merchants.dto';
import { UserProfilesService } from '../user-profiles/user-profiles.service';

@Injectable()
export class MerchantsService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => UserProfilesService))
    private readonly userProfilesService: UserProfilesService,
  ) {}

  private generateMerchantCode(): string {
    // Generate 8-character uppercase alphanumeric code (e.g., "MCH12AB3")
    return 'MCH' + randomBytes(4).toString('hex').toUpperCase().slice(0, 5);
  }

  async findAll() {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .select('*')
      .order('merchant_registered_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch merchants: ${error.message}`);
    }

    return data || [];
  }

  async findById(id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw new Error(`Failed to fetch merchant: ${error.message}`);
    }

    return data;
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

    return data || [];
  }

  async create(dto: CreateMerchantDto) {
    const merchantCode = this.generateMerchantCode();
    
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .insert({
        merchant_code: merchantCode,
        owner_email: dto.owner_email,
        owner_password: dto.owner_password,
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

    return data;
  }

  async update(id: string, dto: UpdateMerchantDto) {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .update(dto)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update merchant: ${error.message}`);
    }

    return data;
  }

  async delete(id: string) {
    const { error } = await this.supabase.getClient()
      .from('merchant_details')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete merchant: ${error.message}`);
    }

    return { success: true };
  }

  async approve(id: string) {
    console.log(`[MerchantsService] Approving merchant ${id}`);
    
    // Get merchant details
    const merchant = await this.findById(id);
    
    if (!merchant) {
      console.error(`[MerchantsService] Merchant not found: ${id}`);
      throw new Error('Merchant not found');
    }

    console.log(`[MerchantsService] Merchant data:`, {
      id: merchant.id,
      merchant_name: merchant.merchant_name,
      owner_email: merchant.owner_email,
      has_password: !!merchant.owner_password
    });

    // Validate required fields for user profile creation
    if (!merchant.owner_email) {
      console.error(`[MerchantsService] Missing owner_email for merchant ${id}`);
      throw new Error('Cannot approve merchant: owner_email is required');
    }
    if (!merchant.owner_password) {
      console.error(`[MerchantsService] Missing owner_password for merchant ${id}`);
      throw new Error('Cannot approve merchant: owner_password is required');
    }

    console.log(`[MerchantsService] Updating merchant status to active`);
    // Update merchant status
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .update({
        merchant_verified: true,
        merchants_status: 'active',
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error(`[MerchantsService] Failed to update merchant:`, error);
      throw new Error(`Failed to approve merchant: ${error.message}`);
    }

    console.log(`[MerchantsService] Merchant approved, creating user profile`);
    // Create user profile for login access (use owner_email as username)
    try {
      const userProfile = await this.userProfilesService.createOrUpdate({
        email: merchant.owner_email,
        role: 'merchant',
        merchant_id: id,
        collaborator_id: null,
        password: merchant.owner_password, // Use password from signup
      });
      console.log(`[MerchantsService] User profile created successfully`);
      return data;
    } catch (profileError) {
      // Log error but don't fail the approval
      console.error('[MerchantsService] Failed to create user profile:', profileError);
      throw new Error(`Merchant approved but failed to create user profile: ${profileError.message}`);
    }
  }

  async reject(id: string) {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .update({
        merchant_verified: false,
        merchants_status: 'blocked',
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to reject merchant: ${error.message}`);
    }

    return data;
  }
}
