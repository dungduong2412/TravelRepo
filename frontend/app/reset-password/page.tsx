'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { signOut, supabase, updateRecoveredPassword, verifyEmailToken } from '../../lib/supabase';

import { AuthShell } from '../../components/ui/AuthShell';
import { Field } from '../../components/ui/Form';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { isValidPassword, PASSWORD_ERROR, PASSWORD_HINT } from '../../lib/password-policy';
import { errorCode, logAuthEvent, newCorrelationId } from '../../lib/auth-diagnostics';
import { classifyRecoveryError, classifyVerifyError } from '../../lib/auth-errors';

type Stage = 'init' | 'confirm' | 'verifying' | 'ready' | 'invalid' | 'done';

const APP_SESSION_KEYS = ['user', 'userRole', 'merchant', 'collaborator'];

function maskEmail(email: string | undefined) {
  if (!email) return '';
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain ?? ''}`;
}

/**
 * Recovery rules (see docs): the form is enabled ONLY by a recovery session that THIS page established from the emailed one-time token
 * (verifyOtp after an explicit click) or by Supabase's own PASSWORD_RECOVERY event for legacy hash links. An ordinary pre-existing
 * session never enables it, so a different signed-in account cannot be used to reset a password.
 */
export default function ResetPasswordPage() {
  const cid = useRef(newCorrelationId());
  const tokenHash = useRef<string | null>(null);
  const [stage, setStage] = useState<Stage>('init');
  const [invalidReason, setInvalidReason] = useState('token_missing');
  const [recoveredEmail, setRecoveredEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    logAuthEvent(cid.current, 'recovery', 'page_load');
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = params.get('token_hash');

    const markInvalid = (reason: string) => { if (active) { setInvalidReason(reason); setStage('invalid'); } };

    // Subscribe first so the legacy implicit-flow event cannot be missed. Only the explicit recovery event counts, never "any session".
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (active && event === 'PASSWORD_RECOVERY') {
        logAuthEvent(cid.current, 'recovery', 'legacy_recovery_event');
        setRecoveredEmail(maskEmail(session?.user?.email));
        setStage('ready');
      }
    });

    let legacyTimer: ReturnType<typeof setTimeout> | undefined;
    if (token && params.get('type') === 'recovery') {
      tokenHash.current = token;
      // Keep the one-time token out of history, the address bar and any Referer header.
      window.history.replaceState(null, '', window.location.pathname);
      logAuthEvent(cid.current, 'recovery', 'token_present');
      setStage('confirm');
    } else if (hash.get('error_code') || hash.get('error')) {
      const code = (hash.get('error_code') || 'access_denied').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64);
      window.history.replaceState(null, '', window.location.pathname);
      logAuthEvent(cid.current, 'recovery', 'hash_error', code);
      markInvalid(code);
    } else if (hash.get('access_token') && hash.get('type') === 'recovery') {
      legacyTimer = setTimeout(() => markInvalid('legacy_recovery_timeout'), 5000);
    } else {
      logAuthEvent(cid.current, 'recovery', 'token_missing');
      markInvalid('token_missing');
    }
    return () => { active = false; if (legacyTimer) clearTimeout(legacyTimer); sub.subscription.unsubscribe(); };
  }, []);

  const verify = async () => {
    const token = tokenHash.current;
    if (!token) { setInvalidReason('token_missing'); setStage('invalid'); return; }
    setStage('verifying');
    setError('');
    logAuthEvent(cid.current, 'recovery', 'verify_start');
    try {
      const user = await verifyEmailToken(token, 'recovery');
      tokenHash.current = null; // single use: never replay a spent token
      setRecoveredEmail(maskEmail(user.email));
      logAuthEvent(cid.current, 'recovery', 'verify_ok');
      setStage('ready');
    } catch (err) {
      const code = errorCode(err);
      logAuthEvent(cid.current, 'recovery', 'verify_failed', code);
      const failure = classifyVerifyError(code);
      if (failure.kind === 'link_invalid') {
        tokenHash.current = null;
        setInvalidReason(code);
        setStage('invalid');
      } else {
        // Transport or rate problem: the token was not necessarily spent, so let the person retry the same link.
        setError(failure.text);
        setStage('confirm');
      }
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!isValidPassword(password)) { setError(PASSWORD_ERROR); return; }
    if (password !== confirmation) { setError('Hai mật khẩu không khớp.'); return; }

    setLoading(true);
    logAuthEvent(cid.current, 'recovery', 'update_start');
    try {
      await updateRecoveredPassword(password);
    } catch (err) {
      const code = errorCode(err);
      logAuthEvent(cid.current, 'recovery', 'update_failed', code);
      const failure = classifyRecoveryError(code);
      if (failure.kind === 'link_invalid') { setInvalidReason(code); setStage('invalid'); }
      else setError(failure.text); // policy / same-password / transport: stay on the form, keep the recovery session
      setLoading(false);
      return;
    }
    logAuthEvent(cid.current, 'recovery', 'update_ok');
    try { await signOut(); } catch { /* the password is already changed; local cleanup below still runs */ }
    try { APP_SESSION_KEYS.forEach((k) => localStorage.removeItem(k)); } catch { /* storage may be unavailable */ }
    setLoading(false);
    setStage('done');
  };

  return (
    <AuthShell title="Đặt mật khẩu mới">
      {stage === 'done' ? (
        <>
          <Alert tone="success" title="Mật khẩu đã được cập nhật">Hãy đăng nhập lại bằng mật khẩu mới.</Alert>
          <ButtonLink href="/login" className="w-full">Đăng nhập</ButtonLink>
        </>
      ) : stage === 'ready' ? (
        <form className="space-y-4" onSubmit={submit}>
          {recoveredEmail && <p className="text-sm text-ink-muted">Đặt mật khẩu mới cho tài khoản <strong>{recoveredEmail}</strong>.</p>}
          <Field id="new-password" label="Mật khẩu mới" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required
            hint={PASSWORD_HINT} />
          <Field id="confirm-password" label="Xác nhận mật khẩu" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" disabled={loading} className="w-full">{loading ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}</Button>
        </form>
      ) : stage === 'confirm' || stage === 'verifying' ? (
        <>
          <p className="text-sm text-ink-muted">Nhấn nút bên dưới để xác minh liên kết khôi phục và chọn mật khẩu mới. Liên kết chỉ dùng được một lần.</p>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="button" className="w-full" disabled={stage === 'verifying'} onClick={verify}>{stage === 'verifying' ? 'Đang xác minh…' : 'Tiếp tục đặt mật khẩu'}</Button>
        </>
      ) : stage === 'invalid' ? (
        <>
          <Alert tone="warning" title="Liên kết không hợp lệ hoặc đã hết hạn">
            {error || 'Liên kết khôi phục chỉ dùng được một lần và có thời hạn. Hãy yêu cầu liên kết mới.'}
          </Alert>
          <ButtonLink href={`/forgot-password?reason=${encodeURIComponent(invalidReason)}`} className="w-full">Yêu cầu liên kết mới</ButtonLink>
        </>
      ) : (
        <p className="text-sm text-ink-muted" aria-live="polite">Đang kiểm tra liên kết…</p>
      )}
    </AuthShell>
  );
}
