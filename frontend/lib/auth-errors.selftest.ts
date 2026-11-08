import assert from 'node:assert/strict';
import { classifyRecoveryError, classifyVerifyError, signupErrorMessage } from './auth-errors';
import { errorCode } from './auth-diagnostics';
import { decideLoginFollowUp } from './login-followup';
import { describeAdminActionFailure, describeSubmitFailure } from './api-failure';
import { isKnownStatus, PENDING_LABEL, statusLabel } from './status-labels';
assert.equal(classifyRecoveryError('weak_password').kind, 'policy');
// weak_password reaches here only AFTER the client policy passed: it must say so, and must never ask for a more complex password.
assert.match(classifyRecoveryError('weak_password').text, /đã đáp ứng quy tắc/);
assert.ok(!/phức tạp|chữ hoa|ký tự đặc biệt/.test(classifyRecoveryError('weak_password').text));
assert.ok(!/hết hạn/.test(classifyRecoveryError('weak_password').text), 'policy failure must not say expired');
assert.equal(classifyRecoveryError('same_password').kind, 'same_password');
for (const c of ['session_not_found', 'otp_expired', 'http_401', 'refresh_token_not_found']) assert.equal(classifyRecoveryError(c).kind, 'link_invalid', c);
for (const c of ['over_request_rate_limit', 'over_email_send_rate_limit', 'http_429']) assert.equal(classifyRecoveryError(c).kind, 'rate_limited', c);
assert.equal(classifyRecoveryError('network_error').kind, 'network');
assert.equal(classifyRecoveryError('http_503').kind, 'unknown');
assert.equal(classifyRecoveryError('something_new').kind, 'unknown');
assert.equal(classifyVerifyError('otp_expired').kind, 'link_invalid');
assert.equal(classifyVerifyError('something_new').kind, 'link_invalid');
assert.equal(classifyVerifyError('http_429').kind, 'rate_limited');
assert.equal(errorCode({ code: 'otp_expired' }), 'otp_expired');
assert.equal(errorCode({ status: 422 }), 'http_422');
assert.equal(errorCode(new Error('secret token abc')), 'unknown_error');
assert.equal(errorCode({ code: 'Bad Code With Spaces & token=abc' }), 'unknown_error', 'free text can never become a code');
// Registered e-mail on a sign-up form: one calm message that names Login + Forgot password; never a second sign-up, never "link expired".
for (const c of ['user_already_exists', 'email_exists']) {
  const m = signupErrorMessage(c) || '';
  assert.match(m, /đã được đăng ký/); assert.match(m, /đăng nhập/); assert.match(m, /Quên mật khẩu/); assert.ok(!/hết hạn/.test(m));
}
// E-mail send rate limit: must not claim a mail was sent, must say what to do.
for (const c of ['over_email_send_rate_limit', 'over_request_rate_limit', 'http_429']) {
  const m = signupErrorMessage(c) || '';
  assert.ok(!/vừa được gửi/.test(m), c); assert.match(m, /chưa được gửi/); assert.match(m, /thử lại/);
}
// Failed normal login of a VALID password: where does the person go? (decideLoginFollowUp is pure; the network part lives in login-followup.ts)
assert.deepEqual(decideLoginFollowUp({ confirmed: true, profile: null, requestedRole: 'collaborator' }), { kind: 'onboarding', role: 'collaborator', path: '/collaborator/onboard' });
assert.deepEqual(decideLoginFollowUp({ confirmed: true, profile: null, requestedRole: 'merchant' }), { kind: 'onboarding', role: 'merchant', path: '/merchant/onboard' });
assert.equal(decideLoginFollowUp({ confirmed: true, profile: null, requestedRole: undefined }).kind, 'none', 'unknown role: no guessing');
assert.equal(decideLoginFollowUp({ confirmed: true, profile: null, requestedRole: 'admin' }).kind, 'none', 'never route to onboarding for another role');
assert.equal(decideLoginFollowUp({ confirmed: false, profile: null, requestedRole: 'merchant' }).kind, 'email_not_confirmed');
assert.equal(decideLoginFollowUp({ confirmed: true, profile: { role: 'merchant', user_profiles_status: 'pending' }, requestedRole: 'merchant' }).kind, 'pending');
assert.equal(decideLoginFollowUp({ confirmed: true, profile: { role: 'collaborator', user_profiles_status: 'blocked' }, requestedRole: 'collaborator' }).kind, 'inactive');
assert.equal(decideLoginFollowUp({ confirmed: true, profile: { role: 'collaborator', user_profiles_status: 'active' }, requestedRole: 'collaborator' }).kind, 'none', 'an approved profile is not this helper\'s business');

// --- Step 2/2 submit failures: every text says the application was NOT submitted, and the HTTP status is always quotable ---
const api = (httpStatus: number, message: string, apiCode?: string) => Object.assign(new Error(message), { httpStatus, apiCode });
for (const [status, kind] of [[401, 'session'], [403, 'forbidden'], [400, 'invalid'], [422, 'invalid'], [429, 'busy'], [500, 'server'], [503, 'server'], [409, 'exists']] as const) {
  const f = describeSubmitFailure(api(status, 'x'), 'Đối tác');
  assert.equal(f.kind, kind, `status ${status}`);
  assert.ok(f.text.includes(`HTTP ${status}`), `status ${status} must be in the text`);
  if (kind !== 'exists') assert.match(f.text, /CHƯA được gửi/, `status ${status} must say not submitted`);
}
assert.equal(describeSubmitFailure(api(400, 'Verified signup identity is required'), 'Đối tác').text.includes('Verified signup identity is required'), true, 'the server reason is shown');
assert.equal(describeSubmitFailure(api(400, 'A collaborator application already exists for this identity'), 'Đối tác').kind, 'exists');
assert.equal(describeSubmitFailure(new TypeError('Failed to fetch'), 'Đối tác').kind, 'network');
assert.match(describeSubmitFailure(new TypeError('Failed to fetch'), 'Đối tác').text, /CHƯA được gửi/);
assert.equal(describeSubmitFailure(new Error('boom'), 'Đối tác').kind, 'other');
// an API error must NOT be mistaken for a Supabase Auth error: errorCode() still ignores it, so the e-mail rate-limit copy is never shown for a profile submit
assert.equal(errorCode(api(429, 'x')), 'unknown_error');
assert.equal(signupErrorMessage(errorCode(api(429, 'x'))), null);

// --- Admin approve/reject: the 409 the owner hit is explained and says the record is unchanged ---
const notClaimed = describeAdminActionFailure(api(409, 'Cannot approve partner: the owner has not claimed this record with a verified Auth identity', 'OWNER_NOT_CLAIMED'), 'approve');
assert.equal(notClaimed.kind, 'not_claimed');
assert.ok(notClaimed.text.includes('HTTP 409 · OWNER_NOT_CLAIMED') && notClaimed.text.includes('Chờ phê duyệt') && /unchanged/.test(notClaimed.text));
assert.equal(describeAdminActionFailure(api(500, 'db'), 'approve').kind, 'server');
assert.equal(describeAdminActionFailure(api(401, 'x'), 'reject').kind, 'session');
assert.equal(describeAdminActionFailure(new TypeError('Failed to fetch'), 'deactivate').kind, 'network');

// --- one vocabulary: database "pending" is displayed as "Chờ phê duyệt" everywhere, never "Pending" / "chờ duyệt" ---
assert.equal(PENDING_LABEL, 'Chờ phê duyệt');
assert.equal(statusLabel('pending'), 'Chờ phê duyệt');
assert.equal(statusLabel(' PENDING '), 'Chờ phê duyệt');
assert.equal(statusLabel('active'), 'Đã duyệt');
assert.equal(statusLabel(null), 'Chưa xác định');
assert.match(statusLabel('0'), /Trạng thái cũ: 0/, 'legacy numeric statuses stay visible');
assert.ok(isKnownStatus('pending') && !isKnownStatus('0'));
for (const k of ['pending', 'active', 'approved', 'inactive', 'blocked', 'rejected', 'cancelled']) assert.ok(!/chờ duyệt/i.test(statusLabel(k)), k);

console.log('auth-errors selftest: all passed');
