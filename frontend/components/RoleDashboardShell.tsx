"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { LogOut, Menu } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Wordmark } from './ui/Brand';
import { AuthShell } from './ui/AuthShell';
import { Alert } from './ui/Feedback';
import { Button } from './ui/Button';

export type RoleMenuItem = { label: string; shortLabel?: string; path: string; icon: ReactNode };

export default function RoleDashboardShell({ children, role, roleLabel, menu }: { children: ReactNode; role: 'merchant' | 'collaborator'; roleLabel: string; menu: RoleMenuItem[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  // A Partner who came in through the activation link has no password yet; until they have logged in by password at least once, say how to set one.
  const [needsPassword, setNeedsPassword] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data: { user } }: any) => {
      if (!active) return;
      if (!user) return router.replace('/login');
      const profile = await api.get('/user-profiles/me').catch(() => null);
      const entityId = role === 'merchant' ? profile?.merchant_id : profile?.collaborator_id;
      // A bound but not-yet-active account (awaiting approval / suspended) stays here and sees its status instead of an endless spinner.
      if (profile && profile.role === role && entityId && profile.user_profiles_status !== 'active') {
        setEmail(user.email || '');
        setBlocked(profile.user_profiles_status || 'pending');
        return;
      }
      if (!profile || profile.user_profiles_status !== 'active' || profile.role !== role || !entityId) {
        const destination = profile?.role === 'admin' ? '/admin/dashboard' : profile?.role === 'merchant' ? '/merchant/dashboard' : profile?.role === 'collaborator' ? '/collaborator/dashboard' : '/login';
        return router.replace(destination);
      }
      setNeedsPassword(role === 'collaborator' && (profile.login_count || 0) <= 1);
      setEmail(user.email || '');
    });
    return () => { active = false; };
  }, [role, router]);

  async function logout() {
    await supabase.auth.signOut();
    for (const key of ['user', 'userRole', 'merchant', 'collaborator']) localStorage.removeItem(key);
    router.replace('/login');
  }

  if (blocked) return <AccountStatusNotice status={blocked} email={email || ''} onLogout={logout} />;

  if (email === null) return <div className="grid min-h-screen place-items-center bg-slate-50 text-ink-muted">Đang tải…</div>;

  return <div className="min-h-screen overflow-x-clip bg-canvas text-ink">
    <header className="sticky top-0 z-40 flex min-h-16 items-center justify-between border-b border-line bg-white px-4 lg:hidden">
      <div><Wordmark className="text-xl" /><div className="text-xs text-ink-muted">{roleLabel}</div></div>
      <details className="relative"><summary aria-label="Menu" className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control border border-line px-3 text-sm font-semibold"><Menu aria-hidden="true" className="size-4" />Thêm</summary><div className="absolute right-0 mt-2 w-64 rounded-xl border border-line bg-white p-2 shadow-xl">{menu.map((item) => <NavLink key={item.path} item={item} active={pathname === item.path} />)}<button onClick={logout} className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-control border border-line px-4 text-left font-semibold text-ink"><LogOut aria-hidden="true" className="size-4" />Đăng xuất</button></div></details>
    </header>
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-line bg-white lg:flex">
      <div className="border-b border-line p-6"><Wordmark /><div className="mt-2 font-semibold">{roleLabel}</div><div className="mt-1 truncate text-xs text-ink-muted">{email}</div></div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-4" aria-label={`Điều hướng ${roleLabel}`}>
        {menu.map((item) => <NavLink key={item.path} item={item} active={pathname === item.path || (item.path !== `/${role}/dashboard` && pathname.startsWith(`${item.path}/`))} />)}
      </nav>
      <button onClick={logout} className="m-4 flex min-h-11 items-center justify-center gap-2 rounded-control border border-line px-4 font-semibold text-ink hover:bg-canvas"><LogOut aria-hidden="true" className="size-4" />Đăng xuất</button>
    </aside>
    <main className="min-w-0 px-4 py-5 pb-28 sm:px-6 lg:ml-72 lg:px-8 lg:py-8 lg:pb-8">
      {needsPassword && <div className="mb-4" data-testid="set-password-notice"><Alert tone="info" title="Đặt mật khẩu để đăng nhập lần sau">Bạn đã vào bằng liên kết kích hoạt nên chưa có mật khẩu. Vào <Link href={`/${role}/dashboard/settings`} className="font-semibold underline">Tài khoản</Link> để đặt mật khẩu; nếu không, lần sau bạn có thể dùng “Quên mật khẩu” trên trang đăng nhập.</Alert></div>}
      {children}
    </main>
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 gap-1 border-t border-line bg-white px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_20px_rgba(15,23,42,.08)] lg:hidden" aria-label={`Điều hướng chính ${roleLabel}`}>
      {menu.slice(0, 5).map((item) => <NavLink key={item.path} item={item} active={pathname === item.path || (item.path !== `/${role}/dashboard` && pathname.startsWith(`${item.path}/`))} mobile />)}
    </nav>
  </div>;
}

function NavLink({ item, active, mobile = false }: { item: RoleMenuItem; active: boolean; mobile?: boolean }) {
  return <Link href={item.path} aria-current={active ? 'page' : undefined} className={mobile
    ? `flex min-h-14 min-w-0 flex-col items-center justify-center rounded-lg px-1 text-[10px] font-semibold sm:text-[11px] ${active ? 'bg-brand-50 text-brand-700' : 'text-ink-muted'}`
    : `flex min-h-11 items-center gap-3 rounded-control px-4 text-sm font-semibold ${active ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-canvas'}`}>
    <span aria-hidden="true" className={mobile ? '[&>svg]:size-5' : '[&>svg]:size-5'}>{item.icon}</span><span className={mobile ? 'whitespace-nowrap' : ''}>{mobile ? item.shortLabel || item.label : item.label}</span>
  </Link>;
}

function AccountStatusNotice({ status, email, onLogout }: { status: string; email: string; onLogout: () => void }) {
  const copy = status === 'pending'
    ? { tone: 'info' as const, title: 'Hồ sơ đang chờ phê duyệt', body: 'Quản trị viên đang xem xét hồ sơ của bạn. Bạn sẽ dùng được đầy đủ tính năng ngay sau khi được duyệt.' }
    : { tone: 'warning' as const, title: 'Tài khoản chưa hoạt động', body: 'Tài khoản đang bị tạm khóa hoặc bị từ chối. Vui lòng liên hệ quản trị viên để được hỗ trợ.' };
  return <AuthShell title="Trạng thái tài khoản" subtitle={email}><Alert tone={copy.tone} title={copy.title}>{copy.body}</Alert><Button variant="secondary" className="w-full" onClick={onLogout}>Đăng xuất</Button></AuthShell>;
}
