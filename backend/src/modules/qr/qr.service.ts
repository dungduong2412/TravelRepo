import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { MediaService } from '../media/media.service';
import { publicOffer } from '../public-catalog/public-catalog.projection';
import { SlidingWindowLimiter } from '../../common/http/rate-limiter';
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

/**
 * Merchant-side Partner QR resolution ("scan and identify").
 * Read-only by construction: it creates no transaction, commission, payment, ledger or audit row. It answers, for the SCANNING Merchant only,
 * who the Partner is (name, avatar, code, status) and which customer discount that Merchant's active policy gives this Partner's customers.
 * Nothing about commission, and nothing private about the Partner (phone, e-mail, bank), is returned.
 */
@Injectable()
export class QrService {
  private readonly perMerchant = new SlidingWindowLimiter(90, 60_000); // a person cannot scan 90 codes a minute; a script enumerating codes can

  constructor(private readonly supabase: SupabaseService, private readonly media: MediaService) {}

  private get db() { return this.supabase.getClient(); }

  async resolveForMerchant(userId: string, payload: unknown) {
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
