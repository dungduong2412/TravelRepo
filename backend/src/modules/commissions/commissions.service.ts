import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';

@Injectable()
export class CommissionsService {
  constructor(private readonly supabase: SupabaseService) {}

  private decimal4(value: unknown): bigint {
    const normalized = String(value ?? 0);
    const negative = normalized.startsWith('-');
    const [whole, fraction = ''] = normalized.replace(/^[+-]/, '').split('.');
    const scaled = BigInt(whole || '0') * 10000n + BigInt((fraction + '0000').slice(0, 4));
    return negative ? -scaled : scaled;
  }

  private format4(value: bigint): string {
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    return `${negative ? '-' : ''}${absolute / 10000n}.${String(absolute % 10000n).padStart(4, '0')}`;
  }

  private summarize(rows: any[]) {
    const totals = rows.reduce((result, row) => {
      const status = String(row.payment_status || 'unverified');
      result.transactionCount += 1;
      result.commissionAmount += this.decimal4(row.commission_amount);
      result.documentTotal += this.decimal4(row.document_total);
      result.paymentStatuses[status] = (result.paymentStatuses[status] || 0) + 1;
      return result;
    }, { transactionCount: 0, commissionAmount: 0n, documentTotal: 0n,
      paymentStatuses: {} as Record<string, number> });
    return {
      transaction_count: totals.transactionCount,
      commission_amount: this.format4(totals.commissionAmount),
      document_total: this.format4(totals.documentTotal),
      payment_statuses: totals.paymentStatuses,
    };
  }

  private async rows(filter?: { column: 'merchant_id' | 'collaborator_id'; value: string }) {
    let query = this.supabase.getClient().from('referral_transactions')
      .select('commission_amount,document_total,payment_status');
    if (filter) query = query.eq(filter.column, filter.value);
    const { data, error } = await query;
    if (error) throw new InternalServerErrorException('Unable to load commissions');
    return data || [];
  }

  async forActor(userId: string) {
    const { data: profile, error } = await this.supabase.getClient().from('user_profiles')
      .select('role,user_profiles_status,merchant_id,collaborator_id').eq('user_id', userId).maybeSingle();
    if (error || !profile || profile.user_profiles_status !== 'active') throw new ForbiddenException('Active profile required');
    if (profile.role === 'merchant' && profile.merchant_id)
      return this.summarize(await this.rows({ column: 'merchant_id', value: profile.merchant_id }));
    if (profile.role === 'collaborator' && profile.collaborator_id)
      return this.summarize(await this.rows({ column: 'collaborator_id', value: profile.collaborator_id }));
    if (profile.role === 'admin') return this.summarize(await this.rows());
    throw new ForbiddenException('Commission access is not assigned');
  }

  async all() { return this.summarize(await this.rows()); }
}
