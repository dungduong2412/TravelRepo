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
    return 'Email này đã được đăng ký. Hãy đăng nhập, hoặc dùng "Quên mật khẩu" nếu bạn không nhớ mật khẩu.';
  }
  if (code === 'weak_password') return PASSWORD_SERVER_REJECTED;
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || code === 'http_429') {
    return 'Email xác nhận vừa được gửi. Vui lòng đợi khoảng một phút rồi thử lại, và kiểm tra cả thư mục spam.';
  }
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'Địa chỉ email không hợp lệ.';
  return null;
}

/**
 * Resume-onboarding sign-in (direct Supabase Auth password grant, NOT the business-profile-gated /auth/login).
 * Invalid credentials and unknown address are deliberately indistinguishable.
 */
export function resumeErrorMessage(code: string): string {
  if (code === 'invalid_credentials' || code === 'user_not_found' || code === 'http_400') {
    return 'Email hoặc mật khẩu không đúng. Hãy kiểm tra lại, hoặc dùng "Quên mật khẩu" nếu bạn không nhớ mật khẩu đã đăng ký.';
  }
  if (code === 'email_not_confirmed') {
    return 'Email này chưa được xác nhận. Hãy mở liên kết trong email xác nhận đã gửi cho bạn (kiểm tra cả thư mục spam), rồi quay lại đây.';
  }
  if (code === 'user_banned') return 'Tài khoản này đang bị khóa. Vui lòng liên hệ quản trị viên.';
  if (code === 'over_request_rate_limit' || code === 'http_429') return 'Bạn thao tác quá nhanh. Vui lòng đợi khoảng một phút rồi thử lại.';
  if (code === 'network_error' || code.startsWith('http_5')) return 'Không thể kết nối. Hãy kiểm tra mạng và thử lại.';
  return 'Không thể tiếp tục hồ sơ lúc này. Hãy thử lại.';
}

/** Sign-up form hit an address that already has an Auth user: point to Resume instead of the generic login advice. */
export const ALREADY_REGISTERED_RESUME_TEXT =
  'Email này đã được đăng ký. Nếu bạn đã xác nhận email, hãy bấm “Tiếp tục hồ sơ” bên dưới và nhập mật khẩu đã đăng ký; không cần email xác nhận mới. Nếu không nhớ mật khẩu, hãy dùng "Quên mật khẩu".';
