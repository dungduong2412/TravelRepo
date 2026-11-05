'use client';

import { FormEvent, useEffect, useState } from 'react';
import { signOut, supabase, updateRecoveredPassword } from '../../lib/supabase';

import { AuthShell } from '../../components/ui/AuthShell';
import { Field } from '../../components/ui/Form';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { isValidPassword, PASSWORD_ERROR, PASSWORD_HINT } from '../../lib/password-policy';

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
    if (!isValidPassword(password)) {
      setError(PASSWORD_ERROR);
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
    <AuthShell title="Đặt mật khẩu mới">
      {complete ? (
        <>
          <Alert tone="success" title="Mật khẩu đã được cập nhật">Hãy đăng nhập lại bằng mật khẩu mới.</Alert>
          <ButtonLink href="/login" className="w-full">Đăng nhập</ButtonLink>
        </>
      ) : ready ? (
        <form className="space-y-4" onSubmit={submit}>
          <Field id="new-password" label="Mật khẩu mới" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required
            hint={PASSWORD_HINT} />
          <Field id="confirm-password" label="Xác nhận mật khẩu" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" disabled={loading} className="w-full">{loading ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}</Button>
        </form>
      ) : (
        <>
          <Alert tone="warning" title="Liên kết không hợp lệ hoặc đã hết hạn">Liên kết khôi phục chỉ dùng được một lần và có thời hạn. Hãy yêu cầu liên kết mới.</Alert>
          <ButtonLink href="/forgot-password" className="w-full">Yêu cầu liên kết mới</ButtonLink>
        </>
      )}
    </AuthShell>
  );
}
