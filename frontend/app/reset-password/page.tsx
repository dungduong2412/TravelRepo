'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { signOut, supabase, updateRecoveredPassword } from '../../lib/supabase';

const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (active && (event === 'PASSWORD_RECOVERY' || session)) setReady(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!strongPassword.test(password)) {
      setError('Mật khẩu phải có ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.');
      return;
    }
    if (password !== confirmation) {
      setError('Hai mật khẩu không khớp.');
      return;
    }

    setLoading(true);
    try {
      await updateRecoveredPassword(password);
      await signOut();
      setComplete(true);
    } catch {
      setError('Liên kết không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu liên kết mới.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center p-5">
      <section className="w-full max-w-md rounded-lg bg-white p-10 shadow">
        <h1 className="text-2xl font-bold text-gray-900 text-center">Đặt mật khẩu mới</h1>
        {complete ? (
          <div className="mt-8">
            <p className="rounded-md bg-green-50 p-4 text-sm text-green-800">
              Mật khẩu đã được cập nhật. Hãy đăng nhập lại.
            </p>
            <Link className="mt-6 block text-center text-sm text-rose-700" href="/login">
              Đăng nhập
            </Link>
          </div>
        ) : ready ? (
          <form className="mt-8 space-y-5" onSubmit={submit}>
            <label className="block text-sm font-medium text-gray-700">
              Mật khẩu mới
              <input
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Xác nhận mật khẩu
              <input
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
            </label>
            {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <button
              className="w-full rounded-md bg-rose-500 px-4 py-3 font-semibold text-white disabled:bg-gray-400"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}
            </button>
          </form>
        ) : (
          <div className="mt-8">
            <p className="rounded-md bg-amber-50 p-4 text-sm text-amber-800">
              Liên kết khôi phục không hợp lệ hoặc đã hết hạn.
            </p>
            <Link className="mt-6 block text-center text-sm text-rose-700" href="/forgot-password">
              Yêu cầu liên kết mới
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
