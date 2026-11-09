import { publicOffer } from '../public-catalog/public-catalog.projection';

/**
 * Merchant commercial policy resolution for the GLOBAL Partner network.
 *
 * Business rule (owner decision 2026-11-09): every ACTIVE Partner may refer customers to every ACTIVE Merchant. There is no Partner-to-Merchant
 * assignment anywhere in this file. The two commercial terms are INDEPENDENT, Merchant-specific policies:
 *
 *   Customer discount   what the customer saves at THIS Merchant. Absent (NULL or 0) = no discount; the scan says "Không có ưu đãi áp dụng".
 *                       A policy that is present must be a reviewed percentage fraction (0 < rate <= 1); legacy "points" are never guessed.
 *   Partner commission  what the Partner earns on the ORIGINAL amount. It must be explicitly configured (a percentage fraction in [0, 1]);
 *                       0 is allowed only when the policy itself says 0. It is never defaulted, so a Merchant without one cannot record a transaction.
 *
 * `create_real_transaction` (database) applies the same rules and stays the authority; this module lets the scan and the price preview explain them
 * before anything is written. Both are checked against each other in test-merchant-qr-flow.ts.
 */

export type MerchantPolicyRow = {
  merchant_discount_type?: unknown;
  merchant_discount_value?: unknown;
  merchant_commission_type?: unknown;
  merchant_commission_value?: unknown;
};

export type DiscountInquiry = {
  available: boolean;
  kind: 'percentage' | null;
  /** fraction as stored and as the transaction function applies it, e.g. "0.0500" */
  rate: string | null;
  /** customer-facing label, same wording as the public catalog, e.g. "Giảm 5%" */
  label: string | null;
  /** why nothing applies (machine-readable; the screen only ever says "Không có ưu đãi áp dụng") */
  reason?: 'no_discount' | 'rate_not_reviewed';
};

export type PolicyBlock = 'COMMISSION_POLICY_MISSING' | 'COMMISSION_POLICY_NOT_REVIEWED' | 'DISCOUNT_POLICY_NOT_REVIEWED';

export type PaymentPolicy =
  | { ready: true; discountRate: string; commissionRate: string; discountConfigured: boolean }
  | { ready: false; code: PolicyBlock; message: string };

export const POLICY_MESSAGES: Record<PolicyBlock, string> = {
  COMMISSION_POLICY_MISSING:
    'Cửa hàng chưa cấu hình chính sách hoa hồng cho Đối tác nên chưa thể ghi nhận giao dịch. Việc quét mã vẫn hợp lệ và đã được tính. Vui lòng liên hệ Admin VNO để cấu hình hoa hồng.',
  COMMISSION_POLICY_NOT_REVIEWED:
    'Tỷ lệ hoa hồng của cửa hàng chưa phải tỷ lệ phần trăm hợp lệ đã được Admin duyệt nên chưa thể ghi nhận giao dịch. Vui lòng liên hệ Admin VNO.',
  DISCOUNT_POLICY_NOT_REVIEWED:
    'Chính sách ưu đãi cho khách của cửa hàng chưa phải tỷ lệ phần trăm hợp lệ đã được Admin duyệt nên chưa thể ghi nhận giao dịch. Vui lòng liên hệ Admin VNO.',
};

/** The messages `create_real_transaction` raises (errcode 22023) and the stable API code each one maps to. */
export const DB_POLICY_ERRORS: Array<[RegExp, PolicyBlock]> = [
  [/commission policy is not configured/i, 'COMMISSION_POLICY_MISSING'],
  [/commission policy is not a reviewed fraction/i, 'COMMISSION_POLICY_NOT_REVIEWED'],
  [/discount policy is not a reviewed fraction/i, 'DISCOUNT_POLICY_NOT_REVIEWED'],
];

const isMissing = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** A numeric rate rounded half away from zero to four decimals, exactly like `value::numeric(18,4)`. Returns null when it is not a finite number. */
export function rate4(value: unknown): string | null {
  const n = Number(value);
  if (isMissing(value) || !Number.isFinite(n)) return null;
  const negative = n < 0;
  const [whole, fraction = ''] = Math.abs(n).toFixed(8).split('.');
  let scaled = BigInt(whole) * 10000n + BigInt(fraction.slice(0, 4));
  if (Number(fraction[4] ?? 0) >= 5) scaled += 1n;
  return `${negative ? '-' : ''}${scaled / 10000n}.${String(scaled % 10000n).padStart(4, '0')}`;
}

/** The customer discount THIS Merchant gives, as the scan screen shows it. Same rule as the public catalog, so every surface agrees. */
export function resolveCustomerDiscount(merchant: MerchantPolicyRow): DiscountInquiry {
  const none = (reason: DiscountInquiry['reason']): DiscountInquiry => ({ available: false, kind: null, rate: null, label: null, reason });
  const value = Number(merchant.merchant_discount_value);
  if (isMissing(merchant.merchant_discount_value) || !Number.isFinite(value) || value <= 0) return none('no_discount');
  if (merchant.merchant_discount_type !== 'percentage' || value > 1) return none('rate_not_reviewed'); // legacy "points" (8, 10, ...) or a non-percentage type
  const offer = publicOffer('percentage', value);
  if (!offer) return none('no_discount');
  return { available: true, kind: 'percentage', rate: rate4(value), label: offer.label };
}

/**
 * Can this Merchant record a transaction, and at which rates? Mirrors the checks in `create_real_transaction`:
 *  commission  type 'percentage' and a value in [0, 1], explicitly present (never defaulted);
 *  discount    NULL or 0 = none; otherwise type 'percentage' and a value in (0, 1].
 */
export function resolvePaymentPolicy(merchant: MerchantPolicyRow): PaymentPolicy {
  const block = (code: PolicyBlock): PaymentPolicy => ({ ready: false, code, message: POLICY_MESSAGES[code] });
  const c = Number(merchant.merchant_commission_value);
  if (merchant.merchant_commission_type !== 'percentage' || isMissing(merchant.merchant_commission_value)) return block('COMMISSION_POLICY_MISSING');
  if (!Number.isFinite(c) || c < 0 || c > 1) return block('COMMISSION_POLICY_NOT_REVIEWED');

  const d = Number(merchant.merchant_discount_value);
  let discountRate = '0.0000'; let discountConfigured = false;
  if (!isMissing(merchant.merchant_discount_value) && !(Number.isFinite(d) && d === 0)) {
    if (merchant.merchant_discount_type !== 'percentage' || !Number.isFinite(d) || d < 0 || d > 1) return block('DISCOUNT_POLICY_NOT_REVIEWED');
    discountRate = rate4(d)!; discountConfigured = true;
  }
  return { ready: true, discountRate, commissionRate: rate4(c)!, discountConfigured };
}
