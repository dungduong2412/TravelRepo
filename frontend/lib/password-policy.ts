/**
 * Shared password policy for all signup and password-change surfaces.
 *
 * Policy: minimum 8 characters, at least one letter (a–z / A–Z) and at least one digit.
 * No uppercase or special-character requirement.
 *
 * Keep this in sync with:
 *   - backend/src/modules/user-profiles/user-profiles.dto.ts  (CreateManagedUserProfileSchema.password)
 *   - Supabase Auth Dashboard → Auth → Password (minimum length 8, "Letters and digits")
 */
export const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/;

/** Vietnamese error shown when the user's password doesn't meet the policy. */
export const PASSWORD_ERROR =
  'Mật khẩu phải có ít nhất 8 ký tự, gồm ít nhất 1 chữ cái và 1 chữ số';

/**
 * Shown only when the client check already passed (so the password DOES meet the policy) but Supabase Auth still answered
 * `weak_password`. That is a server-configuration mismatch, never a reason to ask for a more complex password.
 */
export const PASSWORD_SERVER_REJECTED =
  'Hệ thống xác thực không chấp nhận mật khẩu này dù đã đáp ứng quy tắc (ít nhất 8 ký tự, 1 chữ cái, 1 chữ số). Mật khẩu chưa được lưu. Vui lòng liên hệ quản trị viên.';

/** Short hint shown beneath the password field. */
export const PASSWORD_HINT = 'Ít nhất 8 ký tự, gồm ít nhất 1 chữ cái và 1 chữ số.';

/** Returns true when the password satisfies the policy. */
export function isValidPassword(password: string): boolean {
  return PASSWORD_REGEX.test(password);
}
