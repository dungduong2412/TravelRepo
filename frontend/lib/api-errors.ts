import { ApiFieldError, ApiRequestError } from './api';

/**
 * One place that turns an API failure into text a person can act on.
 *  - field errors (HTTP 400 VALIDATION_FAILED) -> the API's own Vietnamese sentences, one per field
 *  - a business error with a Vietnamese message (media, QR, ...) -> that message
 *  - anything else -> the caller's fallback (never a raw "Validation failed" / English server text)
 */
export function fieldErrorsOf(err: unknown): ApiFieldError[] {
  return err instanceof ApiRequestError ? err.fieldErrors : [];
}

const hasVietnamese = (text: string) => /[À-ỹ]/.test(text);

export function describeApiError(err: unknown, fallback: string): string {
  const fields = fieldErrorsOf(err);
  if (fields.length) return fields.map((f) => f.message).join(' ');
  if (err instanceof ApiRequestError) {
    if (err.httpStatus === 401) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
    if (err.httpStatus === 403) return 'Bạn không có quyền thực hiện thao tác này.';
    if (err.httpStatus === 429) return 'Bạn thao tác quá nhanh. Hãy đợi một chút rồi thử lại.';
    if (err.httpStatus >= 500) return `${fallback} (lỗi máy chủ, mã ${err.httpStatus}). Hãy thử lại sau ít phút.`;
    if (hasVietnamese(err.message)) return err.message;
    return fallback;
  }
  if (err instanceof TypeError || /failed to fetch|network/i.test(String((err as Error)?.message))) return 'Không kết nối được tới máy chủ. Hãy kiểm tra mạng rồi thử lại.';
  const message = (err as Error)?.message;
  return message && hasVietnamese(message) ? message : fallback;
}
