/**
 * Merchant profile form logic (pure: no React, no I/O) so it is unit-tested.
 *
 * Rules mirror the API (backend merchants.dto.ts) and use the same Vietnamese wording the API returns:
 *  - only fields the Merchant CHANGED are validated and sent — a legacy value that is already invalid (a V1 e-mail with a typo, a missing phone)
 *    must never block an unrelated change;
 *  - a blank optional field means "cleared" (sent as null); a blank rate means "leave as it is" (the form says so);
 *  - field errors are per field and say what to do.
 */
export type ProfileForm = {
  merchant_name: string; merchant_email: string; merchant_phone: string; merchant_contact_phone: string; merchant_description: string; merchant_description_format: string;
  owner_name: string; owner_phone: string; owner_tax_code: string;
  new_address_country: string; new_address_province: string; new_address_district: string; new_address_city: string; new_address_ward: string; new_address_line: string;
  category_ids: string[];
  /** commercial rates as people type them: percentage points ("5" = 5 %) */
  discount_pct: string; commission_pct: string;
};
export type FieldName = keyof ProfileForm;

export const FIELD_LABEL: Record<FieldName, string> = {
  merchant_name: 'Tên doanh nghiệp', merchant_email: 'Email', merchant_phone: 'Số điện thoại', merchant_contact_phone: 'SĐT liên hệ', merchant_description: 'Mô tả', merchant_description_format: 'Định dạng mô tả',
  owner_name: 'Họ và tên chủ sở hữu', owner_phone: 'Số điện thoại chủ sở hữu', owner_tax_code: 'Mã số thuế',
  new_address_country: 'Quốc gia', new_address_province: 'Tỉnh / Thành phố', new_address_district: 'Quận / Huyện', new_address_city: 'Thành phố', new_address_ward: 'Phường / Xã', new_address_line: 'Địa chỉ chi tiết',
  category_ids: 'Danh mục', discount_pct: 'Tỷ lệ giảm giá cho khách', commission_pct: 'Tỷ lệ hoa hồng cho Đối tác',
};

/** API field name -> form field name (the rates are typed as percentages but stored as fractions). */
export const API_TO_FORM: Record<string, FieldName> = { merchant_discount_value: 'discount_pct', merchant_discount_type: 'discount_pct', merchant_commission_value: 'commission_pct', merchant_commission_type: 'commission_pct' };
export const formFieldOf = (apiField: string): FieldName | null => (API_TO_FORM[apiField] ?? ((apiField in FIELD_LABEL) ? (apiField as FieldName) : null));

// Same pattern as the API's e-mail check (zod 4): no leading/trailing/double dots in the part before "@", a real domain after it.
const EMAIL = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
const MAX: Partial<Record<FieldName, number>> = { merchant_name: 200, merchant_description: 20000, owner_name: 200, owner_phone: 20, merchant_contact_phone: 20, merchant_phone: 20, owner_tax_code: 100,
  new_address_country: 200, new_address_province: 200, new_address_district: 200, new_address_city: 200, new_address_ward: 200, new_address_line: 1000 };

export const normalise = (value: string) => value.trim();
const pctOk = (v: string) => /^\d{1,3}([.,]\d{1,2})?$/.test(v) && Number(v.replace(',', '.')) <= 100;

/** Vietnamese message for ONE field's current value, or null when it is fine. Blank optional fields are fine. */
export function validateField(name: FieldName, raw: string | string[]): string | null {
  if (name === 'category_ids') { const ids = raw as string[]; return ids.length > 3 || new Set(ids).size !== ids.length ? 'Chọn tối đa 3 danh mục, không chọn trùng.' : null; }
  const v = normalise(raw as string);
  if (name === 'merchant_name') return v === '' ? 'Tên doanh nghiệp không được để trống.' : v.length > 200 ? 'Tên doanh nghiệp tối đa 200 ký tự.' : null;
  if (name === 'discount_pct' || name === 'commission_pct') return v === '' || pctOk(v) ? null : `${FIELD_LABEL[name]} phải là số từ 0 đến 100 (tối đa 2 chữ số thập phân), ví dụ 5 hoặc 7,5.`;
  if (v === '') return null;
  if (name === 'merchant_email') return EMAIL.test(v) ? null : 'Email không hợp lệ. Hãy nhập dạng ten@congty.vn (không có dấu chấm ngay trước @, không có khoảng trắng) hoặc để trống.';
  if (name === 'merchant_phone' && (v.length < 7 || v.length > 20)) return 'Số điện thoại phải có từ 7 đến 20 ký tự (có thể gồm +, khoảng trắng, dấu -). Để trống nếu chưa có.';
  const max = MAX[name]; if (max && v.length > max) return `${FIELD_LABEL[name]} tối đa ${max} ký tự.`;
  return null;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);

/** Fields whose value differs from what was loaded (trimmed; null and "" are the same). */
export function changedFields(loaded: ProfileForm, current: ProfileForm): FieldName[] {
  return (Object.keys(FIELD_LABEL) as FieldName[]).filter((k) => {
    if (k === 'category_ids') return !sameSet(loaded.category_ids, current.category_ids);
    if (k === 'discount_pct' || k === 'commission_pct') return normalise(current[k]) !== '' && normalise(current[k]).replace(',', '.') !== normalise(loaded[k]);   // blank rate = leave as it is
    return normalise(current[k] as string) !== normalise(loaded[k] as string);
  });
}

/** Percentage points -> the fraction the API stores ("5" -> "0.0500", "7,5" -> "0.0750"). */
export function pctToFraction(pct: string): string {
  const [w, f = ''] = normalise(pct).replace(',', '.').split('.');
  const hundredths = `${w}${f.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  const padded = hundredths.padStart(5, '0');
  return `${padded.slice(0, -4)}.${padded.slice(-4)}`;
}

export type PatchResult = { changed: FieldName[]; errors: Partial<Record<FieldName, string>>; payload: Record<string, unknown> };

/** What to send: ONLY the changed fields, each already validated; or the per-field errors. No changes -> empty payload. */
export function buildPatch(loaded: ProfileForm, current: ProfileForm): PatchResult {
  const changed = changedFields(loaded, current); const errors: Partial<Record<FieldName, string>> = {}; const payload: Record<string, unknown> = {};
  for (const k of changed) {
    const problem = validateField(k, current[k]); if (problem) { errors[k] = problem; continue; }
    if (k === 'category_ids') payload.category_ids = current.category_ids;
    else if (k === 'discount_pct') { payload.merchant_discount_type = 'percentage'; payload.merchant_discount_value = pctToFraction(current.discount_pct); }
    else if (k === 'commission_pct') { payload.merchant_commission_type = 'percentage'; payload.merchant_commission_value = pctToFraction(current.commission_pct); }
    else { const v = normalise(current[k] as string); payload[k] = v === '' && k !== 'merchant_name' && k !== 'merchant_description_format' ? null : v; }
  }
  return { changed, errors, payload };
}

/** Problems already present in the SAVED profile (legacy data): shown as a gentle warning, never as a blocker. */
export function legacyProblems(loaded: ProfileForm): Partial<Record<FieldName, string>> {
  const out: Partial<Record<FieldName, string>> = {};
  for (const k of ['merchant_email', 'merchant_phone', 'merchant_contact_phone', 'owner_phone'] as FieldName[]) {
    const v = normalise(loaded[k] as string);
    if (k === 'merchant_phone' && v === '') { out[k] = 'Hồ sơ chưa có số điện thoại. Bạn có thể thêm khi có; các thay đổi khác vẫn lưu được.'; continue; }
    const problem = validateField(k, loaded[k]); if (problem) out[k] = `Giá trị đã lưu trước đây không hợp lệ (dữ liệu cũ): ${problem} Bạn vẫn lưu được các thay đổi khác.`;
  }
  return out;
}

export const savedMessage = (changed: FieldName[]) => changed.length ? `Đã lưu ${changed.length} thay đổi: ${changed.map((k) => FIELD_LABEL[k]).join(', ')}.` : 'Không có thay đổi nào để lưu.';
