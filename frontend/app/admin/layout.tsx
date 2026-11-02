"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart3, Database, Image as ImageIcon, LogOut, Menu, Store, UserCog, Users, Wallet, X } from 'lucide-react';
import { api } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { Wordmark } from '../../components/ui/Brand';
import { Spinner } from '../../components/ui/Feedback';

const MENU = [
  { name: 'Dashboard', path: '/admin/dashboard', Icon: BarChart3 },
  { name: 'Partners', path: '/admin/collaborators', Icon: Users },
  { name: 'Merchants', path: '/admin/merchants', Icon: Store },
  { name: 'Media Approvals', path: '/admin/media-approvals', Icon: ImageIcon },
  { name: 'User Management', path: '/admin/users', Icon: UserCog },
  { name: 'Financials', path: '/admin/financials', Icon: Wallet },
  { name: 'Master Data', path: '/admin/master-data', Icon: Database, subItems: [
    { name: 'Organization', path: '/admin/master-data/organization' },
    { name: 'Categories', path: '/admin/master-data/categories' },
  ] },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    api.get('/user-profiles/me').then((profile) => {
      if (!active) return;
      if (profile?.role !== 'admin' || profile?.user_profiles_status !== 'active') router.replace('/login');
      else setIsAuthorized(true);
    }).catch(() => { if (active) router.replace('/login'); });
    return () => { active = false; };
  }, [router]);

  useEffect(() => setOpen(false), [pathname]);

  async function handleLogout() {
    try { await supabase.auth.signOut(); } finally {
      ['user', 'userRole', 'accessToken', 'refreshToken', 'merchant', 'collaborator'].forEach((key) => localStorage.removeItem(key));
      router.replace('/login');
    }
  }

  if (!isAuthorized) return <div className="grid min-h-screen place-items-center bg-canvas"><Spinner label="Đang kiểm tra quyền quản trị…" /></div>;

  const active = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  const nav = (
    <nav aria-label="Điều hướng quản trị" className="flex-1 space-y-1 overflow-y-auto p-3">
      {MENU.map(({ name, path, Icon, subItems }) => (
        <div key={path}>
          <Link href={path} aria-current={pathname === path ? 'page' : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-semibold ${active(path) ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-canvas'}`}>
            <Icon aria-hidden="true" className="size-5" />{name}
          </Link>
          {subItems && active(path) && <div className="ml-8 mt-1 space-y-1">{subItems.map((s) => (
            <Link key={s.path} href={s.path} className={`flex min-h-10 items-center rounded-control px-3 text-sm ${pathname === s.path ? 'font-semibold text-brand-700' : 'text-ink-muted hover:text-ink'}`}>{s.name}</Link>
          ))}</div>}
        </div>
      ))}
    </nav>
  );
  const logout = <button type="button" onClick={handleLogout} className="m-3 flex min-h-11 items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold hover:bg-canvas"><LogOut aria-hidden="true" className="size-4" />Logout</button>;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
        <div className="flex items-center gap-2"><Wordmark className="text-xl" /><span className="text-xs text-ink-muted">Admin</span></div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Menu quản trị" className="grid size-11 place-items-center rounded-control border border-line">{open ? <X className="size-5" /> : <Menu className="size-5" />}</button>
      </header>
      {open && <div className="fixed inset-x-0 top-14 z-30 flex max-h-[80vh] flex-col border-b border-line bg-surface shadow-pop lg:hidden">{nav}{logout}</div>}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex items-center gap-2 border-b border-line p-5"><Wordmark /><span className="text-xs font-semibold text-ink-muted">Admin</span></div>
        {nav}{logout}
      </aside>
      <main className="min-w-0 p-4 sm:p-6 lg:ml-64 lg:p-8">{children}</main>
    </div>
  );
}
