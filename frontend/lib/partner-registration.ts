/**
 * Pure helpers (no I/O, no React, no Supabase) for the single-step Partner flow:
 *   register once -> Admin approves -> activation e-mail -> one click into the Partner Portal.
 * Everything a person reads in that journey is defined here, so it can be self-tested (see partner-registration.selftest.ts).
 */
export type RegistrationField = 'fullName' | 'phone' | 'email';
export type RegistrationInput = { fullName: string; phone: string; email: string };

export const FIELD_LABEL: Record<RegistrationField, string> = { fullName: 'Họ và Tên', phone: 'Số Điện Thoại', email: 'Email' };

/** The sentence the person must see after a successful registration. */
export const SUCCESS_TEXT = 'Đăng ký thành công. Hồ sơ của bạn đang chờ phê duyệt. Chúng tôi sẽ gửi email khi tài khoản được kích hoạt.';

/** Same rule as the API: separators are ignored, 9-15 digits, optional leading +. */
export const normalisePhone = (raw: string) => raw.replace(/[\s.\-()]/g, '');

export function validateRegistration(input: RegistrationInput): Partial<Record<RegistrationField, string>> {
  const errors: Partial<Record<RegistrationField, string>> = {};
  if (input.fullName.trim().length < 2) errors.fullName = 'Vui lòng nhập họ và tên đầy đủ.';
  if (!input.phone.trim()) errors.phone = 'Số điện thoại là bắt buộc.';
  else if (!/^\+?[0-9]{9,15}$/.test(normalisePhone(input.phone))) errors.phone = 'Số điện thoại phải có 9-15 chữ số (có thể bắt đầu bằng +).';
  if (!input.email.trim()) errors.email = 'Email là bắt buộc.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) errors.email = 'Email không hợp lệ.';
  return errors;
}

/** One sentence naming what is wrong, shown above the button and announced to screen readers. */
export function validationSummary(errors: Partial<Record<RegistrationField, string>>): string {
  const names = (Object.keys(errors) as RegistrationField[]).map((k) => FIELD_LABEL[k]);
  return `Đăng ký CHƯA được gửi vì còn thiếu hoặc sai thông tin: ${names.join(', ')}. Hãy sửa các ô được đánh dấu rồi bấm lại.`;
}

export type ExistingState = 'pending' | 'active' | 'support';
export type Notice = { tone: 'info' | 'success' | 'warning'; title: string; body: string };

/** What an already-registered address is told. Coarse on purpose: no name, role or record detail. */
export function existingNotice(state: ExistingState): Notice {
  if (state === 'pending') return { tone: 'info', title: 'Email này đã đăng ký và đang chờ phê duyệt', body: 'Không cần đăng ký lại. Chúng tôi sẽ gửi email khi tài khoản được kích hoạt.' };
  if (state === 'active') return { tone: 'success', title: 'Email này đã có tài khoản được kích hoạt', body: 'Hãy đăng nhập. Nếu bạn chưa vào được hoặc liên kết kích hoạt đã hết hạn, hãy yêu cầu gửi lại liên kết.' };
  return { tone: 'warning', title: 'Hồ sơ gắn với email này cần Admin hỗ trợ', body: 'Hồ sơ không ở trạng thái chờ hoặc đã hoạt động (ví dụ đã bị từ chối hoặc tạm khóa). Vui lòng liên hệ Admin VNO để được hỗ trợ; hệ thống sẽ không tạo hồ sơ mới.' };
}

type ApiShape = { httpStatus?: unknown; apiCode?: unknown; message?: unknown; name?: unknown };
const shape = (e: unknown): ApiShape => (e && typeof e === 'object' ? (e as ApiShape) : {});

/** The registration call failed. Every text says nothing was created and what to do; the HTTP status is quoted so it can be matched with the server log. */
export function registrationFailure(err: unknown): string {
  const s = shape(err); const status = typeof s.httpStatus === 'number' ? s.httpStatus : undefined; const code = typeof s.apiCode === 'string' ? s.apiCode : undefined;
  const tail = status ? ` (HTTP ${status}${code ? ` · ${code}` : ''})` : '';
  if (status === undefined) return 'Không kết nối được tới máy chủ nên đăng ký CHƯA được gửi. Hãy kiểm tra mạng rồi bấm “Đăng ký” lại.';
  if (status === 429) return `Bạn đã thử quá nhiều lần. Đăng ký CHƯA được gửi; hãy đợi vài phút rồi thử lại.${tail}`;
  if (status === 503) return `Hệ thống đang bận nên đăng ký CHƯA được gửi. Hãy thử lại sau ít phút.${tail}`;
  if (status === 400 || status === 422) return `Thông tin chưa hợp lệ nên đăng ký CHƯA được gửi. Hãy kiểm tra họ tên, số điện thoại và email.${tail}`;
  return `Máy chủ gặp lỗi nên đăng ký CHƯA được tạo và không có dữ liệu nào bị lưu. Hãy thử lại sau ít phút.${tail}`;
}

export type ActivationFailureView = { tone: 'warning' | 'danger' | 'info'; title: string; body: string; offerResend: boolean; offerLogin: boolean; retryable: boolean };

/** Why the activation link did not work, by the API's stable code. Expired / superseded / tampered all read the same on purpose. */
export function activationFailure(err: unknown): ActivationFailureView {
  const s = shape(err); const code = typeof s.apiCode === 'string' ? s.apiCode : undefined; const status = typeof s.httpStatus === 'number' ? s.httpStatus : undefined;
  if (code === 'ACTIVATION_LINK_USED') return { tone: 'info', title: 'Liên kết này đã được sử dụng', body: 'Mỗi liên kết chỉ dùng được một lần. Nếu bạn đã kích hoạt, hãy đăng nhập; nếu chưa vào được, bạn có thể yêu cầu liên kết mới.', offerResend: true, offerLogin: true, retryable: false };
  if (code === 'ACTIVATION_NOT_APPROVED') return { tone: 'info', title: 'Hồ sơ chưa được phê duyệt', body: 'Tài khoản chỉ kích hoạt được sau khi Admin phê duyệt. Chúng tôi sẽ gửi email khi sẵn sàng.', offerResend: false, offerLogin: false, retryable: false };
  if (code === 'ACTIVATION_RATE_LIMITED' || status === 429) return { tone: 'warning', title: 'Thử quá nhiều lần', body: 'Hãy đợi vài phút rồi mở lại liên kết trong email.', offerResend: false, offerLogin: false, retryable: true };
  if (code === 'ACTIVATION_LINK_INVALID' || status === 401) return { tone: 'warning', title: 'Liên kết không hợp lệ, đã hết hạn hoặc đã được sử dụng', body: 'Liên kết kích hoạt có thời hạn và chỉ dùng được một lần (một số ứng dụng email mở thử liên kết và làm nó hết hiệu lực). Hãy yêu cầu liên kết mới bên dưới; liên kết cũ sẽ ngừng hoạt động.', offerResend: true, offerLogin: false, retryable: false };
  if (status === undefined) return { tone: 'danger', title: 'Không kết nối được tới máy chủ', body: 'Chưa rõ liên kết đã được xử lý hay chưa. Hãy kiểm tra mạng rồi thử lại; nếu báo liên kết đã dùng hoặc hết hạn, hãy yêu cầu liên kết mới.', offerResend: false, offerLogin: false, retryable: true };
  return { tone: 'danger', title: 'Không thể hoàn tất kích hoạt', body: `Máy chủ gặp lỗi (HTTP ${status}${code ? ` · ${code}` : ''}). Hãy thử lại; nếu vẫn lỗi, yêu cầu liên kết mới.`, offerResend: true, offerLogin: false, retryable: true };
}

/** The answer to "send me a new link" is identical for every address, so it cannot be used to find out who is registered. */
export const RESEND_ACCEPTED_TEXT = 'Nếu email này thuộc một tài khoản Đối tác đã được phê duyệt và chưa kích hoạt, chúng tôi vừa gửi liên kết mới. Hãy kiểm tra hộp thư (cả mục Spam). Liên kết cũ không còn dùng được.';

/** Reads the token from "#token=..." (a URL fragment never reaches a server, a log or a Referer header). */
export function tokenFromHash(hash: string): string | null {
  const m = /^#?(?:.*&)?token=([A-Za-z0-9_-]{20,600}\.[A-Za-z0-9_-]{20,200})(?:&.*)?$/.exec(hash || '');
  return m ? m[1] : null;
}
