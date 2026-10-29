import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { CreateUatSimulationTransaction, TransactionReportQuery } from './transactions.dto';

const COLUMNS = [
  'id', 'legacy_transaction_id', 'merchant_id', 'collaborator_id',
  'legacy_restaurant_id', 'legacy_middleman_id', 'legacy_status', 'lifecycle_status',
  'payment_status', 'document_number', 'document_date_utc',
  'document_total', 'document_discount_amount', 'commission_percent',
  'commission_amount', 'currency_code', 'created_at', 'record_kind',
  'simulation_status', 'external_settlement_enabled',
].join(',');

const REPORT_COLUMNS = [
  'id', 'legacy_transaction_id', 'merchant_id', 'collaborator_id',
  'legacy_restaurant_id', 'legacy_middleman_id', 'legacy_branch_id',
  'legacy_status', 'lifecycle_status', 'payment_status',
  'document_number', 'document_index', 'document_date', 'document_date_utc',
  'posting_date', 'posting_date_utc', 'confirmed_at', 'confirmed_at_utc',
  'commission_date', 'commission_date_utc', 'document_total',
  'document_discount_percent', 'document_discount_amount',
  'commission_percent', 'commission_amount', 'currency_code',
  'legacy_restaurant_display_name', 'legacy_middleman_display_name',
  'legacy_creator_name', 'legacy_notes', 'created_at',
  'record_kind', 'simulation_status', 'external_settlement_enabled',
  'merchant:merchant_details!referral_transactions_merchant_id_fkey(merchant_system_id,merchant_code,merchant_name)',
  'collaborator:collaborators!referral_transactions_collaborator_id_fkey(id,collaborators_code,collaborators_name)',
].join(',');

type ActorScope = { column: 'merchant_id' | 'collaborator_id'; value: string } | null;

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

  private decimal4(value: unknown): bigint {
    const normalized = String(value ?? 0).trim();
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

  private applyReportFilters(query: any, filter: TransactionReportQuery, scope: ActorScope) {
    if (scope) query = query.eq(scope.column, scope.value);
    if (filter.merchant_id) query = query.eq('merchant_id', filter.merchant_id);
    if (filter.collaborator_id) query = query.eq('collaborator_id', filter.collaborator_id);
    if (filter.orphan_only) query = query.is('merchant_id', null);
    if (filter.legacy_status === 'null') query = query.is('legacy_status', null);
    else if (filter.legacy_status !== undefined) query = query.eq('legacy_status', filter.legacy_status);
    if (filter.lifecycle_status) query = query.eq('lifecycle_status', filter.lifecycle_status);
    if (filter.payment_status) query = query.eq('payment_status', filter.payment_status);
    if (filter.record_kind) query = query.eq('record_kind', filter.record_kind);
    if (filter.from) query = query.gte('document_date_utc', filter.from);
    if (filter.to) query = query.lte('document_date_utc', filter.to);
    if (filter.search) {
      const term = filter.search.replace(/[,%()]/g, ' ').trim();
      if (term) query = query.or([
        `document_number.ilike.%${term}%`,
        `legacy_restaurant_display_name.ilike.%${term}%`,
        `legacy_middleman_display_name.ilike.%${term}%`,
        `legacy_creator_name.ilike.%${term}%`,
      ].join(','));
    }
    return query;
  }

  private async summarizeFiltered(filter: TransactionReportQuery, scope: ActorScope) {
    const batchSize = 1000;
    let offset = 0;
    const totals = {
      transactionCount: 0,
      documentTotal: 0n,
      discountAmount: 0n,
      commissionAmount: 0n,
      paymentStatuses: {} as Record<string, number>,
      lifecycleStatuses: {} as Record<string, number>,
      sourceStatuses: {} as Record<string, number>,
      recordKinds: {} as Record<string, number>,
    };

    for (;;) {
      let query = this.supabase.getClient().from('referral_transactions')
        .select('document_total,document_discount_amount,commission_amount,payment_status,lifecycle_status,legacy_status,record_kind')
        .range(offset, offset + batchSize - 1);
      query = this.applyReportFilters(query, filter, scope);
      const { data, error } = await query;
      if (error) throw new InternalServerErrorException('Unable to reconcile filtered transaction totals');
      const rows = data || [];
      for (const row of rows) {
        totals.transactionCount += 1;
        totals.documentTotal += this.decimal4(row.document_total);
        totals.discountAmount += this.decimal4(row.document_discount_amount);
        totals.commissionAmount += this.decimal4(row.commission_amount);
        const payment = row.payment_status ?? 'null';
        const lifecycle = row.lifecycle_status ?? 'null';
        const source = row.legacy_status === null ? 'null' : String(row.legacy_status);
        const recordKind = row.record_kind ?? 'v1_import';
        totals.paymentStatuses[payment] = (totals.paymentStatuses[payment] || 0) + 1;
        totals.lifecycleStatuses[lifecycle] = (totals.lifecycleStatuses[lifecycle] || 0) + 1;
        totals.sourceStatuses[source] = (totals.sourceStatuses[source] || 0) + 1;
        totals.recordKinds[recordKind] = (totals.recordKinds[recordKind] || 0) + 1;
      }
      if (rows.length < batchSize) break;
      offset += batchSize;
    }

    return {
      transaction_count: totals.transactionCount,
      document_total: this.format4(totals.documentTotal),
      document_discount_amount: this.format4(totals.discountAmount),
      commission_amount: this.format4(totals.commissionAmount),
      payment_statuses: totals.paymentStatuses,
      lifecycle_statuses: totals.lifecycleStatuses,
      source_statuses: totals.sourceStatuses,
      record_kinds: totals.recordKinds,
    };
  }

  private async buildReport(filter: TransactionReportQuery, scope: ActorScope) {
    const from = (filter.page - 1) * filter.page_size;
    let query = this.supabase.getClient().from('referral_transactions')
      .select(REPORT_COLUMNS, { count: 'exact' });
    query = this.applyReportFilters(query, filter, scope)
      .order(filter.sort, { ascending: filter.direction === 'asc', nullsFirst: false })
      .range(from, from + filter.page_size - 1);
    const [{ data, error, count }, summary] = await Promise.all([
      query,
      this.summarizeFiltered(filter, scope),
    ]);
    if (error) throw new InternalServerErrorException('Unable to load transaction report');
    return {
      items: data || [],
      page: filter.page,
      page_size: filter.page_size,
      total: count || 0,
      page_count: Math.ceil((count || 0) / filter.page_size),
      summary,
    };
  }

  async report(filter: TransactionReportQuery) {
    return this.buildReport(filter, null);
  }

  async reportForActor(userId: string, filter: TransactionReportQuery) {
    const profile = await this.profile(userId);
    if (profile.role === 'merchant' && profile.merchant_id) {
      return this.buildReport(filter, { column: 'merchant_id', value: profile.merchant_id });
    }
    if (profile.role === 'collaborator' && profile.collaborator_id) {
      return this.buildReport(filter, { column: 'collaborator_id', value: profile.collaborator_id });
    }
    if (profile.role === 'admin') return this.buildReport(filter, null);
    throw new ForbiddenException('Transaction access is not assigned');
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

  async createUatSimulation(userId: string, dto: CreateUatSimulationTransaction) {
    const { data, error } = await this.supabase.getClient().rpc('create_uat_simulation_transaction', {
      p_actor_user_id: userId,
      p_collaborator_code: dto.collaborator_code,
      p_gross_amount: dto.gross_amount,
      p_idempotency_key: dto.idempotency_key,
    }).single();
    if (error) {
      if (error.code === '42501') throw new ForbiddenException(error.message);
      if (error.code === '23505') throw new ConflictException(error.message);
      if (['22003', '22023', '23514'].includes(error.code || '')) {
        throw new BadRequestException(error.message);
      }
      throw new InternalServerErrorException('Unable to create UAT simulation transaction');
    }
    return {
      ...(data as Record<string, unknown>),
      record_kind: 'uat_simulation',
      lifecycle_status: 'uat_simulation_open',
      payment_status: 'unverified',
      external_settlement_enabled: false,
    };
  }

  async upsertImported(rows: Record<string, unknown>[]) {
    const { error } = await this.supabase.getClient().from('referral_transactions')
      .upsert(rows, { onConflict: 'id' });
    if (error) throw new InternalServerErrorException('Unable to persist imported transactions');
  }
}
