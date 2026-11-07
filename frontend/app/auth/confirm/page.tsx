'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, verifyEmailToken } from '../../../lib/supabase';
import { AuthShell } from '../../../components/ui/AuthShell';
import { Button, ButtonLink } from '../../../components/ui/Button';
import { Alert } from '../../../components/ui/Feedback';
import { errorCode, logAuthEvent, newCorrelationId } from '../../../lib/auth-diagnostics';
import { classifyVerifyError } from '../../../lib/auth-errors';

type Stage = 'init' | 'confirm' | 'verifying' | 'invalid';

// Only in-app onboarding/login destinations are honoured, so the emailed `next` value can never act as an open redirect.
const SAFE_NEXT = /^\/(merchant\/onboard|collaborator\/onboard|login)(\?[A-Za-z0-9=&_-]*)?$/;

/**
 * Signup e-mail confirmation. The one-time token is spent only when the person presses the button, so mail scanners and link
 * prefetchers that merely fetch the URL cannot consume it. The session is stored in localStorage, so a confirmation opened in a
 * different tab or browser window signs the original onboarding tab in too (its draft is kept, see the onboarding pages).
 */
export default function ConfirmEmailPage() {
  const router = useRouter();
  const cid = useRef(newCorrelationId());
  const token = useRef<string | null>(null);
  const parsed = useRef(false);
  const next = useRef('/login');
  const [stage, setStage] = useState<Stage>('init');
  const [error, setError] = useState('');
  const [otherSession, setOtherSession] = useState<string | null>(null);

  useEffect(() => {
    // The token is removed from the address bar below, so a repeated effect run (React StrictMode in development) must not re-parse it.
    if (parsed.current) return;
    parsed.current = true;
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token_hash');
    const requestedNext = params.get('next') || '/login';
    next.current = SAFE_NEXT.test(requestedNext) ? requestedNext : '/login';
    if (t && params.get('type') === 'signup') {
      token.current = t;
      window.history.replaceState(null, '', window.location.pathname);
      logAuthEvent(cid.current, 'signup_confirm', 'token_present');
      setStage('confirm');
    } else {
      logAuthEvent(cid.current, 'signup_confirm', 'token_missing');
      setStage('invalid');
    }
    // A sign-in left over in this browser must never be replaced without the person seeing it.
    supabase.auth.getSession().then(({ data }) => setOtherSession(data.session?.user?.email ?? null));
  }, []);

  const confirm = async () => {
    const t = token.current;
    if (!t) { setStage('invalid'); return; }
    setStage('verifying');
    setError('');
    logAuthEvent(cid.current, 'signup_confirm', 'verify_start');
    try {
      if (otherSession) await supabase.auth.signOut({ scope: 'local' });
      await verifyEmailToken(t, 'signup');
      token.current = null;
      logAuthEvent(cid.current, 'signup_confirm', 'verify_ok');
      router.replace(next.current);
    } catch (err) {
      const code = errorCode(err);
      logAuthEvent(cid.current, 'signup_confirm', 'verify_failed', code);
      const failure = classifyVerifyError(code);
      if (failure.kind === 'link_invalid') { token.current = null; setStage('invalid'); }
      else { setError(failure.text); setStage('confirm'); }
    }
  };

  return (
    <AuthShell title="Xác nhận email">
      {stage === 'invalid' ? (
        <>
          <Alert tone="warning" title="Liên kết không hợp lệ hoặc đã dùng rồi">
            Liên kết xác nhận chỉ dùng được một lần và có thời hạn. Nếu bạn đã xác nhận trước đó, hãy đăng nhập hoặc tiếp tục đăng ký từ trang đăng ký.
          </Alert>
          <ButtonLink href="/login" className="w-full">Đăng nhập</ButtonLink>
          <ButtonLink href="/signup" variant="ghost" className="w-full">Quay lại đăng ký</ButtonLink>
        </>
      ) : stage === 'init' ? (
        <p className="text-sm text-ink-muted" aria-live="polite">Đang kiểm tra liên kết…</p>
      ) : (
        <>
          <p className="text-sm text-ink-muted">Nhấn nút bên dưới để xác nhận địa chỉ email. Sau đó bạn hoàn tất hồ sơ; tài khoản chỉ hoạt động sau khi Admin phê duyệt. Liên kết chỉ dùng được một lần.</p>
          {otherSession && <Alert tone="warning" title="Trình duyệt đang đăng nhập bằng tài khoản khác">Phiên của {otherSession} sẽ được đăng xuất khi bạn xác nhận, và hồ sơ sẽ tiếp tục với email vừa đăng ký.</Alert>}
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="button" className="w-full" disabled={stage === 'verifying'} onClick={confirm}>{stage === 'verifying' ? 'Đang xác nhận…' : 'Xác nhận email'}</Button>
        </>
      )}
    </AuthShell>
  );
}
