import assert from 'node:assert/strict';
import { classifyRecoveryError, classifyVerifyError, signupErrorMessage } from './auth-errors';
import { errorCode } from './auth-diagnostics';
import { decideLoginFollowUp } from './login-followup';
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
console.log('auth-errors selftest: all passed');
