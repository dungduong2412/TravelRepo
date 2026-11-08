import { ZodError } from 'zod';

/**
 * Field-level validation errors for the API.
 *
 * Every schema failure becomes `{ field, code, message }` where `message` is a short, actionable VIETNAMESE sentence naming the field a person
 * recognises on screen (not the database column). The HTTP body keeps `message: "Validation failed"` for existing clients and adds
 * `code: "VALIDATION_FAILED"` and `errors: [...]`, so a screen can put each message under the right input.
 */
export type FieldError = { field: string; code: string; message: string };

const LABELS: Record<string, string> = {
  // Merchant profile
  merchant_name: 'Tên doanh nghiệp', merchant_email: 'Email', merchant_phone: 'Số điện thoại', merchant_contact_phone: 'SĐT liên hệ',
  merchant_description: 'Mô tả', merchant_description_format: 'Định dạng mô tả', merchant_category: 'Danh mục',
  owner_name: 'Họ và tên chủ sở hữu', owner_phone: 'Số điện thoại chủ sở hữu', owner_tax_code: 'Mã số thuế',
  new_address_country: 'Quốc gia', new_address_province: 'Tỉnh / Thành phố', new_address_district: 'Quận / Huyện', new_address_city: 'Thành phố',
  new_address_ward: 'Phường / Xã', new_address_line: 'Địa chỉ chi tiết', category_ids: 'Danh mục',
  merchant_discount_value: 'Tỷ lệ giảm giá cho khách', merchant_commission_value: 'Tỷ lệ hoa hồng cho Đối tác',
  merchant_discount_type: 'Loại giảm giá', merchant_commission_type: 'Loại hoa hồng',
  // Partner
  collaborators_name: 'Họ và tên', collaborators_phone: 'Số điện thoại', collaborators_email: 'Email', merchant_system_id: 'Nhà cung cấp',
  collaborators_bank_name: 'Tên ngân hàng', collaborators_bank_acc_name: 'Tên chủ tài khoản', collaborators_bank_acc_number: 'Số tài khoản',
  // Media
  filename: 'Tên tệp', mime_type: 'Loại tệp', size_bytes: 'Kích thước ảnh', base64_data: 'Nội dung ảnh', target_media_id: 'Ảnh đích', slot: 'Vị trí ảnh', action: 'Thao tác',
  // Transactions / QR
  gross_amount: 'Giá trị hoá đơn', collaborator_code: 'Mã Đối tác', payload: 'Nội dung mã QR', scan_id: 'Mã lượt quét',
};

export const fieldLabel = (field: string) => LABELS[field.split('.')[0]] ?? field;

/** Hints that make the sentence actionable for the fields people actually mistype. */
const HINTS: Record<string, { tooSmall?: string; tooBig?: string; invalid?: string }> = {
  size_bytes: { tooBig: 'Ảnh quá lớn. Kích thước tối đa là 5 MB.', invalid: 'Kích thước ảnh không hợp lệ.' },
  mime_type: { invalid: 'Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.' },
  base64_data: { tooBig: 'Ảnh quá lớn. Kích thước tối đa là 5 MB.', invalid: 'Nội dung ảnh không hợp lệ. Hãy chọn lại ảnh.' },
  merchant_name: { tooSmall: 'Tên doanh nghiệp không được để trống.' },
  merchant_phone: { tooSmall: 'Số điện thoại phải có từ 7 đến 20 ký tự (có thể gồm +, khoảng trắng, dấu -). Để trống nếu chưa có.' },
  merchant_contact_phone: { tooSmall: 'SĐT liên hệ phải có từ 7 đến 20 ký tự. Để trống nếu chưa có.' },
  owner_phone: { tooSmall: 'Số điện thoại chủ sở hữu phải có từ 7 đến 20 ký tự. Để trống nếu chưa có.' },
  merchant_email: { invalid: 'Email không hợp lệ. Hãy nhập dạng ten@congty.vn (không có dấu chấm ngay trước @, không có khoảng trắng) hoặc để trống.' },
  collaborators_email: { invalid: 'Email không hợp lệ. Hãy nhập dạng ten@congty.vn.' },
  merchant_discount_value: { invalid: 'Tỷ lệ giảm giá phải là số từ 0 đến 100 (tối đa 2 chữ số thập phân), ví dụ 5 hoặc 7,5.' },
  merchant_commission_value: { invalid: 'Tỷ lệ hoa hồng phải là số từ 0 đến 100 (tối đa 2 chữ số thập phân), ví dụ 10 hoặc 7,5.' },
  category_ids: { invalid: 'Chọn tối đa 3 danh mục, không chọn trùng.', tooSmall: 'Chọn tối đa 3 danh mục, không chọn trùng.' },
};

export function describeIssue(issue: any): FieldError {
  const path: Array<string | number> = Array.isArray(issue.path) ? issue.path : [];
  const field = path.join('.') || '_';
  const root = String(path[0] ?? '');
  const label = fieldLabel(field);
  const hint = HINTS[root] ?? {};
  const code = String(issue.code || 'invalid');
  const origin = String(issue.origin || '');
  const min = issue.minimum !== undefined ? Number(issue.minimum) : undefined;
  const max = issue.maximum !== undefined ? Number(issue.maximum) : undefined;
  let message: string;
  if (code === 'unrecognized_keys') {
    const keys = Array.isArray(issue.keys) ? issue.keys.join(', ') : '';
    return { field: '_', code, message: `Trường không được hỗ trợ: ${keys || 'không xác định'}.` };
  } else if (code === 'too_small') {
    if (origin === 'array') message = hint.tooSmall ?? `${label}: chọn ít nhất ${min} mục.`;
    else if (origin === 'string' && (min === 1)) message = `${label} không được để trống.`;
    else if (origin === 'string') message = hint.tooSmall ?? `${label} phải có ít nhất ${min} ký tự.`;
    else message = `${label} phải từ ${min} trở lên.`;
  } else if (code === 'too_big') {
    if (origin === 'array') message = hint.tooSmall ?? `${label}: chọn tối đa ${max} mục.`;
    else if (hint.tooBig) message = hint.tooBig;
    else if (origin === 'string') message = `${label} tối đa ${max} ký tự.`;
    else message = `${label} không được vượt quá ${max}.`;
  } else if (code === 'invalid_format') {
    message = String(issue.format) === 'email' ? (hint.invalid ?? `${label} không hợp lệ (ví dụ: ten@congty.vn).`) : (hint.invalid ?? `${label} không đúng định dạng.`);
  } else if (code === 'invalid_type') {
    message = `${label} không đúng kiểu dữ liệu.`;
  } else if (code === 'invalid_value') {
    message = hint.invalid ?? `${label} có giá trị không được hỗ trợ.`;
  } else {
    message = hint.invalid ?? `${label} không hợp lệ.`;
  }
  return { field, code, message };
}

export function describeZodError(error: unknown): FieldError[] {
  const issues = (error as ZodError)?.issues;
  if (!Array.isArray(issues)) return [];
  // One message per field is enough for a person: keep the first, in schema order.
  const seen = new Set<string>(); const out: FieldError[] = [];
  for (const issue of issues) { const e = describeIssue(issue); const key = e.field; if (seen.has(key)) continue; seen.add(key); out.push(e); }
  return out;
}
