'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { requestPasswordReset } from '../../lib/supabase';
import { errorCode, logAuthEvent, newCorrelationId } from '../../lib/auth-diagnostics';
import { classifyRecoveryError } from '../../lib/auth-errors';
import { AuthShell } from '../../components/ui/AuthShell';
import { Field } from '../../components/ui/Form';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [fromFailedLink, setFromFailedLink] = useState(false);
  const cid = useRef(newCorrelationId());

  useEffect(() => { setFromFailedLink(new URLSearchParams(window.location.search).has('reason')); }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    logAuthEvent(cid.current, 'recovery_request', 'request_start');
    try {
      await requestPasswordReset(email.trim(), `${window.location.origin}/reset-password`);
      logAuthEvent(cid.current, 'recovery_request', 'request_ok');
      setSubmitted(true);
    } catch (err) {
      const code = errorCode(err);
      logAuthEvent(cid.current, 'recovery_request', 'request_failed', code);
      const failure = classifyRecoveryError(code);
      // Same copy whether or not the address exists; only rate limiting and transport failures are distinguishable.
      setError(failure.kind === 'rate_limited' ? failure.text : 'Không thể gửi yêu cầu lúc này. Vui lòng thử lại sau ít phút.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Khôi phục mật khẩu" subtitle="Nhập email tài khoản để nhận liên kết đặt lại mật khẩu.">
      {submitted ? (
        <>
          <Alert tone="success" title="Đã gửi yêu cầu">Nếu email thuộc một tài khoản hợp lệ, hướng dẫn khôi phục sẽ được gửi trong ít phút. Kiểm tra cả thư mục spam.</Alert>
          <Button variant="secondary" className="w-full" onClick={() => setSubmitted(false)}>Gửi lại cho email khác</Button>
          <ButtonLink href="/login" variant="ghost" className="w-full">Quay lại đăng nhập</ButtonLink>
        </>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          {fromFailedLink && <Alert tone="warning" title="Liên kết trước không dùng được">Mỗi lần chỉ nên yêu cầu một liên kết và dùng liên kết mới nhất. Nhập email để nhận liên kết mới.</Alert>}
          <Field id="forgot-email" label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" disabled={loading} className="w-full">{loading ? 'Đang gửi…' : 'Gửi liên kết khôi phục'}</Button>
          <p className="text-center text-sm"><Link className="text-brand-700 underline" href="/login">Quay lại đăng nhập</Link></p>
        </form>
      )}
    </AuthShell>
  );
}
