'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LogIn, LayoutDashboard } from 'lucide-react';
import { Wordmark } from '../ui/Brand';
import { buttonClass } from '../ui/Button';
import { supabase } from '../../lib/supabase';
import { api } from '../../lib/api';

const HOME: Record<string, string> = { admin: '/admin/dashboard', merchant: '/merchant/dashboard', collaborator: '/collaborator/dashboard' };

/** Public top bar. Signed-in visitors get a link to their own workspace; no demo role switcher exists any more. */
export function SiteHeader({ children }: { children?: React.ReactNode }) {
  const [home, setHome] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) return setHome(null);
      const profile = await api.get('/user-profiles/me').catch(() => null);
      if (active) setHome(profile && HOME[profile.role] ? HOME[profile.role] : null);
    });
    return () => { active = false; };
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Wordmark />
        <nav aria-label="Tài khoản" className="flex items-center gap-2">
          <Link href="/merchant/onboard" className={buttonClass('ghost', 'max-sm:hidden')}>Trở thành nhà cung cấp</Link>
          {home ? (
            <Link href={home} className={buttonClass('secondary')}><LayoutDashboard aria-hidden="true" className="size-4" />Không gian làm việc</Link>
          ) : (
            <Link href="/login" className={buttonClass('primary')}><LogIn aria-hidden="true" className="size-4" />Đăng nhập</Link>
          )}
        </nav>
      </div>
      {children}
    </header>
  );
}
