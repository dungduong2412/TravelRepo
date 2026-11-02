'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabase';
import { api } from '../../../../lib/api';
import { AuthShell } from '../../../../components/ui/AuthShell';
import { Alert, Spinner } from '../../../../components/ui/Feedback';
import { FirstPasswordForm } from '../../../../components/FirstPasswordForm';
import { Button, ButtonLink } from '../../../../components/ui/Button';

type Stage = 'loading' | 'no-session' | 'link-error' | 'claiming' | 'success' | 'error';
type Problem = { tone: 'danger' | 'warning' | 'info'; title: string; body: string; retry: boolean };

/** Backend claim errors -> what the person can actually do next. */
function claimProblem(raw: string): Problem {
  const m = raw.toLowerCase();
  if (m.includes('expired')) return { tone: 'warning', title: 'Lời mời đã hết hạn', body: 'Lời mời chỉ có hiệu lực trong 7 ngày. Hãy nhờ quản trị viên gửi lời mời mới.', retry: false };
  if (m.includes('revoked')) return { tone: 'warning', title: 'Lời mời đã bị thu hồi', body: 'Quản trị viên đã thu hồi lời mời này. Hãy liên hệ họ để được mời lại.', retry: false };
  if (m.includes('accepted') || m.includes('no longer available')) return { tone: 'info', title: 'Lời mời đã được sử dụng', body: 'Hồ sơ này đã được liên kết với một tài khoản. Hãy đăng nhập nếu đó là tài khoản của bạn.', retry: false };
  if (m.includes('does not match the invitation') || m.includes('target email')) return { tone: 'danger', title: 'Sai tài khoản email', body: 'Bạn đang đăng nhập bằng một email khác với email được mời. Hãy đăng xuất và mở lại liên kết từ đúng hộp thư.', retry: false };
  if (m.includes('already has an account')) return { tone: 'info', title: 'Tài khoản đã tồn tại', body: 'Danh tính này đã gắn với một hồ sơ khác nên không thể nhận thêm hồ sơ. Hãy đăng nhập.', retry: false };
  if (m.includes('no pending invitation') || m.includes('not found')) return { tone: 'warning', title: 'Không tìm thấy lời mời hợp lệ', body: 'Liên kết có thể không đúng hoặc lời mời không còn hiệu lực. Hãy liên hệ quản trị viên.', retry: false };
  if (m.includes('confirmation is required')) return { tone: 'warning', title: 'Cần xác nhận email', body: 'Hãy xác nhận email của bạn rồi mở lại liên kết lời mời.', retry: false };
  return { tone: 'danger', title: 'Không thể hoàn tất liên kết', body: 'Đã có lỗi kết nối. Dữ liệu của bạn không bị ảnh hưởng, bạn có thể thử lại.', retry: true };
}

export default function ClaimPage() {
  const params = useParams<{ entityType: string; entityId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('loading');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState<string | null>(null);
  // 'checking' until Auth confirms the session user server-side; 'required' = invited identity without a password; 'unverified' = no usable verified session
  const [passwordGate, setPasswordGate] = useState<'checking' | 'required' | 'optional' | 'unverified'>('checking');

  const invitationId = searchParams.get('invitation');
  const { entityType, entityId } = params;
  const entityLabel = entityType === 'merchant' ? 'nhà cung cấp' : 'đối tác';

  const doClaim = useCallback(async (accessToken: string) => {
    setStage('claiming');
    try {
      const data = await api.post(`/invitations/claim/${entityType}/${entityId}${invitationId ? `?invitation=${invitationId}` : ''}`, undefined, accessToken);
      setRole(data.role);
      // getUser() validates the JWT against Auth (not just the local cache): the password form is offered only for a verified-email session.
      const { data: current, error: userError } = await supabase.auth.getUser();
      const user = current?.user;
      if (userError || !user?.email_confirmed_at) setPasswordGate('unverified');
      else setPasswordGate(user.invited_at && !user.user_metadata?.password_set ? 'required' : 'optional');
      setStage('success');
    } catch (err) {
      setProblem(claimProblem(err instanceof Error ? err.message : ''));
      setStage('error');
    }
  }, [entityType, entityId, invitationId]);

  useEffect(() => {
    // Supabase reports a bad / expired / already-used emailed link in the URL fragment (#error_code=otp_expired ...).
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (hash.get('error_code') || hash.get('error')) { setStage('link-error'); return; }
    let handled = false;
    const run = (accessToken: string) => { if (handled) return; handled = true; setRetryToken(accessToken); void doClaim(accessToken); };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { if (session) run(session.access_token); });
    supabase.auth.getSession().then(({ data: { session } }) => { if (session) run(session.access_token); else if (!handled) setStage('no-session'); });
    return () => subscription.unsubscribe();
  }, [doClaim]);

  const dashboard = role === 'merchant' ? '/merchant/dashboard' : '/collaborator/dashboard';

  return (
    <AuthShell title="Liên kết tài khoản" subtitle={`Nhận hồ sơ ${entityLabel} được quản trị viên tạo cho bạn.`}>
      {stage === 'loading' && <Spinner label="Đang xác minh danh tính…" />}
      {stage === 'claiming' && <Spinner label={`Đang liên kết hồ sơ ${entityLabel}…`} />}
      {stage === 'link-error' && (
        <>
          <Alert tone="warning" title="Liên kết không hợp lệ hoặc đã hết hạn">Liên kết trong email chỉ dùng được một lần và có thời hạn. Hãy nhờ quản trị viên gửi lời mời mới.</Alert>
          <ButtonLink href="/login" variant="secondary" className="w-full">Đăng nhập</ButtonLink>
        </>
      )}
      {stage === 'no-session' && (
        <>
          <Alert tone="info" title="Bạn cần đăng nhập để tiếp tục">Hãy mở liên kết lời mời trong email của bạn, hoặc đăng nhập bằng đúng email được mời rồi quay lại trang này.</Alert>
          <Button className="w-full" onClick={() => router.push('/login')}>Đăng nhập</Button>
        </>
      )}
      {stage === 'success' && (
        <>
          <Alert tone="success" title="Đã liên kết thành công">Hồ sơ {entityLabel} đã được gắn với tài khoản của bạn. Quản trị viên sẽ duyệt trước khi bạn dùng đầy đủ tính năng.</Alert>
          {passwordGate === 'checking' && <Spinner label="Đang xác minh phiên đăng nhập…" />}
          {(passwordGate === 'required' || passwordGate === 'optional') && <FirstPasswordForm required={passwordGate === 'required'} onDone={() => router.push(dashboard)} />}
          {passwordGate === 'unverified' && (<><Alert tone="warning" title="Chưa xác minh được phiên đăng nhập">Hồ sơ đã được liên kết nhưng phiên hiện tại không hợp lệ. Hãy đăng nhập lại, hoặc dùng &quot;Quên mật khẩu&quot; để đặt mật khẩu qua email.</Alert><ButtonLink href="/login" className="w-full">Đăng nhập</ButtonLink><ButtonLink href="/forgot-password" variant="secondary" className="w-full">Quên mật khẩu</ButtonLink></>)}
        </>
      )}
      {stage === 'error' && problem && (
        <>
          <Alert tone={problem.tone} title={problem.title}>{problem.body}</Alert>
          {problem.retry && retryToken && <Button className="w-full" onClick={() => void doClaim(retryToken)}>Thử lại</Button>}
          <ButtonLink href="/" variant="secondary" className="w-full">Về trang chủ</ButtonLink>
        </>
      )}
    </AuthShell>
  );
}
