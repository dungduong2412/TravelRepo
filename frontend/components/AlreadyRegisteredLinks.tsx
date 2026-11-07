"use client";

import Link from 'next/link';

/**
 * The only two ways forward for an e-mail that already has an account: log in, or reset the password.
 * (Logging in with a confirmed e-mail that never submitted its business profile continues at the onboarding page.)
 */
export default function AlreadyRegisteredLinks() {
  const link = { color: '#1d4ed8', textDecoration: 'underline' } as const;
  return <p style={{ fontSize: 14, color: '#374151', margin: '16px 0 0' }}>
    Đã có tài khoản? <Link href="/login" style={link}>Đăng nhập</Link> · <Link href="/forgot-password" style={link}>Quên mật khẩu</Link>
  </p>;
}
