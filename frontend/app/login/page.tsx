'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { publicApiFetch } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { AuthShell } from '../../components/ui/AuthShell';
import { Field } from '../../components/ui/Form';
import { Button, buttonClass } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';

/** Backend messages -> actionable Vietnamese copy. Unknown messages fall back to a generic, non-leaking line. */
function loginMessage(raw: string): { tone: 'danger' | 'warning' | 'info'; title: string; body: string } {
  const m = raw.toLowerCase();
  if (m.includes('invalid email or password')) return { tone: 'danger', title: 'Email hoặc mật khẩu không đúng', body: 'Kiểm tra lại thông tin hoặc đặt lại mật khẩu.' };
  if (m.includes('not approved')) return { tone: 'info', title: 'Tài khoản đang chờ duyệt', body: 'Quản trị viên chưa phê duyệt hồ sơ của bạn. Bạn sẽ đăng nhập được ngay sau khi hồ sơ được duyệt.' };
  if (m.includes('not active')) return { tone: 'warning', title: 'Tài khoản chưa được kích hoạt', body: 'Tài khoản đang bị tạm khóa hoặc chưa kích hoạt. Vui lòng liên hệ quản trị viên.' };
  if (m.includes('confirm')) return { tone: 'warning', title: 'Email chưa được xác nhận', body: 'Hãy mở liên kết xác nhận trong email đăng ký trước khi đăng nhập.' };
  return { tone: 'danger', title: 'Không thể đăng nhập', body: 'Đã có lỗi xảy ra. Vui lòng thử lại sau ít phút.' };
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<ReturnType<typeof loginMessage> | null>(null);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setNotice(null);
    try {
      const response = await publicApiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) });
      if (response.access_token) {
        const { error: sessionError } = await supabase.auth.setSession({ access_token: response.access_token, refresh_token: response.refresh_token });
        if (sessionError) throw new Error('session');
      }
      localStorage.setItem('user', JSON.stringify(response.user));
      localStorage.setItem('userRole', response.user.role);
      if (response.user.role === 'merchant') {
        localStorage.setItem('merchant', JSON.stringify(response.merchant));
        router.push('/merchant/dashboard');
      } else if (response.user.role === 'collaborator') {
        localStorage.setItem('collaborator', JSON.stringify(response.collaborator));
        router.push('/collaborator/dashboard');
      } else if (response.user.role === 'admin') {
        router.push('/admin/dashboard');
      } else {
        setNotice(loginMessage('unsupported'));
      }
    } catch (err) {
      setNotice(loginMessage(err instanceof Error ? err.message : ''));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Đăng nhập"
      subtitle="Dành cho Quản trị viên, Nhà cung cấp và Đối tác."
      footer={<>Chưa có tài khoản? <Link href="/signup" className="font-semibold text-brand-700 underline">Đăng ký</Link></>}
    >
      <form onSubmit={handleLogin} className="space-y-4" noValidate={false}>
        <Field id="login-email" label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="email@example.com" />
        <Field id="login-password" label="Mật khẩu" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {notice && <Alert tone={notice.tone} title={notice.title}>{notice.body}</Alert>}
        <Button type="submit" disabled={loading} className="w-full">{loading ? 'Đang đăng nhập…' : 'Đăng nhập'}</Button>
        <Link href="/forgot-password" className={buttonClass('ghost', 'w-full')}>Quên mật khẩu?</Link>
      </form>
    </AuthShell>
  );
}
