import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

const COLUMNS = [
  'id', 'legacy_transaction_id', 'merchant_id', 'collaborator_id',
  'legacy_restaurant_id', 'legacy_middleman_id', 'legacy_status', 'lifecycle_status',
  'payment_status', 'document_number', 'document_date_utc',
  'document_total', 'document_discount_amount', 'commission_percent',
  'commission_amount', 'currency_code', 'created_at',
].join(',');

@Injectable()
export class TransactionsService {
  constructor(private readonly supabase: SupabaseService) {}

  private async profile(userId: string) {
    const { data, error } = await this.supabase.getClient().from('user_profiles')
      .select('role, user_profiles_status, merchant_id, collaborator_id')
      .eq('user_id', userId).maybeSingle();
    if (error || !data || data.user_profiles_status !== 'active') {
      throw new ForbiddenException('Active profile required');
    }
    return data;
  }

  async findForActor(userId: string) {
    const profile = await this.profile(userId);
    let query = this.supabase.getClient().from('referral_transactions').select(COLUMNS)
      .order('document_date_utc', { ascending: false });
    if (profile.role === 'merchant' && profile.merchant_id) query = query.eq('merchant_id', profile.merchant_id);
    else if (profile.role === 'collaborator' && profile.collaborator_id) query = query.eq('collaborator_id', profile.collaborator_id);
    else if (profile.role !== 'admin') throw new ForbiddenException('Transaction access is not assigned');
    const { data, error } = await query;
    if (error) throw new InternalServerErrorException('Unable to load transactions');
    return data;
  }

  async findAll() {
    const { data, error } = await this.supabase.getClient().from('referral_transactions')
      .select(COLUMNS).order('document_date_utc', { ascending: false });
    if (error) throw new InternalServerErrorException('Unable to load transactions');
    return data;
  }

  async upsertImported(rows: Record<string, unknown>[]) {
    const { error } = await this.supabase.getClient().from('referral_transactions')
      .upsert(rows, { onConflict: 'id' });
    if (error) throw new InternalServerErrorException('Unable to persist imported transactions');
  }
}
