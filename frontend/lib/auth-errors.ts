/**
 * Maps Supabase Auth error CODES (see errorCode() in auth-diagnostics) to the right user-facing outcome.
 * "Expired link" copy is reserved for genuine token/session failures; policy and transport problems get their own messages.
 */
import { PASSWORD_ERROR } from './password-policy';

export type RecoveryFailure =
  | { kind: 'link_invalid'; text: string }
  | { kind: 'policy'; text: string }
  | { kind: 'same_password'; text: string }
  | { kind: 'rate_limited'; text: string }
  | { kind: 'network'; text: string }
  | { kind: 'unknown'; text: string };

const LINK_CODES = new Set([
  'otp_expired', 'otp_disabled', 'flow_state_expired', 'flow_state_not_found', 'validation_failed_token',
  'session_not_found', 'session_expired', 'refresh_token_not_found', 'refresh_token_already_used',
  'not_authenticated', 'bad_jwt', 'user_not_found', 'http_401', 'http_403', 'http_404', 'http_410',
]);

const LINK_TEXT = 'Liên kết không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới.';

export function classifyRecoveryError(code: string): RecoveryFailure {
  if (code === 'weak_password') return { kind: 'policy', text: PASSWORD_ERROR };
  if (code === 'same_password') return { kind: 'same_password', text: 'Mật khẩu mới phải khác mật khẩu hiện tại.' };
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || code === 'http_429') {
    return { kind: 'rate_limited', text: 'Bạn thao tác quá nhanh. Vui lòng đợi khoảng một phút rồi thử lại.' };
  }
  if (code === 'network_error' || code === 'unknown_error' || code.startsWith('http_5')) {
    return { kind: code === 'network_error' ? 'network' : 'unknown', text: 'Không thể kết nối hoặc có lỗi tạm thời. Mật khẩu chưa được thay đổi, hãy thử lại.' };
  }
  if (LINK_CODES.has(code)) return { kind: 'link_invalid', text: LINK_TEXT };
  return { kind: 'unknown', text: 'Không thể cập nhật mật khẩu lúc này. Mật khẩu chưa được thay đổi, hãy thử lại.' };
}

/** A token that failed to verify is always a link problem unless the failure was transport/rate related. */
export function classifyVerifyError(code: string): RecoveryFailure {
  const c = classifyRecoveryError(code);
  if (c.kind === 'rate_limited' || c.kind === 'network') return c;
  return { kind: 'link_invalid', text: LINK_TEXT };
}

/** Signup failures -> specific Vietnamese copy. Falls back to null so callers keep their own generic message. */
export function signupErrorMessage(code: string): string | null {
  if (code === 'user_already_exists' || code === 'email_exists') {
    return 'Email này đã được đăng ký. Hãy đăng nhập, hoặc dùng "Quên mật khẩu" nếu bạn không nhớ mật khẩu.';
  }
  if (code === 'weak_password') return PASSWORD_ERROR;
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || code === 'http_429') {
    return 'Email xác nhận vừa được gửi. Vui lòng đợi khoảng một phút rồi thử lại, và kiểm tra cả thư mục spam.';
  }
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'Địa chỉ email không hợp lệ.';
  return null;
}
