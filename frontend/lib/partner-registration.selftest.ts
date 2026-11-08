// Run: npx tsx lib/partner-registration.selftest.ts   (pure functions only)
import assert from 'node:assert/strict';
import { SUCCESS_TEXT, activationFailure, existingNotice, normalisePhone, registrationFailure, tokenFromHash, validateRegistration, validationSummary, RESEND_ACCEPTED_TEXT } from './partner-registration';

const good = { fullName: 'Nguyễn Văn A', phone: '+84 912.345-678', email: 'a@b.test' };
assert.deepEqual(validateRegistration(good), {});
assert.equal(normalisePhone('+84 (912) 345-678'), '+84912345678');
assert.deepEqual(Object.keys(validateRegistration({ fullName: '', phone: '', email: '' })), ['fullName', 'phone', 'email']);
assert.ok(validateRegistration({ ...good, phone: '12345' }).phone);
assert.ok(validateRegistration({ ...good, phone: '09123abc78' }).phone);
assert.ok(validateRegistration({ ...good, email: 'nope' }).email);
assert.ok(validateRegistration({ ...good, fullName: 'A' }).fullName);
assert.match(validationSummary(validateRegistration({ fullName: '', phone: '1', email: 'x' })), /CHƯA được gửi.*Họ và Tên, Số Điện Thoại, Email/);

// the exact sentence the business asked for
assert.equal(SUCCESS_TEXT, 'Đăng ký thành công. Hồ sơ của bạn đang chờ phê duyệt. Chúng tôi sẽ gửi email khi tài khoản được kích hoạt.');

// existing-address states
assert.match(existingNotice('pending').title, /đang chờ phê duyệt/);
assert.match(existingNotice('active').body, /đăng nhập/i);
assert.match(existingNotice('support').body, /liên hệ Admin/);
for (const s of ['pending', 'active', 'support'] as const) assert.doesNotMatch(JSON.stringify(existingNotice(s)), /Nguy|@|COL-|merchant|collaborator/i, 'a state notice reveals nothing about the record');

// registration failures say nothing was created and quote the HTTP status
const api = (httpStatus: number, apiCode?: string) => Object.assign(new Error('x'), { httpStatus, apiCode });
assert.match(registrationFailure(new TypeError('Failed to fetch')), /CHƯA được gửi/);
assert.match(registrationFailure(api(429, 'REGISTRATION_RATE_LIMITED')), /HTTP 429 · REGISTRATION_RATE_LIMITED/);
assert.match(registrationFailure(api(500, 'REGISTRATION_FAILED')), /không có dữ liệu nào bị lưu.*HTTP 500/);

// activation failures
assert.equal(activationFailure(api(401, 'ACTIVATION_LINK_INVALID')).offerResend, true);
assert.equal(activationFailure(api(401, 'ACTIVATION_LINK_USED')).offerLogin, true);
assert.equal(activationFailure(api(403, 'ACTIVATION_NOT_APPROVED')).offerResend, false);
assert.equal(activationFailure(new TypeError('Failed to fetch')).retryable, true);
assert.equal(activationFailure(api(502, 'ACTIVATION_FAILED')).retryable, true);
assert.doesNotMatch(RESEND_ACCEPTED_TEXT, /đã gửi cho|không tìm thấy|chưa đăng ký/i, 'the resend answer is the same for every address');

// token comes from the fragment only
const tok = `${'a'.repeat(40)}.${'b'.repeat(43)}`;
assert.equal(tokenFromHash(`#token=${tok}`), tok);
assert.equal(tokenFromHash(`#x=1&token=${tok}`), tok);
assert.equal(tokenFromHash(''), null);
assert.equal(tokenFromHash('#token=short'), null);
assert.equal(tokenFromHash(`#token=${tok}<script>`), null);

console.log('partner-registration selftest: all assertions passed');
