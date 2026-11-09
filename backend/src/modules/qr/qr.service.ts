import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { MediaService } from '../media/media.service';
import { SlidingWindowLimiter } from '../../common/http/rate-limiter';
import { ScanSummaryQuery } from './qr.dto';
import { parsePartnerQrPayload } from './partner-qr-payload';
import { DiscountInquiry, resolveCustomerDiscount, resolvePaymentPolicy } from '../commercial/commercial-policy';

export type { DiscountInquiry } from '../commercial/commercial-policy';

const fail = (status: HttpStatus, code: string, message: string) => new HttpException({ code, message }, status);
const likeExact = (value: string) => value.replace(/[\\%_]/g, '\\$&'); // ilike without wildcards

const SCAN_SOURCES = new Set(['camera', 'upload', 'capture', 'manual']);
const SCAN_ROW_LIMIT = 10_000;
const VN_OFFSET_MS = 7 * 3_600_000; // reporting days follow Vietnam time (UTC+7)
const vnDay = (iso: string) => new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Merchant-side Partner QR resolution ("scan and identify").
 * GLOBAL Partner network: any ACTIVE Partner can be scanned by any ACTIVE Merchant. There is no Partner-to-Merchant assignment to check.
 * It creates no transaction, commission, payment or ledger entry — ever. The ONLY thing a valid scan writes is one walk-in event row in
 * `partner_scan_events` (operational analytics, kept apart from the governance audit trail), unique per scan session.
 * It answers, for the SCANNING Merchant only, who the Partner is (name, avatar, code, status), which customer discount THIS Merchant's policy gives,
 * and whether this Merchant can record a transaction (its commission policy is configured). Never the commission rate, and nothing private about the
 * Partner (phone, e-mail, bank).
 */
@Injectable()
export class QrService {
  private readonly perMerchant = new SlidingWindowLimiter(90, 60_000); // a person cannot scan 90 codes a minute; a script enumerating codes can

  constructor(private readonly supabase: SupabaseService, private readonly media: MediaService) {}

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
      .select('id,collaborators_code,collaborators_name,collaborators_verified,collaborators_status')
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
      .select('merchant_system_id,merchant_verified,merchants_status,merchant_discount_type,merchant_discount_value,merchant_commission_type,merchant_commission_value')
      .eq('merchant_system_id', profile.merchant_id).maybeSingle();
    if (!merchant || !merchant.merchant_verified || merchant.merchants_status !== 'active') {
      throw fail(HttpStatus.FORBIDDEN, 'MERCHANT_NOT_ACTIVE', 'Tài khoản nhà cung cấp chưa được duyệt nên chưa thể tra cứu ưu đãi.');
    }

    const avatar = await this.media.effectiveAvatar('collaborator', partner.id).catch(() => null);
    const scan = await this.recordScan(userId, merchant.merchant_system_id, partner, opts);
    const policy = resolvePaymentPolicy(merchant);

    return {
      // established contract (kept so existing clients and tests keep working)
      collaborator_id: partner.id,
      collaborator_code: partner.collaborators_code,
      collaborator_name: partner.collaborators_name,
      verified: partner.collaborators_verified,
      status: partner.collaborators_status,
      idempotent: true,
      financial_action_created: false,
      // what the scan screen shows
      partner: { id: partner.id, code: partner.collaborators_code, name: partner.collaborators_name, avatar_url: avatar?.signed_url ?? null, verified: true, status: 'active' },
      /** the customer discount THIS Merchant gives (its own policy); "Không có ưu đãi áp dụng" when none is configured */
      discount: resolveCustomerDiscount(merchant),
      /** can THIS Merchant record a transaction? false = its commission policy is not configured/reviewed (an explicit business-rule answer, never a guess) */
      payment: 'code' in policy ? { available: false, reason: policy.code, message: policy.message } : { available: true },
      /** id = the scan event a later transaction links to; counted = this lookup was recorded as a walk-in; duplicate = the same scan session had already been counted */
      scan,
    };
  }

  /**
   * Counts a VALID scan (an active, verified Partner looked up by an active Merchant) exactly once, in `partner_scan_events`. The uniqueness is the
   * database's: (Merchant, scan key). The key is the scan id chosen by the phone — or, for a client that sends none, (Partner, minute) — so a retry after
   * a bad connection and a camera that sees the same code on many frames are one walk-in, even across several API instances.
   * Counting problems never fail the lookup.
   */
  private async recordScan(userId: string, merchantId: string, partner: any, opts: { scanId?: string; source?: string }) {
    const kind = opts.scanId ? 'scan_id' : 'window';
    const key = opts.scanId ? `s:${opts.scanId}:${partner.id}` : `w:${partner.id}:${Math.floor(Date.now() / 60_000)}`;
    try {
      const row = {
        merchant_id: merchantId, collaborator_id: partner.id, scan_key: key, key_kind: kind,
        source: opts.source && SCAN_SOURCES.has(opts.source) ? opts.source : 'unknown', actor_auth_user_id: userId,
      };
      const inserted = await this.db.from('partner_scan_events').upsert(row, { onConflict: 'merchant_id,scan_key', ignoreDuplicates: true }).select('id');
      if (inserted.error) return { id: null, counted: false, duplicate: false };
      if ((inserted.data || []).length) return { id: (inserted.data as any[])[0].id as string, counted: true, duplicate: false };
      const { data: existing } = await this.db.from('partner_scan_events').select('id').eq('merchant_id', merchantId).eq('scan_key', key).maybeSingle();
      return { id: (existing as any)?.id ?? null, counted: false, duplicate: true };
    } catch { return { id: null, counted: false, duplicate: false }; }
  }

  /**
   * Walk-in report: valid scans per day (Vietnam time), distinct Partners, how many scans led to a transaction, and the busiest Partners.
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
    let q = this.db.from('partner_scan_events').select('id,scanned_at,collaborator_id,merchant_id').gte('scanned_at', from.toISOString()).order('scanned_at', { ascending: false }).limit(SCAN_ROW_LIMIT);
    if (merchantId) q = q.eq('merchant_id', merchantId);
    const { data, error } = await q;
    if (error) throw fail(HttpStatus.SERVICE_UNAVAILABLE, 'SCAN_REPORT_UNAVAILABLE', 'Chưa tải được báo cáo lượt quét. Hãy thử lại sau.');
    const rows = (data || []) as Array<{ id: string; scanned_at: string; collaborator_id: string }>;

    // scans that ended in a (not cancelled / reversed) transaction: the transaction carries the scan_event_id
    let tq = this.db.from('referral_transactions').select('scan_event_id,lifecycle_status').not('scan_event_id', 'is', null).gte('created_at', from.toISOString()).limit(SCAN_ROW_LIMIT);
    if (merchantId) tq = tq.eq('merchant_id', merchantId);
    const { data: linked } = await tq;
    const scanIds = new Set(rows.map((r) => r.id));
    const converted = new Set(((linked || []) as Array<{ scan_event_id: string; lifecycle_status: string }>)
      .filter((t) => scanIds.has(t.scan_event_id) && t.lifecycle_status !== 'cancelled' && t.lifecycle_status !== 'reversed').map((t) => t.scan_event_id));

    const byDay = new Map<string, number>(); const byPartner = new Map<string, number>();
    for (let i = 0; i < query.days; i += 1) byDay.set(vnDay(new Date(to.getTime() - i * 86_400_000).toISOString()), 0);
    for (const r of rows) {
      const day = vnDay(r.scanned_at); byDay.set(day, (byDay.get(day) ?? 0) + 1);
      byPartner.set(r.collaborator_id, (byPartner.get(r.collaborator_id) ?? 0) + 1);
    }
    let names = new Map<string, { code: string | null; name: string | null }>();
    const top = [...byPartner.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length) {
      const { data: ps } = await this.db.from('collaborators').select('id,collaborators_code,collaborators_name').in('id', top.map(([id]) => id));
      names = new Map((ps || []).map((x: any) => [x.id, { code: x.collaborators_code ?? null, name: x.collaborators_name ?? null }]));
    }
    return {
      merchant_id: merchantId ?? null, days: query.days, from: from.toISOString(), to: to.toISOString(), timezone: 'Asia/Ho_Chi_Minh',
      total: rows.length, distinct_partners: byPartner.size, with_transaction: converted.size, truncated: rows.length >= SCAN_ROW_LIMIT,
      by_day: [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count })),
      top_partners: top.map(([id, count]) => ({ partner_code: names.get(id)?.code ?? null, partner_name: names.get(id)?.name ?? null, count })),
      note: 'Mỗi lượt quét hợp lệ được tính một lần, kể cả khi chưa có hoá đơn. Quét không tạo giao dịch hay hoa hồng; mọi Đối tác đang hoạt động đều có thể được quét tại mọi cửa hàng.',
    };
  }
}
