'use client';

import { FormEvent, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Field } from './ui/Form';
import { Alert } from './ui/Feedback';
import { Button } from './ui/Button';
import { isValidPassword, PASSWORD_ERROR, PASSWORD_HINT } from '../lib/password-policy';

/**
 * An account created by an admin invitation has no password. This form is rendered only after the server has accepted the claim for the
 * verified, signed-in identity. `required` removes the skip: the person must leave onboarding with a usable sign-in method.
 * (The password itself is set by Supabase Auth for the current session; "password_set" is a UX marker, not a security control.)
 */
export function FirstPasswordForm({ required, onDone }: { required: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (!isValidPassword(password)) return setError(PASSWORD_ERROR);
    if (password !== confirmation) return setError('Hai mật khẩu không khớp.');
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password, data: { password_set: true } });
    setBusy(false);
    if (updateError) return setError('Không thể đặt mật khẩu lúc này. Hãy thử lại; nếu vẫn lỗi, đăng xuất rồi dùng "Quên mật khẩu".');
    setSaved(true);
  };

  if (saved) return (<><Alert tone="success" title="Đã đặt mật khẩu">Lần sau bạn có thể đăng nhập bằng email và mật khẩu này.</Alert><Button className="w-full" onClick={onDone}>Vào không gian làm việc</Button></>);
  return (
    <form className="space-y-4" onSubmit={submit} aria-label="Đặt mật khẩu lần đầu">
      {required
        ? <Alert tone="warning" title="Cần đặt mật khẩu để hoàn tất">Tài khoản được tạo từ lời mời chưa có mật khẩu. Hãy đặt mật khẩu để có thể đăng nhập lần sau.</Alert>
        : <p className="text-sm text-ink-muted">Đặt mật khẩu để đăng nhập những lần sau. Bạn cũng có thể bỏ qua và dùng &quot;Quên mật khẩu&quot; khi cần.</p>}
      <Field id="first-password" label="Mật khẩu" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required
        hint={PASSWORD_HINT} />
      <Field id="first-password-confirm" label="Xác nhận mật khẩu" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required />
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" disabled={busy} className="w-full">{busy ? 'Đang lưu…' : 'Đặt mật khẩu'}</Button>
      {!required && <Button type="button" variant="secondary" className="w-full" onClick={onDone}>Bỏ qua, vào không gian làm việc</Button>}
    </form>
  );
}
