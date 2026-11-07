/**
 * Maps Supabase Auth error CODES (see errorCode() in auth-diagnostics) to the right user-facing outcome.
 * "Expired link" copy is reserved for genuine token/session failures; policy and transport problems get their own messages.
 */
import { PASSWORD_SERVER_REJECTED } from './password-policy';

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
  // Every caller validates with isValidPassword() first, so a server weak_password means a Supabase setting is stricter than the app policy.
  if (code === 'weak_password') return { kind: 'policy', text: PASSWORD_SERVER_REJECTED };
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

/** Password change for a signed-in user (Account settings, First password): accurate text per Auth error code, never raw English. */
export function passwordUpdateMessage(code: string): string {
  const c = classifyRecoveryError(code);
  if (c.kind === 'link_invalid') return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử đổi mật khẩu.';
  return c.text;
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
    return 'Email này đã được đăng ký. Hãy đăng nhập — nếu bạn đã xác nhận email nhưng chưa gửi hồ sơ, bạn sẽ được đưa tới bước hoàn tất hồ sơ. Nếu không nhớ mật khẩu, hãy dùng "Quên mật khẩu".';
  }
  if (code === 'weak_password') return PASSWORD_SERVER_REJECTED;
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || code === 'http_429') {
    // Supabase uses these codes both for the hourly project e-mail cap and the per-address resend gap, so never claim a mail WAS sent.
    return 'Hệ thống đang giới hạn việc gửi email xác nhận nên email có thể chưa được gửi. Hãy kiểm tra hộp thư và thư mục spam; nếu không thấy, vui lòng thử lại sau khoảng một giờ.';
  }
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'Địa chỉ email không hợp lệ.';
  return null;
}
