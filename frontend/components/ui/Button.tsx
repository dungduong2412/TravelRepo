import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const BASE = 'inline-flex min-h-11 whitespace-nowrap items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold transition focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-line bg-surface text-ink hover:bg-canvas',
  ghost: 'text-ink hover:bg-canvas',
  danger: 'border border-danger-700/30 bg-surface text-danger-700 hover:bg-danger-50',
};
export const buttonClass = (variant: Variant = 'primary', extra = '') => `${BASE} ${VARIANT[variant]} ${extra}`.trim();

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" {...props} className={buttonClass(variant, className)} />;
}

export function ButtonLink({ href, variant = 'primary', className = '', children, ...rest }: { href: string; variant?: Variant; className?: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return <Link href={href} {...rest} className={buttonClass(variant, className)}>{children}</Link>;
}
