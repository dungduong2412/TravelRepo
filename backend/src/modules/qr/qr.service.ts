import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { MediaService } from '../media/media.service';
import { publicOffer } from '../public-catalog/public-catalog.projection';
import { SlidingWindowLimiter } from '../../common/http/rate-limiter';
import { KeyedLock } from '../../common/concurrency/keyed-lock';
import { AuditService } from '../audit/audit.service';
import { ScanSummaryQuery } from './qr.dto';
import { parsePartnerQrPayload } from './partner-qr-payload';

const fail = (status: HttpStatus, code: string, message: string) => new HttpException({ code, message }, status);
const likeExact = (value: string) => value.replace(/[\\%_]/g, '\\$&'); // ilike without wildcards

export type DiscountInquiry = {
  available: boolean;
  kind: 'percentage' | null;
  /** fraction as stored and as the transaction RPC applies it, e.g. "0.0500" */
  rate: string | null;
  /** customer-facing label, same wording as the public catalog, e.g. "Giảm 5%" */
  label: string | null;
  /** why nothing applies (machine-readable; the screen only ever says "Không có ưu đãi áp dụng") */
  reason?: 'partner_not_assigned' | 'no_discount' | 'rate_not_reviewed';
};

export const SCAN_ACTION = 'merchant.partner_qr_scanned';
const VN_OFFSET_MS = 7 * 3_600_000; // reporting days follow Vietnam time (UTC+7)
const vnDay = (iso: string) => new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Merchant-side Partner QR resolution ("scan and identify").
 * It creates no transaction, commission, payment or ledger entry — ever. The ONLY thing a valid scan writes is one walk-in counter event
 * (`merchant.partner_qr_scanned`, in the audit trail), recorded once per scan, and it never creates or changes a Partner–Merchant association.
 * It answers, for the SCANNING Merchant only,
 * who the Partner is (name, avatar, code, status) and which customer discount that Merchant's active policy gives this Partner's customers.
 * Nothing about commission, and nothing private about the Partner (phone, e-mail, bank), is returned.
 */
@Injectable()
export class QrService {
  private readonly perMerchant = new SlidingWindowLimiter(90, 60_000); // a person cannot scan 90 codes a minute; a script enumerating codes can

  private readonly scanLock = new KeyedLock();

  constructor(private readonly supabase: SupabaseService, private readonly media: MediaService, private readonly audit: AuditService) {}

  private get db() { return this.supabase.getClient(); }

  async resolveForMerchant(userId: string, payload: unknown, opts: { scanId?: string; source?: string } = {}) {
    if (!this.perMerchant.take(userId)) throw fail(HttpStatus.TOO_MANY_REQUESTS, 'QR_RATE_LIMITED', 'Bạn quét quá nhanh. Hãy đợi một chút rồi quét lại.');

    const { data: profile, error: profileError } = await this.db.from('user_profiles')
      .select('role,user_profiles_status,merchant_id').eq('user_id', userId).maybeSingle();
    if (profileError || !profile || profile.role !== 'merchant' || profile.user_profiles_status !== 'active' || !profile.merchant_id) {
      throw new ForbiddenException({ code: 'MERCHANT_REQUIRED', message: 'Active merchant access required' });
    }

    const parsed = parsePartnerQrPayload(payload);
    if (parsed.ok !== true) {
      throw fail(HttpStatus.BAD_REQUEST, 'QR_UNSUPPORTED', 'Mã QR này không phải mã Đối tác của VNO. Hãy quét đúng mã QR trong Cổng Đối tác, hoặc nhập mã có dạng COL-….');
    }

    // Exact match first, then case-insensitively (a typed or pasted code may have lost its case). More than one case-variant is ambiguous: refuse.
    const { data: rows, error } = await this.db.from('collaborators')
      .select('id,collaborators_code,collaborators_name,collaborators_verified,collaborators_status,merchant_system_id')
      .ilike('collaborators_code', likeExact(parsed.code)).limit(3);
    if (error) throw fail(HttpStatus.SERVICE_UNAVAILABLE, 'QR_UNAVAILABLE', 'Chưa tra cứu được mã QR lúc này. Hãy thử lại sau ít giây.');
    const exact = (rows || []).filter((r: any) => r.collaborators_code === parsed.code);
    const matches = exact.length === 1 ? exact : (rows || []);
    if (matches.length !== 1) {
      throw fail(HttpStatus.NOT_FOUND, 'PARTNER_NOT_FOUND', 'Không tìm thấy Đối tác với mã này. Hãy kiểm tra lại mã hoặc nhờ Đối tác mở mã QR mới nhất trong Cổng Đối tác.');
    }
    const partner = matches[0] as any;
    if (!partner.collaborators_verified || partner.collaborators_status !== 'active') {
      throw fail(HttpStatus.CONFLICT, 'PARTNER_NOT_ACTIVE', 'Đối tác này hiện chưa hoạt động (chưa được duyệt hoặc đã tạm ngưng). Vui lòng liên hệ Admin VNO.');
    }

    const { data: merchant } = await this.db.from('merchant_details')
      .select('merchant_system_id,merchant_verified,merchants_status,merchant_discount_type,merchant_discount_value')
      .eq('merchant_system_id', profile.merchant_id).maybeSingle();
    if (!merchant || !merchant.merchant_verified || merchant.merchants_status !== 'active') {
      throw fail(HttpStatus.FORBIDDEN, 'MERCHANT_NOT_ACTIVE', 'Tài khoản nhà cung cấp chưa được duyệt nên chưa thể tra cứu ưu đãi.');
    }

    const association = partner.merchant_system_id === merchant.merchant_system_id
      ? 'assigned_to_this_merchant' : partner.merchant_system_id ? 'assigned_elsewhere' : 'unassigned';
    const avatar = await this.media.effectiveAvatar('collaborator', partner.id).catch(() => null);
    const scan = await this.recordScan(userId, merchant.merchant_system_id, partner, association, opts);

    return {
      // established contract (kept so existing clients and tests keep working)
      collaborator_id: partner.id,
      collaborator_code: partner.collaborators_code,
      collaborator_name: partner.collaborators_name,
      verified: partner.collaborators_verified,
      status: partner.collaborators_status,
      association,
      idempotent: true,
      financial_action_created: false,
      // what the scan screen shows
      partner: { id: partner.id, code: partner.collaborators_code, name: partner.collaborators_name, avatar_url: avatar?.signed_url ?? null, verified: true, status: 'active' },
      discount: this.discountFor(association, merchant),
      /** counted = this lookup was recorded as a walk-in; duplicate = the same scan had already been counted (a retry or a repeated detection) */
      scan,
    };
  }

  /**
   * Counts a VALID scan (an active, verified Partner looked up by an active Merchant) exactly once. The key is the scan id chosen by the phone — or, for a client
   * that sends none, (Merchant, Partner, minute) — so a retry after a bad connection and a camera that sees the same code on many frames are one walk-in.
   * Whether the Partner belongs to this Merchant is recorded, not required, and never changes. Counting problems never fail the lookup.
   */
  private async recordScan(userId: string, merchantId: string, partner: any, association: string, opts: { scanId?: string; source?: string }) {
    const key = opts.scanId ? `scan:${merchantId}:${opts.scanId}:${partner.id}` : `win:${merchantId}:${partner.id}:${Math.floor(Date.now() / 60_000)}`;
    return this.scanLock.run(key, async () => {
      try {
        const since = new Date(Date.now() - (opts.scanId ? 24 * 3_600_000 : 120_000)).toISOString();
        const { data: existing } = await this.db.from('audit_events').select('id').eq('action', SCAN_ACTION).eq('request_id', key).gte('occurred_at', since).limit(1);
        if ((existing || []).length) return { counted: false, duplicate: true };
        await this.audit.record({ id: userId, role: 'merchant' }, SCAN_ACTION, 'collaborator', partner.id, {
          merchant_id: merchantId, association, partner_code: partner.collaborators_code, source: opts.source ?? 'unknown', key_kind: opts.scanId ? 'scan_id' : 'window',
        }, key);
        return { counted: true, duplicate: false };
      } catch { return { counted: false, duplicate: false }; }
    });
  }

  /**
   * Walk-in report: valid scans per day (Vietnam time), split by whether the Partner belongs to the Merchant, plus the busiest Partners.
   * A Merchant sees its own; Admin may pass any merchant_id (or none for all). A Partner has no access.
   */
  async scanSummary(userId: string, query: ScanSummaryQuery) {
    const { data: profile } = await this.db.from('user_profiles').select('role,user_profiles_status,merchant_id').eq('user_id', userId).maybeSingle();
    if (!profile || profile.user_profiles_status !== 'active' || (profile.role !== 'merchant' && profile.role !== 'admin')) {
      throw new ForbiddenException({ code: 'SCAN_REPORT_FORBIDDEN', message: 'Scan report access is not assigned' });
    }
    if (profile.role === 'merchant' && (!profile.merchant_id || (query.merchant_id && query.merchant_id !== profile.merchant_id))) {
      throw new ForbiddenException({ code: 'SCAN_REPORT_FORBIDDEN', message: 'Scan report access is limited to your own business' });
    }
    const merchantId = profile.role === 'merchant' ? profile.merchant_id : query.merchant_id;
    const to = new Date(); const from = new Date(to.getTime() - query.days * 86_400_000);
    let q = this.db.from('audit_events').select('occurred_at,entity_id,details').eq('action', SCAN_ACTION).gte('occurred_at', from.toISOString()).order('occurred_at', { ascending: false }).limit(10_000);
    if (merchantId) q = q.filter('details->>merchant_id', 'eq', merchantId);
    const { data, error } = await q;
    if (error) throw fail(HttpStatus.SERVICE_UNAVAILABLE, 'SCAN_REPORT_UNAVAILABLE', 'Chưa tải được báo cáo lượt quét. Hãy thử lại sau.');
    const rows = (data || []) as Array<{ occurred_at: string; entity_id: string; details: any }>;
    const byDay = new Map<string, number>(); const byPartner = new Map<string, { code: string; count: number }>();
    for (let i = 0; i < query.days; i += 1) byDay.set(vnDay(new Date(to.getTime() - i * 86_400_000).toISOString()), 0);
    let assigned = 0;
    for (const r of rows) {
      const day = vnDay(r.occurred_at); byDay.set(day, (byDay.get(day) ?? 0) + 1);
      if (r.details?.association === 'assigned_to_this_merchant') assigned += 1;
      const p = byPartner.get(r.entity_id) ?? { code: r.details?.partner_code ?? '', count: 0 }; p.count += 1; byPartner.set(r.entity_id, p);
    }
    let names = new Map<string, string>();
    const top = [...byPartner.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
    if (top.length) { const { data: ps } = await this.db.from('collaborators').select('id,collaborators_name').in('id', top.map(([id]) => id)); names = new Map((ps || []).map((x: any) => [x.id, x.collaborators_name])); }
    return {
      merchant_id: merchantId ?? null, days: query.days, from: from.toISOString(), to: to.toISOString(), timezone: 'Asia/Ho_Chi_Minh',
      total: rows.length, assigned_to_merchant: assigned, not_assigned: rows.length - assigned, distinct_partners: byPartner.size,
      by_day: [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count })),
      top_partners: top.map(([id, v]) => ({ partner_code: v.code, partner_name: names.get(id) ?? null, count: v.count })),
      note: 'Mỗi lượt quét hợp lệ được tính một lần, kể cả khi chưa có hoá đơn. Quét không tạo giao dịch, hoa hồng hay liên kết Đối tác – nhà cung cấp.',
    };
  }

  /**
   * The Merchant's own active customer-discount policy, only when it would really be applied: the Partner belongs to this Merchant (the transaction
   * workflow refuses anyone else) and the rate is a reviewed fraction. Uses the same rule as the public catalog, so every surface agrees.
   */
  discountFor(association: string, merchant: { merchant_discount_type?: unknown; merchant_discount_value?: unknown }): DiscountInquiry {
    const none = (reason: DiscountInquiry['reason']): DiscountInquiry => ({ available: false, kind: null, rate: null, label: null, reason });
    if (association !== 'assigned_to_this_merchant') return none('partner_not_assigned');
    const value = Number(merchant.merchant_discount_value);
    if (merchant.merchant_discount_value === null || merchant.merchant_discount_value === undefined || !Number.isFinite(value) || value <= 0) return none('no_discount');
    if (merchant.merchant_discount_type !== 'percentage' || value > 1) return none('rate_not_reviewed'); // legacy "points" (8, 10, ...) or a non-percentage type
    const offer = publicOffer('percentage', value);
    if (!offer) return none('no_discount');
    return { available: true, kind: 'percentage', rate: value.toFixed(4), label: offer.label };
  }
}
