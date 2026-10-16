"use client";

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

type Transaction = {
  id: string;
  document_number?: string | null;
  document_date_utc?: string | null;
  merchant_id?: string | null;
  collaborator_id?: string | null;
  legacy_status?: number | null;
  lifecycle_status?: string | null;
  payment_status?: string | null;
  document_total?: string | number;
  document_discount_amount?: string | number;
  commission_amount?: string | number;
  currency_code?: string | null;
};

type Summary = {
  transaction_count: number;
  commission_amount: string;
  document_total: string;
  payment_statuses: Record<string, number>;
};

export default function FinancialHistory({ admin = false }: { admin?: boolean }) {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch(admin ? '/transactions' : '/transactions/me'),
      apiFetch(admin ? '/commissions' : '/commissions/me'),
    ]).then(([transactions, commission]) => {
      setRows(transactions || []);
      setSummary(commission);
    }).catch((err) => setError(err.message || 'Không thể tải dữ liệu giao dịch'));
  }, [admin]);

  return (
    <div>
      {error && <div style={styles.error}>{error}</div>}
      {summary && (
        <div style={styles.cards}>
          <Metric label="Giao dịch" value={String(summary.transaction_count)} />
          <Metric label="Tổng chứng từ" value={money(summary.document_total)} />
          <Metric label="Tổng hoa hồng" value={money(summary.commission_amount)} />
          <Metric label="Trạng thái thanh toán" value={Object.entries(summary.payment_statuses).map(([key, count]) => `${key}: ${count}`).join(' · ') || '—'} />
        </div>
      )}
      <div style={styles.notice}>Các trạng thái nguồn được hiển thị nguyên trạng. Màn hình này không suy diễn “đã trả” hoặc “đã quyết toán”.</div>
      <div style={styles.wrapper}>
        <table style={styles.table}>
          <thead><tr><th style={styles.th}>Chứng từ</th><th style={styles.th}>Ngày</th><th style={styles.th}>Đối tượng</th><th style={styles.th}>Trạng thái nguồn</th><th style={styles.th}>Vòng đời</th><th style={styles.th}>Thanh toán</th><th style={styles.th}>Tổng</th><th style={styles.th}>Giảm giá</th><th style={styles.th}>Hoa hồng</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.id} style={styles.row}>
              <td style={styles.td}>{row.document_number || row.id}</td>
              <td style={styles.td}>{date(row.document_date_utc)}</td>
              <td style={styles.td}>{row.merchant_id ? `Merchant ${row.merchant_id}` : 'Không liên kết merchant'}<br />{row.collaborator_id ? `Collaborator ${row.collaborator_id}` : 'Không liên kết collaborator'}</td>
              <td style={styles.td}>{row.legacy_status ?? 'null'}</td>
              <td style={styles.td}>{row.lifecycle_status || 'unmapped'}</td>
              <td style={styles.td}>{row.payment_status || 'unverified'}</td>
              <td style={styles.td}>{money(row.document_total, row.currency_code)}</td>
              <td style={styles.td}>{money(row.document_discount_amount, row.currency_code)}</td>
              <td style={styles.td}>{money(row.commission_amount, row.currency_code)}</td>
            </tr>
          ))}</tbody>
        </table>
        {!rows.length && <div style={styles.empty}>Chưa có giao dịch.</div>}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={styles.metric}><div style={styles.metricLabel}>{label}</div><div style={styles.metricValue}>{value}</div></div>;
}

function money(value: unknown, currency?: string | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? `${parsed.toLocaleString('vi-VN', { maximumFractionDigits: 4 })} ${currency || 'VND'}` : String(value ?? '—');
}

function date(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('vi-VN');
}

const styles: Record<string, React.CSSProperties> = {
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 16 },
  metric: { background: 'white', borderRadius: 10, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.1)' },
  metricLabel: { color: '#64748b', fontSize: 13 },
  metricValue: { fontWeight: 700, marginTop: 6, overflowWrap: 'anywhere' },
  notice: { background: '#fff7ed', color: '#9a3412', padding: 12, borderRadius: 8, marginBottom: 16 },
  error: { background: '#fef2f2', color: '#b91c1c', padding: 12, borderRadius: 8, marginBottom: 16 },
  wrapper: { overflow: 'auto', background: 'white', borderRadius: 10 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: 12, background: '#f8fafc', whiteSpace: 'nowrap' },
  row: { borderTop: '1px solid #e2e8f0' },
  td: { padding: 12, verticalAlign: 'top', minWidth: 110, overflowWrap: 'anywhere' },
  empty: { padding: 32, textAlign: 'center', color: '#64748b' },
};
