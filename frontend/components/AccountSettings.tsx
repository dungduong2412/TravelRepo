"use client";

import { FormEvent, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AccountSettings() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage(null);
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) return setMessage({ type: 'error', text: 'Mật khẩu cần ít nhất 12 ký tự, chữ hoa, chữ thường và chữ số.' });
    if (password !== confirmPassword) return setMessage({ type: 'error', text: 'Mật khẩu xác nhận không khớp.' });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setMessage({ type: 'error', text: error.message || 'Không thể đổi mật khẩu.' });
    setPassword(''); setConfirmPassword(''); setMessage({ type: 'success', text: 'Đã cập nhật mật khẩu.' });
  }

  return <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
    <h1 className="text-2xl font-bold">Tài khoản & bảo mật</h1>
    <p className="mt-2 text-sm text-slate-600">Đổi mật khẩu cho tài khoản đang đăng nhập. Vai trò và đơn vị liên kết chỉ Platform Admin được quản lý.</p>
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-sm font-semibold">Mật khẩu mới<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3" required /></label>
      <label className="block text-sm font-semibold">Nhập lại mật khẩu<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3" required /></label>
      {message && <p role="alert" className={`rounded-xl p-3 text-sm ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{message.text}</p>}
      <button disabled={busy} className="min-h-11 rounded-xl bg-rose-600 px-5 font-semibold text-white disabled:opacity-60">{busy ? 'Đang cập nhật…' : 'Đổi mật khẩu'}</button>
    </form>
  </section>;
}
