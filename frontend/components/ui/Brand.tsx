import Link from 'next/link';

export function Wordmark({ className = '' }: { className?: string }) {
  return <Link href="/" aria-label="VNO - Trang chủ" className={`text-2xl font-extrabold tracking-tight text-brand-600 ${className}`}>VNO</Link>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0"><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>{subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}</div>
      {actions}
    </div>
  );
}

export function Card({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`rounded-card border border-line bg-surface shadow-card ${className}`} />;
}
