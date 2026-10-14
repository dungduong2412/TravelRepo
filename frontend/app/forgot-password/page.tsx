'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { requestPasswordReset } from '../../lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      await requestPasswordReset(
        email.trim(),
        `${window.location.origin}/reset-password`,
      );
      setSubmitted(true);
    } catch {
      // Keep the UI non-enumerating while still handling transport failures.
      setError('Không thể gửi yêu cầu lúc này. Vui lòng thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center p-5">
      <section className="w-full max-w-md rounded-lg bg-white p-10 shadow">
        <h1 className="text-2xl font-bold text-gray-900 text-center">Khôi phục mật khẩu</h1>
        <p className="mt-2 text-sm text-gray-600 text-center">
          Nhập email tài khoản để nhận liên kết đặt lại mật khẩu.
        </p>

        {submitted ? (
          <div className="mt-8">
            <p className="rounded-md bg-green-50 p-4 text-sm text-green-800">
              Nếu email thuộc một tài khoản hợp lệ, hướng dẫn khôi phục đã được gửi.
            </p>
            <Link className="mt-6 block text-center text-sm text-rose-700" href="/login">
              Quay lại đăng nhập
            </Link>
          </div>
        ) : (
          <form className="mt-8 space-y-5" onSubmit={submit}>
            <label className="block text-sm font-medium text-gray-700">
              Email
              <input
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <button
              className="w-full rounded-md bg-rose-500 px-4 py-3 font-semibold text-white disabled:bg-gray-400"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Đang gửi...' : 'Gửi liên kết khôi phục'}
            </button>
            <Link className="block text-center text-sm text-rose-700" href="/login">
              Quay lại đăng nhập
            </Link>
          </form>
        )}
      </section>
    </main>
  );
}
