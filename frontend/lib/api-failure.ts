/**
 * Pure helpers (no I/O, no imports) that turn a failed API call into text a person can act on.
 * The HTTP status is always part of the text so the owner can quote it back and it can be matched with the server's HTTP log.
 * They read the fields set by ApiRequestError in lib/api.ts (httpStatus, apiCode) by shape, so this file stays free of the Supabase client.
 */
export type FailureKind = 'session' | 'forbidden' | 'invalid' | 'exists' | 'busy' | 'server' | 'network' | 'not_claimed' | 'other';
export type Failure = { kind: FailureKind; text: string; http?: number; code?: string };

type ApiShape = { httpStatus?: unknown; apiCode?: unknown; message?: unknown; name?: unknown };
const shape = (err: unknown): ApiShape => (err && typeof err === 'object' ? (err as ApiShape) : {});
const http = (err: unknown): number | undefined => { const s = shape(err).httpStatus; return typeof s === 'number' ? s : undefined; };
const apiCode = (err: unknown): string | undefined => { const c = shape(err).apiCode; return typeof c === 'string' && c ? c : undefined; };
const message = (err: unknown): string => { const m = shape(err).message; return typeof m === 'string' ? m.trim() : ''; };
const isNetwork = (err: unknown) => /TypeError|NetworkError/i.test(String(shape(err).name)) || /failed to fetch|networkerror|load failed|network request failed/i.test(message(err));

/** The profile submission ("Gửi hồ sơ") failed. `what` is the role label, e.g. "Đối tác". Every text starts by saying the application was NOT submitted. */
export function describeSubmitFailure(err: unknown, what: string): Failure {
  const status = http(err); const code = apiCode(err); const msg = message(err);
  const tail = (extra?: string) => `(HTTP ${status}${code ? ` · ${code}` : ''}${extra ? `: ${extra}` : ''})`;
  if (status === undefined) {
    if (isNetwork(err)) return { kind: 'network', text: 'Không kết nối được tới máy chủ nên hồ sơ CHƯA được gửi. Hãy kiểm tra mạng rồi bấm “Gửi hồ sơ” lại.' };
    return { kind: 'other', text: `${msg || 'Đã xảy ra lỗi'}. Hồ sơ CHƯA được gửi; hãy thử lại.` };
  }
  if (status === 409 || /already exists/i.test(msg)) return { kind: 'exists', http: status, code, text: `Email này đã có hồ sơ. Không thể tạo thêm hồ sơ mới. ${tail()}` };
  if (status === 401) return { kind: 'session', http: status, code, text: `Phiên đăng nhập đã hết hạn nên hồ sơ CHƯA được gửi. Hãy đăng nhập lại — bạn sẽ quay lại bước hoàn tất hồ sơ. ${tail()}` };
  if (status === 403) return { kind: 'forbidden', http: status, code, text: `Tài khoản này không được phép gửi hồ sơ ${what} nên hồ sơ CHƯA được gửi. Hãy đăng xuất rồi đăng nhập bằng đúng email đã xác nhận cho hồ sơ này. ${tail(msg)}` };
  if (status === 400 || status === 422) return { kind: 'invalid', http: status, code, text: `Thông tin hồ sơ chưa hợp lệ nên hồ sơ CHƯA được gửi${msg ? `: ${msg}` : ''}. Hãy sửa rồi bấm “Gửi hồ sơ” lại. ${tail()}` };
  if (status === 429) return { kind: 'busy', http: status, code, text: `Hệ thống đang nhận quá nhiều yêu cầu nên hồ sơ CHƯA được gửi. Đợi khoảng một phút rồi bấm “Gửi hồ sơ” lại. ${tail()}` };
  if (status >= 500) return { kind: 'server', http: status, code, text: `Máy chủ gặp lỗi nên hồ sơ CHƯA được gửi. Hãy thử lại sau ít phút; nếu vẫn lỗi, hãy gửi mã lỗi này cho quản trị viên. ${tail(msg)}` };
  return { kind: 'other', http: status, code, text: `Hồ sơ CHƯA được gửi${msg ? `: ${msg}` : ''}. ${tail()}` };
}

/** An Admin action (approve / reject / deactivate) failed. English because the Admin screens are English; the record is always reported as unchanged. */
export function describeAdminActionFailure(err: unknown, action: 'approve' | 'reject' | 'deactivate'): Failure {
  const status = http(err); const code = apiCode(err); const msg = message(err);
  const verb = action === 'approve' ? 'Approval' : action === 'reject' ? 'Rejection' : 'Deactivation';
  if (status === undefined) {
    return isNetwork(err)
      ? { kind: 'network', text: `${verb} failed: the server could not be reached. Nothing was changed; check the connection and try again.` }
      : { kind: 'other', text: `${verb} failed: ${msg || 'unknown error'}. Nothing was changed.` };
  }
  const label = `HTTP ${status}${code ? ` · ${code}` : ''}`;
  if (status === 409 && code === 'OWNER_NOT_CLAIMED') {
    return { kind: 'not_claimed', http: status, code, text: `${verb} failed (${label}): this record has no verified owner account linked to it (typically an Admin-created or V1-imported record whose owner has not claimed it). It cannot be approved until the owner claims it with a verified e-mail. The record is unchanged and stays “Chờ phê duyệt” (pending).` };
  }
  if (status === 401 || status === 403) return { kind: status === 401 ? 'session' : 'forbidden', http: status, code, text: `${verb} failed (${label}): ${status === 401 ? 'your session has expired, sign in again' : 'this account is not allowed to do that'}. Nothing was changed.` };
  if (status >= 500) return { kind: 'server', http: status, code, text: `${verb} failed (${label}): the server reported an error${msg ? ` — ${msg}` : ''}. Nothing was changed; retry, and quote this code if it persists.` };
  return { kind: 'other', http: status, code, text: `${verb} failed (${label})${msg ? `: ${msg}` : ''}. The record is unchanged.` };
}
