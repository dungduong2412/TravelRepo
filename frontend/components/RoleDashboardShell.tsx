"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';

export type RoleMenuItem = { label: string; shortLabel?: string; path: string; icon: ReactNode };

export default function RoleDashboardShell({ children, role, roleLabel, menu }: { children: ReactNode; role: 'merchant' | 'collaborator'; roleLabel: string; menu: RoleMenuItem[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data: { user } }: any) => {
      if (!active) return;
      if (!user) return router.replace('/login');
      const profile = await api.get('/user-profiles/me').catch(() => null);
      const entityId = role === 'merchant' ? profile?.merchant_id : profile?.collaborator_id;
      if (!profile || profile.user_profiles_status !== 'active' || profile.role !== role || !entityId) {
        const destination = profile?.role === 'admin' ? '/admin/dashboard' : profile?.role === 'merchant' ? '/merchant/dashboard' : profile?.role === 'collaborator' ? '/collaborator/dashboard' : '/login';
        return router.replace(destination);
      }
      setEmail(user.email || '');
    });
    return () => { active = false; };
  }, [role, router]);

  async function logout() {
    await supabase.auth.signOut();
    for (const key of ['user', 'userRole', 'merchant', 'collaborator']) localStorage.removeItem(key);
    router.replace('/login');
  }

  if (email === null) return <div className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">Đang tải…</div>;

  return <div className="min-h-screen overflow-x-clip bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-40 flex min-h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
      <div><div className="text-xl font-extrabold text-rose-600">VN01</div><div className="text-xs text-slate-500">{roleLabel}</div></div>
      <details className="relative"><summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold">Thêm</summary><div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">{menu.map((item) => <NavLink key={item.path} item={item} active={pathname === item.path} />)}<button onClick={logout} className="mt-1 min-h-11 w-full rounded-xl border border-rose-200 px-4 text-left font-semibold text-rose-700">Đăng xuất</button></div></details>
    </header>
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-slate-200 bg-white lg:flex">
      <div className="border-b border-slate-200 p-6"><div className="text-2xl font-extrabold text-rose-600">VN01</div><div className="mt-2 font-semibold">{roleLabel}</div><div className="mt-1 truncate text-xs text-slate-500">{email}</div></div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-4" aria-label={`Điều hướng ${roleLabel}`}>
        {menu.map((item) => <NavLink key={item.path} item={item} active={pathname === item.path || (item.path !== `/${role}/dashboard` && pathname.startsWith(`${item.path}/`))} />)}
      </nav>
      <button onClick={logout} className="m-4 min-h-11 rounded-xl border border-rose-200 px-4 font-semibold text-rose-700">Đăng xuất</button>
    </aside>
    <main className="min-w-0 px-4 py-5 pb-28 sm:px-6 lg:ml-72 lg:px-8 lg:py-8 lg:pb-8">{children}</main>
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 gap-1 border-t border-slate-200 bg-white px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_20px_rgba(15,23,42,.08)] lg:hidden" aria-label={`Điều hướng chính ${roleLabel}`}>
      {menu.slice(0, 5).map((item) => <NavLink key={item.path} item={item} active={pathname === item.path || (item.path !== `/${role}/dashboard` && pathname.startsWith(`${item.path}/`))} mobile />)}
    </nav>
  </div>;
}

function NavLink({ item, active, mobile = false }: { item: RoleMenuItem; active: boolean; mobile?: boolean }) {
  return <Link href={item.path} aria-current={active ? 'page' : undefined} className={mobile
    ? `flex min-h-14 min-w-0 flex-col items-center justify-center rounded-lg px-1 text-[10px] font-semibold sm:text-[11px] ${active ? 'bg-rose-50 text-rose-700' : 'text-slate-600'}`
    : `flex min-h-11 items-center gap-3 rounded-xl px-4 text-sm font-semibold ${active ? 'bg-rose-50 text-rose-700' : 'text-slate-700 hover:bg-slate-50'}`}>
    <span aria-hidden="true" className={mobile ? 'text-lg' : 'text-xl'}>{item.icon}</span><span className={mobile ? 'whitespace-nowrap' : ''}>{mobile ? item.shortLabel || item.label : item.label}</span>
  </Link>;
}
