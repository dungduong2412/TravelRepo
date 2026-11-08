'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { publicApiFetch } from '../../../lib/api';
import { supabase } from '../../../lib/supabase';
import { activationFailure, ActivationFailureView, RESEND_ACCEPTED_TEXT, tokenFromHash } from '../../../lib/partner-registration';
import { AuthShell } from '../../../components/ui/AuthShell';
import { Field } from '../../../components/ui/Form';
import { Button, ButtonLink } from '../../../components/ui/Button';
import { Alert, Spinner } from '../../../components/ui/Feedback';

type Stage = 'init' | 'working' | 'failed' | 'request';

/**
 * Where the "your Partner account is approved" e-mail lands. The address is /auth/activate#token=...: the token is in the URL FRAGMENT, which the
 * browser never sends to any server (so it cannot reach a log or a Referer header). This page moves it into memory, removes it from the address bar,
 * and sends it once in a POST body. A good link signs the person in and opens the Partner dashboard — no password, no form.
 * Without a token the same page is the "send me a new link" screen for an expired or lost link.
 */
export default function ActivatePage() {
  const router = useRouter();
  const token = useRef<string | null>(null);
  const started = useRef(false);
  const [stage, setStage] = useState<Stage>('init');
  const [failure, setFailure] = useState<ActivationFailureView | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [resendDone, setResendDone] = useState(false);

  async function redeem() {
    const t = token.current;
    if (!t) { setStage('request'); return; }
    setStage('working'); setFailure(null);
    try {
      const response = await publicApiFetch('/auth/activate', { method: 'POST', body: JSON.stringify({ token: t }) });
      const { error } = await supabase.auth.setSession({ access_token: response.access_token, refresh_token: response.refresh_token });
      if (error) throw new Error('session');
      token.current = null;
      try {
        localStorage.setItem('user', JSON.stringify(response.user));
        localStorage.setItem('userRole', response.user.role);
        localStorage.setItem('collaborator', JSON.stringify(response.collaborator));
      } catch { /* storage unavailable: the dashboard reads the Supabase session */ }
      router.replace('/collaborator/dashboard');
    } catch (err) {
      const view = activationFailure(err);
      if (!view.retryable) token.current = null; // a used, expired or unapproved link is dead: never offer to retry it
      setCanRetry(view.retryable && token.current !== null);
      setFailure(view); setStage('failed');
    }
  }

  useEffect(() => {
    // The fragment is cleared right away, so a repeated effect run (React StrictMode in development) must not look for it again — and the link is single use.
    if (started.current) return;
    started.current = true;
    token.current = tokenFromHash(window.location.hash);
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    void redeem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requestNewLink(e: FormEvent) {
    e.preventDefault();
    if (resendBusy || !resendEmail.trim()) return;
    setResendBusy(true);
    try { await publicApiFetch('/auth/activation-link', { method: 'POST', body: JSON.stringify({ email: resendEmail.trim() }) }); } catch { /* the answer is the same either way */ }
    setResendDone(true); setResendBusy(false);
  }

  const resendForm = (
    <form onSubmit={requestNewLink} className="space-y-3" noValidate data-testid="resend-form">
      <Field id="resend-email" type="email" autoComplete="email" label="Email đã đăng ký" placeholder="email@example.com" value={resendEmail} onChange={(e) => { setResendEmail(e.target.value); setResendDone(false); }} />
      <Button type="submit" className="w-full" disabled={resendBusy || !resendEmail.trim()}>{resendBusy ? 'Đang gửi…' : 'Gửi lại liên kết kích hoạt'}</Button>
      {resendDone && <div data-testid="resend-accepted"><Alert tone="info">{RESEND_ACCEPTED_TEXT}</Alert></div>}
    </form>
  );

  return (
    <AuthShell title={stage === 'request' ? 'Gửi lại liên kết kích hoạt' : 'Kích hoạt tài khoản Đối tác'}>
      {(stage === 'init' || stage === 'working') && <Spinner label="Đang kích hoạt tài khoản và đăng nhập…" />}

      {stage === 'request' && (
        <>
          <p className="text-sm text-ink-muted">Dùng khi hồ sơ Đối tác của bạn đã được phê duyệt nhưng bạn chưa nhận được email, hoặc liên kết trong email đã hết hạn. Liên kết mới thay thế liên kết cũ.</p>
          {resendForm}
          <ButtonLink href="/login" variant="ghost" className="w-full">Đăng nhập</ButtonLink>
        </>
      )}

      {stage === 'failed' && failure && (
        <>
          <div data-testid="activation-error" data-offer-resend={failure.offerResend}><Alert tone={failure.tone} title={failure.title}>{failure.body}</Alert></div>
          {canRetry && <Button type="button" className="w-full" onClick={() => void redeem()}>Thử lại</Button>}
          {failure.offerResend && resendForm}
          {failure.offerLogin && <ButtonLink href="/login" className="w-full">Đăng nhập</ButtonLink>}
          {failure.offerLogin && <ButtonLink href="/forgot-password" variant="ghost" className="w-full">Quên mật khẩu</ButtonLink>}
        </>
      )}
    </AuthShell>
  );
}
