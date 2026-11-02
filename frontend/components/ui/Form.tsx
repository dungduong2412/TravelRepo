import type { InputHTMLAttributes, ReactNode } from 'react';

export const inputClass = 'mt-1.5 block min-h-11 w-full rounded-control border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-muted/70 focus:border-brand-600 sm:text-sm';

/** Label + control + optional hint/error, wired with htmlFor / aria-describedby so screen readers and Playwright getByLabel both work. */
export function Field({ id, label, hint, error, ...input }: { id: string; label: string; hint?: ReactNode; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} className={`${inputClass} ${error ? 'border-danger-700' : ''}`} />
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-ink-muted">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger-700">{error}</p>}
    </div>
  );
}
