import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CreateMerchantDto, UpdateMerchantDto } from './merchants.dto';

@Injectable()
export class MerchantsService {
  constructor(private readonly supabase: SupabaseService) {}

  async findAll() {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .select('*')
      .order('created_at', { ascending: false });

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
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch verified merchants: ${error.message}`);
    }

    return data || [];
  }

  async create(dto: CreateMerchantDto) {
    const { data, error } = await this.supabase.getClient()
      .from('merchant_details')
      .insert({
        owner_email: dto.owner_email,
        owner_password: dto.owner_password,
        business_name: dto.business_name,
        business_address: dto.business_address,
        business_phone: dto.business_phone,
        business_email: dto.business_email,
        business_description: dto.business_description,
        commission_rate: dto.commission_rate,
        customer_discount_rate: dto.customer_discount_rate,
        merchant_verified: false, // Default to false
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
}
