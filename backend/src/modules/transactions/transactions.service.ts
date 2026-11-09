import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { HttpException, HttpStatus } from '@nestjs/common';
import { CreateRealTransaction, CreateUatSimulationTransaction, PreviewRealTransaction, TransactionAction, TransactionReportQuery } from './transactions.dto';
import { DB_POLICY_ERRORS, POLICY_MESSAGES as POLICY_TEXT, resolvePaymentPolicy } from '../commercial/commercial-policy';

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

/**
 * A Partner sees what it earns, never the Merchant's customer discount (rate or amount): that is a Merchant-only commercial term.
 * Applied to every Partner-facing projection (the list, the report, its summary and its sort options).
 */
const PARTNER_HIDDEN = new Set(['document_discount_percent', 'document_discount_amount']);
const forRole = (columns: string, redact: boolean) => (redact ? columns.split(',').filter((c) => !PARTNER_HIDDEN.has(c)).join(',') : columns);

type ActorScope = { column: 'merchant_id' | 'collaborator_id'; value: string } | null;
const fail = (status: HttpStatus, code: string, message: string) => new HttpException({ code, message }, status);

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

  private async summarizeFiltered(filter: TransactionReportQuery, scope: ActorScope, redact = false) {
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
        .select(forRole('document_total,document_discount_amount,commission_amount,payment_status,lifecycle_status,legacy_status,record_kind', redact))
        .range(offset, offset + batchSize - 1);
      query = this.applyReportFilters(query, filter, scope);
      const { data, error } = await query;
      if (error) throw new InternalServerErrorException('Unable to reconcile filtered transaction totals');
      const rows = (data || []) as unknown as Record<string, any>[]; // the column list is built per role, so the client cannot infer the row type
      for (const row of rows) {
        totals.transactionCount += 1;
        totals.documentTotal += this.decimal4(row.document_total);
        if (!redact) totals.discountAmount += this.decimal4(row.document_discount_amount);
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
      ...(redact ? {} : { document_discount_amount: this.format4(totals.discountAmount) }),
      commission_amount: this.format4(totals.commissionAmount),
      payment_statuses: totals.paymentStatuses,
      lifecycle_statuses: totals.lifecycleStatuses,
      source_statuses: totals.sourceStatuses,
      record_kinds: totals.recordKinds,
    };
  }

  private async buildReport(filter: TransactionReportQuery, scope: ActorScope, redact = false) {
    const from = (filter.page - 1) * filter.page_size;
    // A Partner cannot even ORDER by the discount: the ordering alone would reveal it.
    const sort = redact && filter.sort === 'document_discount_amount' ? 'document_date_utc' : filter.sort;
    let query = this.supabase.getClient().from('referral_transactions')
      .select(forRole(REPORT_COLUMNS, redact), { count: 'exact' });
    query = this.applyReportFilters(query, filter, scope)
      .order(sort, { ascending: filter.direction === 'asc', nullsFirst: false })
      .range(from, from + filter.page_size - 1);
    const [{ data, error, count }, summary] = await Promise.all([
      query,
      this.summarizeFiltered(filter, scope, redact),
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
      return this.buildReport(filter, { column: 'collaborator_id', value: profile.collaborator_id }, true);
    }
    if (profile.role === 'admin') return this.buildReport(filter, null);
    throw new ForbiddenException('Transaction access is not assigned');
  }

  async findForActor(userId: string) {
    const profile = await this.profile(userId);
    const redact = profile.role === 'collaborator';
    let query = this.supabase.getClient().from('referral_transactions').select(forRole(COLUMNS, redact))
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

  async createRealTransaction(userId: string, dto: CreateRealTransaction) {
    const { data, error } = await this.supabase.getClient().rpc('create_real_transaction', {
      p_actor_user_id: userId,
      p_collaborator_code: dto.collaborator_code,
      p_gross_amount: dto.gross_amount,
      p_idempotency_key: dto.idempotency_key,
      p_scan_event_id: dto.scan_event_id ?? null,
    }).single();
    if (error) {
      if (error.code === '42501') throw new ForbiddenException(error.message);
      if (error.code === '23505') throw new ConflictException(error.message);
      if (error.code === '22023') {
        // The database function is the authority on the Merchant's commercial policy; its refusals become stable, actionable codes.
        const policy = DB_POLICY_ERRORS.find(([pattern]) => pattern.test(error.message || ''));
        if (policy) throw fail(HttpStatus.UNPROCESSABLE_ENTITY, policy[1], POLICY_TEXT[policy[1]]);
        if (/scan event does not belong/i.test(error.message || '')) throw fail(HttpStatus.BAD_REQUEST, 'SCAN_EVENT_MISMATCH', 'Lượt quét này không thuộc cửa hàng và Đối tác của giao dịch. Hãy quét lại mã của Đối tác.');
        if (/active verified partner required/i.test(error.message || '')) throw fail(HttpStatus.BAD_REQUEST, 'PARTNER_NOT_ACTIVE', 'Đối tác chưa hoạt động hoặc không tìm thấy.');
      }
      if (['22003', '22023', '23514'].includes(error.code || '')) throw new BadRequestException(error.message);
      throw new InternalServerErrorException('Unable to create real transaction');
    }
    const row = data as Record<string, unknown>;
    return { ...row, final_payable: this.format4(this.decimal4(row.gross_amount) - this.decimal4(row.discount_amount)), record_kind: 'real_transaction', payment_status: 'unverified', external_settlement_enabled: false };
  }

  /** round(gross * rate, 4) exactly as the database function does (numeric, half away from zero), on integer ten-thousandths. */
  private roundedProduct(gross: bigint, rate: bigint): bigint {
    return (gross * rate + 5000n) / 10000n;
  }

  /**
   * Read-only price preview for the payment step. GLOBAL Partner network: any active verified Partner can be priced at any active verified Merchant —
   * there is no Partner-to-Merchant assignment. It applies the SAME rules as create_real_transaction — active verified Merchant, the Merchant's own
   * commercial policy (commission must be configured; the customer discount is whatever this Merchant gives, none if unconfigured), positive amount with
   * at most four decimals — and the same arithmetic:
   *   discount   = round4(gross x discount rate)           what the customer saves
   *   final      = gross - discount                        what the customer pays
   *   commission = round4(gross x commission rate)         the Partner's share, on the ORIGINAL amount (V1-verified, 102/102 rows); independent of the discount rate
   * The Merchant enters ONLY the original invoice amount; everything else comes from the Merchant policy. Nothing is written: no transaction, commission,
   * payment, ledger or audit row.
   */
  async previewRealTransaction(userId: string, dto: PreviewRealTransaction) {
    const gross = this.decimal4(dto.gross_amount);
    if (gross <= 0n) throw fail(HttpStatus.BAD_REQUEST, 'AMOUNT_INVALID', 'Số tiền hoá đơn phải lớn hơn 0.');
    const client = this.supabase.getClient();
    const { data: profile } = await client.from('user_profiles').select('role,user_profiles_status,merchant_id').eq('user_id', userId).maybeSingle();
    if (!profile || profile.role !== 'merchant' || profile.user_profiles_status !== 'active' || !profile.merchant_id) {
      throw fail(HttpStatus.FORBIDDEN, 'MERCHANT_REQUIRED', 'Active Merchant profile required');
    }
    const { data: merchant } = await client.from('merchant_details')
      .select('merchant_system_id,merchant_verified,merchants_status,merchant_discount_type,merchant_discount_value,merchant_commission_type,merchant_commission_value')
      .eq('merchant_system_id', profile.merchant_id).maybeSingle();
    if (!merchant || !merchant.merchant_verified || merchant.merchants_status !== 'active') {
      throw fail(HttpStatus.FORBIDDEN, 'MERCHANT_NOT_ACTIVE', 'Tài khoản nhà cung cấp chưa được duyệt.');
    }
    const policy = resolvePaymentPolicy(merchant);
    if ('code' in policy) throw fail(HttpStatus.UNPROCESSABLE_ENTITY, policy.code, policy.message);
    const { data: partner } = await client.from('collaborators')
      .select('id,collaborators_code,collaborators_name,collaborators_verified,collaborators_status')
      .eq('collaborators_code', dto.collaborator_code.trim()).maybeSingle();
    if (!partner || !partner.collaborators_verified || partner.collaborators_status !== 'active') {
      throw fail(HttpStatus.BAD_REQUEST, 'PARTNER_NOT_ACTIVE', 'Đối tác chưa hoạt động hoặc không tìm thấy.');
    }
    const discountRate = this.decimal4(policy.discountRate); const commissionRate = this.decimal4(policy.commissionRate);
    const discount = this.roundedProduct(gross, discountRate); const commission = this.roundedProduct(gross, commissionRate);
    return {
      partner: { id: partner.id, code: partner.collaborators_code, name: partner.collaborators_name },
      currency_code: 'VND',
      gross_amount: this.format4(gross),
      discount_rate: this.format4(discountRate),
      discount_amount: this.format4(discount),
      final_payable: this.format4(gross - discount),
      commission_rate: this.format4(commissionRate),
      commission_amount: this.format4(commission),
      commission_base: 'gross_amount',
      financial_action_created: false,
    };
  }

  /** The transaction receipt: Merchant (own transactions) and Admin only — it carries the customer discount, which a Partner never sees. */
  async receipt(userId: string, transactionId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(transactionId)) throw fail(HttpStatus.BAD_REQUEST, 'ID_INVALID', 'Invalid transaction id');
    const profile = await this.profile(userId);
    if (profile.role !== 'merchant' && profile.role !== 'admin') throw new ForbiddenException('Receipt access is not assigned');
    const client = this.supabase.getClient();
    let query = client.from('referral_transactions').select(`${REPORT_COLUMNS}`).eq('id', transactionId).eq('record_kind', 'real_transaction');
    if (profile.role === 'merchant') query = query.eq('merchant_id', profile.merchant_id);
    const { data: row, error } = await query.maybeSingle();
    if (error) throw new InternalServerErrorException('Unable to load the receipt');
    if (!row) throw new NotFoundException('Transaction not found');
    const t: any = row;
    const { data: events } = await client.from('transaction_events').select('event_type,from_status,to_status,occurred_at').eq('transaction_id', transactionId).order('occurred_at', { ascending: true });
    const one = (v: any) => (Array.isArray(v) ? v[0] : v);
    return {
      transaction_id: t.id, document_number: t.document_number, issued_at: t.document_date_utc, confirmed_at: t.confirmed_at_utc ?? t.confirmed_at ?? null,
      lifecycle_status: t.lifecycle_status, payment_status: t.payment_status, currency_code: t.currency_code,
      merchant: { code: one(t.merchant)?.merchant_code ?? null, name: one(t.merchant)?.merchant_name ?? null },
      partner: { code: one(t.collaborator)?.collaborators_code ?? null, name: one(t.collaborator)?.collaborators_name ?? null },
      gross_amount: this.format4(this.decimal4(t.document_total)),
      discount_rate: this.format4(this.decimal4(t.document_discount_percent)),
      discount_amount: this.format4(this.decimal4(t.document_discount_amount)),
      final_payable: this.format4(this.decimal4(t.document_total) - this.decimal4(t.document_discount_amount)),
      commission_rate: this.format4(this.decimal4(t.commission_percent)),
      commission_amount: this.format4(this.decimal4(t.commission_amount)),
      commission_base: 'gross_amount',
      events: (events || []).map((e: any) => ({ type: e.event_type, from: e.from_status, to: e.to_status, at: e.occurred_at })),
    };
  }

  private async transitionTransaction(
    rpc: string,
    userId: string,
    transactionId: string,
    dto: TransactionAction,
  ) {
    const { data, error } = await this.supabase.getClient().rpc(rpc, {
      p_actor_user_id: userId,
      p_transaction_id: transactionId,
      p_idempotency_key: dto.idempotency_key,
    }).single();
    if (error) {
      if (error.code === '42501') throw new ForbiddenException(error.message);
      if (['22023', '23514'].includes(error.code || '')) throw new BadRequestException(error.message);
      if (error.code === 'P0001' || error.message?.includes('not found')) throw new NotFoundException(error.message);
      throw new InternalServerErrorException('Unable to update transaction');
    }
    return data;
  }

  async confirmTransaction(userId: string, transactionId: string, dto: TransactionAction) {
    return this.transitionTransaction('confirm_real_transaction', userId, transactionId, dto);
  }

  async cancelTransaction(userId: string, transactionId: string, dto: TransactionAction) {
    return this.transitionTransaction('cancel_real_transaction', userId, transactionId, dto);
  }

  async reverseTransaction(userId: string, transactionId: string, dto: TransactionAction) {
    return this.transitionTransaction('reverse_real_transaction', userId, transactionId, dto);
  }

  async upsertImported(rows: Record<string, unknown>[]) {
    const { error } = await this.supabase.getClient().from('referral_transactions')
      .upsert(rows, { onConflict: 'id' });
    if (error) throw new InternalServerErrorException('Unable to persist imported transactions');
  }
}
