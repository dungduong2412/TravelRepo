import Link from 'next/link';
import type { ReactNode } from 'react';
import { Wordmark } from './Brand';

/** Shared frame for every signed-out / account-state screen (login, recovery, claim, pending approval). */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center"><Wordmark className="text-3xl" /></div>
        <section className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
          <div className="mt-6 space-y-4">{children}</div>
        </section>
        {footer && <div className="mt-4 text-center text-sm text-ink-muted">{footer}</div>}
        <p className="mt-6 text-center text-xs text-ink-muted"><Link href="/" className="underline">Về trang chủ</Link></p>
      </div>
    </main>
  );
}
