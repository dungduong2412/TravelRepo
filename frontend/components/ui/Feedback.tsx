import { AlertTriangle, CheckCircle2, Info, Loader2, SearchX, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

type Tone = 'success' | 'warning' | 'danger' | 'info';
const TONE: Record<Tone, { box: string; Glyph: typeof Info }> = {
  success: { box: 'border-success-700/20 bg-success-50 text-success-700', Glyph: CheckCircle2 },
  warning: { box: 'border-warning-700/20 bg-warning-50 text-warning-700', Glyph: AlertTriangle },
  danger: { box: 'border-danger-700/20 bg-danger-50 text-danger-700', Glyph: XCircle },
  info: { box: 'border-info-700/20 bg-info-50 text-info-700', Glyph: Info },
};

/** Inline message. Errors are announced (role=alert); everything else is polite status. */
export function Alert({ tone = 'info', title, children, action }: { tone?: Tone; title?: string; children?: ReactNode; action?: ReactNode }) {
  const { box, Glyph } = TONE[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex gap-3 rounded-control border p-3 text-sm ${box}`}>
      <Glyph aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">{title && <p className="font-semibold">{title}</p>}{children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}{action && <div className="mt-2">{action}</div>}</div>
    </div>
  );
}

export function Spinner({ label = 'Đang tải…' }: { label?: string }) {
  return <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted"><Loader2 aria-hidden="true" className="size-5 animate-spin" />{label}</div>;
}

/** Empty state = the request succeeded and there is nothing to show. Failures use <ErrorState/>. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div data-state="empty" className="mx-auto max-w-md py-14 text-center">
      <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-canvas text-ink-muted"><SearchX aria-hidden="true" className="size-7" /></div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <p className="mt-1 text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** Error state = the request failed (network / server). Never shown for legitimately empty data. */
export function ErrorState({ title = 'Không thể tải dữ liệu', children, onRetry }: { title?: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div data-state="error" className="mx-auto max-w-md py-12">
      <Alert tone="danger" title={title} action={onRetry && <button type="button" onClick={onRetry} className="min-h-11 rounded-control border border-danger-700/30 bg-surface px-4 text-sm font-semibold text-danger-700">Thử lại</button>}>
        {children ?? 'Đã xảy ra lỗi kết nối. Dữ liệu của bạn không bị ảnh hưởng.'}
      </Alert>
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone | 'neutral' | 'brand'; children: ReactNode }) {
  const cls = tone === 'neutral' ? 'bg-canvas text-ink-muted' : tone === 'brand' ? 'bg-brand-50 text-brand-700' : TONE[tone].box;
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}
