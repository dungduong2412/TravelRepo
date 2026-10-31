"use client";

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { fractionToPercentagePoints } from '../lib/rates';

type Party = { merchant_system_id?: string; merchant_code?: string | null; merchant_name?: string | null; id?: string; collaborators_code?: string | null; collaborators_name?: string | null };
type Transaction = {
  id: string; legacy_transaction_id?: string | null; document_number?: string | null; document_index?: number | null;
  document_date_utc?: string | null; posting_date_utc?: string | null; confirmed_at_utc?: string | null; commission_date_utc?: string | null;
  merchant_id?: string | null; collaborator_id?: string | null; merchant?: Party | Party[] | null; collaborator?: Party | Party[] | null;
  legacy_restaurant_display_name?: string | null; legacy_middleman_display_name?: string | null;
  legacy_status?: number | null; lifecycle_status?: string | null; payment_status?: string | null;
  document_total?: string | number; document_discount_percent?: string | number | null; document_discount_amount?: string | number;
  commission_percent?: string | number; commission_amount?: string | number; currency_code?: string | null; legacy_notes?: string | null;
  record_kind?: 'v1_import' | 'uat_simulation' | null; simulation_status?: string | null; external_settlement_enabled?: boolean;
};
type Summary = { transaction_count: number; document_total: string; document_discount_amount: string; commission_amount: string; payment_statuses: Record<string, number>; lifecycle_statuses: Record<string, number>; source_statuses: Record<string, number>; record_kinds: Record<string, number> };
type Report = { items: Transaction[]; page: number; page_size: number; total: number; page_count: number; summary: Summary };
type Filters = { search: string; merchant_id: string; collaborator_id: string; legacy_status: string; lifecycle_status: string; payment_status: string; record_kind: string; from: string; to: string; orphan_only: boolean };
const EMPTY_FILTERS: Filters = { search: '', merchant_id: '', collaborator_id: '', legacy_status: '', lifecycle_status: '', payment_status: '', record_kind: '', from: '', to: '', orphan_only: false };

export default function FinancialHistory({ admin = false }: { admin?: boolean }) {
  const [report, setReport] = useState<Report | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState('document_date_utc');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [showAdditional, setShowAdditional] = useState(false);
  const [merchants, setMerchants] = useState<Party[]>([]);
  const [collaborators, setCollaborators] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    Promise.all([apiFetch('/merchants'), apiFetch('/collaborators')]).then(([merchantRows, collaboratorRows]) => {
      setMerchants(merchantRows || []); setCollaborators(collaboratorRows || []);
    }).catch(() => undefined);
  }, [admin]);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), sort, direction });
    for (const [key, value] of Object.entries(applied)) {
      if (typeof value === 'boolean') { if (value) params.set(key, 'true'); }
      else if (value) params.set(key, key === 'from' || key === 'to' ? new Date(value).toISOString() : value);
    }
    setLoading(true); setError(null);
    apiFetch(`${admin ? '/transactions/report' : '/transactions/me/report'}?${params}`)
      .then(setReport).catch((err) => setError(err.message || 'Không thể tải dữ liệu giao dịch')).finally(() => setLoading(false));
  }, [admin, applied, direction, page, pageSize, sort]);

  function applyFilters(event: FormEvent) { event.preventDefault(); setPage(1); setApplied({ ...filters }); }
  function clearFilters() { setFilters(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); setPage(1); }
  const rows = report?.items || [];
  const statusSummary = useMemo(() => Object.entries(report?.summary.payment_statuses || {}).map(([key, count]) => `${key}: ${count}`).join(' · ') || '—', [report]);

  return <div style={styles.container}>
    {error && <div style={styles.error} role="alert">{error}</div>}
    {report && <div style={styles.cards}><Metric label="Giao dịch phù hợp" value={String(report.summary.transaction_count)} /><Metric label="Tổng chứng từ" value={money(report.summary.document_total)} /><Metric label="Tổng giảm giá" value={money(report.summary.document_discount_amount)} /><Metric label="Tổng hoa hồng" value={money(report.summary.commission_amount)} /></div>}

    <form onSubmit={applyFilters} style={styles.filters} aria-label="Bộ lọc giao dịch">
      <label style={styles.label}>Tìm kiếm<input style={styles.input} value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Số chứng từ hoặc tên nguồn" /></label>
      {admin && <label style={styles.label}>Merchant<select style={styles.input} value={filters.merchant_id} onChange={(e) => setFilters({ ...filters, merchant_id: e.target.value, orphan_only: false })}><option value="">Tất cả</option>{merchants.map((item) => <option key={item.merchant_system_id} value={item.merchant_system_id}>{item.merchant_code || '—'} · {item.merchant_name || 'Không tên'}</option>)}</select></label>}
      {admin && <label style={styles.label}>Đối tác<select style={styles.input} value={filters.collaborator_id} onChange={(e) => setFilters({ ...filters, collaborator_id: e.target.value })}><option value="">Tất cả</option>{collaborators.map((item) => <option key={item.id} value={item.id}>{item.collaborators_code || '—'} · {item.collaborators_name || 'Không tên'}</option>)}</select></label>}
      <label style={styles.label}>Trạng thái nguồn<input style={styles.input} value={filters.legacy_status} onChange={(e) => setFilters({ ...filters, legacy_status: e.target.value })} placeholder="Ví dụ 17; null nếu thiếu" /></label>
      <label style={styles.label}>Vòng đời<input style={styles.input} value={filters.lifecycle_status} onChange={(e) => setFilters({ ...filters, lifecycle_status: e.target.value })} placeholder="unmapped" /></label>
      <label style={styles.label}>Thanh toán<input style={styles.input} value={filters.payment_status} onChange={(e) => setFilters({ ...filters, payment_status: e.target.value })} placeholder="unverified" /></label>
      <label style={styles.label}>Loại bản ghi<select style={styles.input} value={filters.record_kind} onChange={(e) => setFilters({ ...filters, record_kind: e.target.value })}><option value="">Tất cả</option><option value="v1_import">Lịch sử V1</option><option value="uat_simulation">Mô phỏng UAT</option></select></label>
      <label style={styles.label}>Từ ngày<input style={styles.input} type="datetime-local" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
      <label style={styles.label}>Đến ngày<input style={styles.input} type="datetime-local" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
      {admin && <label style={styles.checkbox}><input type="checkbox" checked={filters.orphan_only} onChange={(e) => setFilters({ ...filters, orphan_only: e.target.checked, merchant_id: '' })} /> Chỉ giao dịch không có merchant</label>}
      <div style={styles.filterActions}><button style={styles.primaryButton} type="submit">Áp dụng</button><button style={styles.secondaryButton} type="button" onClick={clearFilters}>Xóa lọc</button></div>
    </form>

    <div style={styles.toolbar}><div style={styles.notice}>Trạng thái nguồn và trạng thái thanh toán là hai khái niệm độc lập. Giá trị nguồn trống được giữ là “Không có trong nguồn”, không được suy diễn.</div><div style={styles.toolbarControls}>
      <label style={styles.compactLabel}>Sắp xếp<select style={styles.compactInput} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}><option value="document_date_utc">Ngày giao dịch</option><option value="document_number">Số chứng từ</option><option value="document_total">Giá trị chứng từ</option><option value="document_discount_amount">Giảm giá</option><option value="commission_amount">Hoa hồng</option><option value="legacy_status">Trạng thái nguồn</option></select></label>
      <button style={styles.secondaryButton} type="button" onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}>{direction === 'asc' ? 'Tăng dần ↑' : 'Giảm dần ↓'}</button><button style={styles.secondaryButton} type="button" onClick={() => setShowAdditional(!showAdditional)}>{showAdditional ? 'Ẩn cột phụ' : 'Hiện cột phụ'}</button>
    </div></div>

    <div className="grid gap-3 md:hidden" aria-busy={loading}>{rows.map((row) => { const merchant = one(row.merchant); const collaborator = one(row.collaborator); return <button key={row.id} type="button" onClick={() => setSelected(row)} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm"><div className="flex items-start justify-between gap-3"><div><div className="font-bold">{row.document_number || 'Không có số chứng từ'}</div><div className="mt-1 text-xs text-slate-500">{date(row.document_date_utc)}</div></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${row.record_kind === 'uat_simulation' ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-700'}`}>{recordKind(row.record_kind)}</span></div><div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm"><span className="text-slate-500">Trạng thái nguồn</span><span className="text-right font-medium">{sourceStatus(row.legacy_status)}</span><span className="text-slate-500">Merchant</span><span className="text-right font-medium">{merchant?.merchant_name || row.legacy_restaurant_display_name || (row.merchant_id ? 'Chưa đặt tên' : 'Không liên kết')}</span><span className="text-slate-500">Đối tác</span><span className="text-right font-medium">{collaborator?.collaborators_name || row.legacy_middleman_display_name || (row.collaborator_id ? 'Chưa đặt tên' : 'Không liên kết')}</span><span className="text-slate-500">Tổng</span><span className="text-right font-semibold">{money(row.document_total, row.currency_code)}</span><span className="text-slate-500">Giảm giá</span><span className="text-right">{rate(row.document_discount_percent)} · {money(row.document_discount_amount, row.currency_code)}</span><span className="text-slate-500">Hoa hồng</span><span className="text-right">{rate(row.commission_percent)} · {money(row.commission_amount, row.currency_code)}</span></div></button>; })}{loading && <div style={styles.empty}>Đang tải…</div>}{!loading && !rows.length && <div style={styles.empty}>Không có giao dịch phù hợp.</div>}</div>

    <div className="hidden overflow-auto rounded-xl border border-slate-200 bg-white md:block" aria-busy={loading}><table style={styles.table}><thead><tr><th style={styles.th}>Chứng từ</th><th style={styles.th}>Loại</th><th style={styles.th}>Ngày</th><th style={styles.th}>Merchant</th><th style={styles.th}>Đối tác</th><th style={styles.th}>Nguồn</th><th style={styles.th}>Tổng</th><th style={styles.th}>Giảm giá</th><th style={styles.th}>Hoa hồng</th>{showAdditional && <><th style={styles.th}>Vòng đời</th><th style={styles.th}>Thanh toán</th><th style={styles.th}>Posting date</th></>}</tr></thead><tbody>{rows.map((row) => {
      const merchant = one(row.merchant); const collaborator = one(row.collaborator);
      return <tr key={row.id} style={styles.row} tabIndex={0} onClick={() => setSelected(row)} onKeyDown={(event) => { if (event.key === 'Enter') setSelected(row); }}>
        <td style={styles.td}><strong>{row.document_number || 'Không có số'}</strong><div style={styles.muted}>#{row.document_index ?? '—'}</div></td><td style={styles.td}>{recordKind(row.record_kind)}</td><td style={styles.td}>{date(row.document_date_utc)}</td>
        <td style={styles.td}>{merchant?.merchant_name || row.legacy_restaurant_display_name || (row.merchant_id ? 'Merchant chưa đặt tên' : 'Không liên kết merchant')}<div style={styles.muted}>{merchant?.merchant_code || '—'}</div></td>
        <td style={styles.td}>{collaborator?.collaborators_name || row.legacy_middleman_display_name || (row.collaborator_id ? 'Đối tác chưa đặt tên' : 'Không liên kết đối tác')}<div style={styles.muted}>{collaborator?.collaborators_code || '—'}</div></td>
        <td style={styles.td}>{sourceStatus(row.legacy_status)}</td><td style={styles.td}>{money(row.document_total, row.currency_code)}</td><td style={styles.td}>{rate(row.document_discount_percent)}<div style={styles.muted}>{money(row.document_discount_amount, row.currency_code)}</div></td><td style={styles.td}>{rate(row.commission_percent)}<div style={styles.muted}>{money(row.commission_amount, row.currency_code)}</div></td>
        {showAdditional && <><td style={styles.td}>{row.lifecycle_status || '—'}</td><td style={styles.td}>{row.payment_status || '—'}</td><td style={styles.td}>{date(row.posting_date_utc)}</td></>}
      </tr>;
    })}</tbody></table>{loading && <div style={styles.empty}>Đang tải…</div>}{!loading && !rows.length && <div style={styles.empty}>Không có giao dịch phù hợp.</div>}</div>

    <div style={styles.pagination}><span>{report ? `${report.total} bản ghi · Trang ${report.page}/${Math.max(report.page_count, 1)}` : '—'} · {statusSummary}</span><div style={styles.actions}><select aria-label="Số dòng mỗi trang" style={styles.compactInput} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select><button style={styles.secondaryButton} disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button><button style={styles.secondaryButton} disabled={!report || page >= report.page_count} onClick={() => setPage(page + 1)}>Sau</button></div></div>

    {selected && <div style={styles.overlay} onClick={() => setSelected(null)}><aside style={styles.drawer} onClick={(e) => e.stopPropagation()} aria-label="Chi tiết giao dịch"><div style={styles.drawerHeader}><div><h3 style={styles.drawerTitle}>{selected.document_number || 'Giao dịch không có số chứng từ'}</h3><div style={styles.muted}>{selected.id}</div></div><button style={styles.close} onClick={() => setSelected(null)} aria-label="Đóng">×</button></div><dl style={styles.details}><Detail label="Loại bản ghi" value={recordKind(selected.record_kind)} /><Detail label="Trạng thái mô phỏng" value={selected.simulation_status} /><Detail label="Trạng thái nguồn" value={sourceStatus(selected.legacy_status)} /><Detail label="Vòng đời V2" value={selected.lifecycle_status} /><Detail label="Thanh toán V2" value={selected.payment_status} /><Detail label="Thanh toán ngoài hệ thống" value={selected.external_settlement_enabled ? 'Được bật' : 'Tắt'} /><Detail label="Tổng chứng từ" value={money(selected.document_total, selected.currency_code)} /><Detail label="Giảm giá" value={`${rate(selected.document_discount_percent)} · ${money(selected.document_discount_amount, selected.currency_code)}`} /><Detail label="Hoa hồng" value={`${rate(selected.commission_percent)} · ${money(selected.commission_amount, selected.currency_code)}`} /><Detail label="Ngày chứng từ" value={date(selected.document_date_utc)} /><Detail label="Ngày hạch toán" value={date(selected.posting_date_utc)} /><Detail label="Ngày xác nhận" value={date(selected.confirmed_at_utc)} /><Detail label="Ngày hoa hồng" value={date(selected.commission_date_utc)} /><Detail label="Ghi chú nguồn" value={selected.legacy_notes} /></dl></aside></div>}
  </div>;
}

function one(value?: Party | Party[] | null) { return Array.isArray(value) ? value[0] : value; }
function Metric({ label, value }: { label: string; value: string }) { return <div style={styles.metric}><div style={styles.metricLabel}>{label}</div><div style={styles.metricValue}>{value}</div></div>; }
function Detail({ label, value }: { label: string; value?: string | null }) { return <div style={styles.detailRow}><dt style={styles.detailLabel}>{label}</dt><dd style={styles.detailValue}>{value || '—'}</dd></div>; }
function sourceStatus(value?: number | null) { return value === null || value === undefined ? 'Không có trong nguồn' : String(value); }
function recordKind(value?: string | null) { return value === 'uat_simulation' ? 'Mô phỏng UAT' : 'Lịch sử V1'; }
function rate(value: unknown) { return value === null || value === undefined || value === '' ? '—' : `${decimal(fractionToPercentagePoints(String(value)))}%`; }
function money(value: unknown, currency?: string | null) { return value === null || value === undefined || value === '' ? '—' : `${decimal(value)} ${currency || 'VND'}`; }
function decimal(value: unknown) { const raw = String(value).trim(); if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) return raw; const negative = raw.startsWith('-'); const [whole, fraction = ''] = raw.replace(/^[+-]/, '').split('.'); const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); const trimmed = fraction.replace(/0+$/, ''); return `${negative ? '-' : ''}${grouped}${trimmed ? `,${trimmed}` : ''}`; }
function date(value?: string | null) { if (!value) return '—'; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('vi-VN'); }

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'grid', gap: 16 }, cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }, metric: { background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }, metricLabel: { color: '#64748b', fontSize: 13 }, metricValue: { fontWeight: 750, marginTop: 6, fontSize: 18 },
  filters: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }, label: { color: '#475569', fontSize: 12, fontWeight: 700 }, input: { display: 'block', width: '100%', marginTop: 6, padding: '9px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', boxSizing: 'border-box' }, checkbox: { alignSelf: 'end', minHeight: 38, display: 'flex', alignItems: 'center', gap: 8, color: '#334155', fontSize: 13 }, filterActions: { display: 'flex', alignItems: 'end', gap: 8 }, primaryButton: { border: 0, borderRadius: 8, padding: '10px 14px', color: '#fff', background: '#0f766e', cursor: 'pointer' }, secondaryButton: { border: '1px solid #cbd5e1', borderRadius: 8, padding: '9px 12px', color: '#334155', background: '#fff', cursor: 'pointer' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }, toolbarControls: { display: 'flex', alignItems: 'end', gap: 8, flexWrap: 'wrap' }, compactLabel: { color: '#475569', fontSize: 12, fontWeight: 700 }, compactInput: { display: 'block', marginTop: 4, padding: '8px 9px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }, notice: { flex: 1, minWidth: 280, background: '#fff7ed', color: '#9a3412', padding: 12, borderRadius: 8, fontSize: 13 }, error: { background: '#fef2f2', color: '#b91c1c', padding: 12, borderRadius: 8 }, wrapper: { overflow: 'auto', background: 'white', border: '1px solid #e2e8f0', borderRadius: 12 }, table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 }, th: { textAlign: 'left', padding: 12, background: '#f8fafc', color: '#475569', whiteSpace: 'nowrap' }, row: { borderTop: '1px solid #e2e8f0', cursor: 'pointer' }, td: { padding: 12, verticalAlign: 'top', minWidth: 110 }, muted: { color: '#64748b', fontSize: 12, marginTop: 3 }, empty: { padding: 32, textAlign: 'center', color: '#64748b' }, pagination: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', color: '#64748b', fontSize: 13 }, actions: { display: 'flex', gap: 8, alignItems: 'center' },
  overlay: { position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end', background: 'rgba(15,23,42,.45)' }, drawer: { width: 'min(560px,100%)', height: '100%', overflow: 'auto', padding: 24, background: '#fff', boxShadow: '-10px 0 30px rgba(15,23,42,.15)' }, drawerHeader: { display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 24 }, drawerTitle: { margin: 0, fontSize: 22 }, close: { border: 0, background: 'transparent', fontSize: 28, cursor: 'pointer' }, details: { margin: 0, display: 'grid', gap: 10 }, detailRow: { display: 'grid', gridTemplateColumns: '145px 1fr', gap: 12, paddingBottom: 10, borderBottom: '1px solid #e2e8f0' }, detailLabel: { color: '#64748b', fontWeight: 650 }, detailValue: { margin: 0, overflowWrap: 'anywhere' },
};
