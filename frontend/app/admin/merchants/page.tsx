'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';

type MerchantFilter = 'all' | 'pending' | 'active';

interface Merchant {
  merchant_system_id: string;
  merchant_code?: string | null;
  merchant_name?: string | null;
  merchant_description?: string | null;
  merchant_phone?: string | null;
  merchant_email?: string | null;
  merchant_contact_phone?: string | null;
  owner_email?: string | null;
  new_address_city?: string | null;
  new_address_ward?: string | null;
  new_address_line?: string | null;
  merchant_verified?: boolean;
  merchants_status?: string | null;
  merchant_registered_date?: string | null;
}

function merchantStatus(merchant: Merchant) {
  return merchant.merchants_status?.toLowerCase() ||
    (merchant.merchant_verified ? 'active' : 'pending');
}

export default function AdminMerchantsPage() {
  const [items, setItems] = useState<Merchant[]>([]);
  const [filter, setFilter] = useState<MerchantFilter>('all');
  const [selected, setSelected] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ owner_email: '', merchant_name: '', merchant_email: '', merchant_phone: '' });

  async function fetchMerchants() {
    try {
      setLoading(true);
      setError(null);
      setItems((await api.get('/merchants')) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load merchants');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMerchants();
  }, []);

  const visibleItems = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((merchant) => merchantStatus(merchant) === filter);
  }, [filter, items]);

  async function runAction(
    merchant: Merchant,
    action: 'approve' | 'reject' | 'deactivate',
  ) {
    if (!confirm(`Are you sure you want to ${action} ${merchant.merchant_name || 'this merchant'}?`)) return;

    try {
      setActionId(merchant.merchant_system_id);
      setError(null);
      if (action === 'deactivate') {
        await api.delete(`/merchants/${merchant.merchant_system_id}`);
      } else {
        await api.post(`/merchants/${merchant.merchant_system_id}/${action}`);
      }
      setSelected(null);
      await fetchMerchants();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to ${action} merchant`);
    } finally {
      setActionId(null);
    }
  }

  async function createMerchant(event: React.FormEvent) {
    event.preventDefault();
    try {
      setError(null);
      await api.post('/merchants/admin', {
        owner_email: createForm.owner_email,
        merchant_name: createForm.merchant_name,
        merchant_email: createForm.merchant_email || undefined,
        merchant_phone: createForm.merchant_phone || undefined,
      });
      setCreateForm({ owner_email: '', merchant_name: '', merchant_email: '', merchant_phone: '' });
      setShowCreate(false);
      await fetchMerchants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create merchant');
    }
  }

  if (loading) return <div style={styles.state}>Loading merchants...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Merchant Management</h2>
          <p style={styles.subtitle}>{items.length} merchants from the live merchant directory</p>
        </div>
        <div style={styles.filters}>
          <button type="button" onClick={() => setShowCreate(true)} style={styles.createButton}>Create merchant</button>
          {(['all', 'pending', 'active'] as MerchantFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              style={{ ...styles.filterButton, ...(filter === value ? styles.filterButtonActive : {}) }}
            >
              {value.charAt(0).toUpperCase() + value.slice(1)} ({
                value === 'all'
                  ? items.length
                  : items.filter((merchant) => merchantStatus(merchant) === value).length
              })
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={fetchMerchants} style={styles.retryButton}>Retry</button>
        </div>
      )}

      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Merchant</th>
              <th style={styles.th}>Code</th>
              <th style={styles.th}>Contact</th>
              <th style={styles.th}>Location</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((merchant) => {
              const status = merchantStatus(merchant);
              const isPending = status === 'pending';
              const isActive = status === 'active';
              return (
                <tr key={merchant.merchant_system_id} style={styles.row}>
                  <td style={styles.td}>
                    <strong>{merchant.merchant_name || 'Unnamed merchant'}</strong>
                    <div style={styles.muted}>{merchant.owner_email || merchant.merchant_email || 'No email'}</div>
                  </td>
                  <td style={styles.td}>{merchant.merchant_code || '—'}</td>
                  <td style={styles.td}>{merchant.merchant_phone || merchant.merchant_contact_phone || '—'}</td>
                  <td style={styles.td}>{merchant.new_address_city || '—'}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, ...statusStyle(status) }}>{status.toUpperCase()}</span>
                  </td>
                  <td style={styles.td}>
                    <div style={styles.actions}>
                      <button type="button" onClick={() => setSelected(merchant)} style={styles.viewButton}>View</button>
                      {isPending && (
                        <>
                          <button disabled={actionId === merchant.merchant_system_id} type="button" onClick={() => runAction(merchant, 'approve')} style={styles.approveButton}>Approve</button>
                          <button disabled={actionId === merchant.merchant_system_id} type="button" onClick={() => runAction(merchant, 'reject')} style={styles.rejectButton}>Reject</button>
                        </>
                      )}
                      {isActive && (
                        <button disabled={actionId === merchant.merchant_system_id} type="button" onClick={() => runAction(merchant, 'deactivate')} style={styles.rejectButton}>Deactivate</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibleItems.length === 0 && <div style={styles.state}>No {filter === 'all' ? '' : `${filter} `}merchants found.</div>}
      </div>

      {selected && (
        <div style={styles.modalOverlay} onClick={() => setSelected(null)}>
          <section style={styles.modal} onClick={(event) => event.stopPropagation()} aria-label="Merchant details">
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>{selected.merchant_name || 'Unnamed merchant'}</h3>
                <span style={{ ...styles.badge, ...statusStyle(merchantStatus(selected)) }}>{merchantStatus(selected).toUpperCase()}</span>
              </div>
              <button type="button" onClick={() => setSelected(null)} style={styles.closeButton} aria-label="Close">×</button>
            </div>
            <dl style={styles.details}>
              <Detail label="System ID" value={selected.merchant_system_id} />
              <Detail label="Merchant code" value={selected.merchant_code} />
              <Detail label="Owner email" value={selected.owner_email} />
              <Detail label="Merchant email" value={selected.merchant_email} />
              <Detail label="Phone" value={selected.merchant_phone || selected.merchant_contact_phone} />
              <Detail label="Address" value={[selected.new_address_line, selected.new_address_ward, selected.new_address_city].filter(Boolean).join(', ')} />
              <Detail label="Registered" value={formatDate(selected.merchant_registered_date)} />
              <Detail label="Description" value={selected.merchant_description} />
            </dl>
          </section>
        </div>
      )}

      {showCreate && (
        <div style={styles.modalOverlay} onClick={() => setShowCreate(false)}>
          <form style={styles.modal} onSubmit={createMerchant} onClick={(event) => event.stopPropagation()}>
            <div style={styles.modalHeader}><h3 style={styles.modalTitle}>Create pending merchant</h3><button type="button" onClick={() => setShowCreate(false)} style={styles.closeButton}>×</button></div>
            <label style={styles.detailLabel}>Merchant name<input required value={createForm.merchant_name} onChange={(e) => setCreateForm({ ...createForm, merchant_name: e.target.value })} style={styles.input} /></label>
            <label style={styles.detailLabel}>Owner email<input required type="email" value={createForm.owner_email} onChange={(e) => setCreateForm({ ...createForm, owner_email: e.target.value })} style={styles.input} /></label>
            <label style={styles.detailLabel}>Business email<input type="email" value={createForm.merchant_email} onChange={(e) => setCreateForm({ ...createForm, merchant_email: e.target.value })} style={styles.input} /></label>
            <label style={styles.detailLabel}>Business phone<input value={createForm.merchant_phone} onChange={(e) => setCreateForm({ ...createForm, merchant_phone: e.target.value })} style={styles.input} /></label>
            <p style={styles.muted}>This creates a pending business record only. Account assignment and activation remain separate governed actions.</p>
            <button type="submit" style={styles.approveButton}>Create pending merchant</button>
          </form>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div style={styles.detailRow}>
      <dt style={styles.detailLabel}>{label}</dt>
      <dd style={styles.detailValue}>{value || '—'}</dd>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusStyle(status: string): React.CSSProperties {
  if (status === 'active') return { backgroundColor: '#d1fae5', color: '#065f46' };
  if (status === 'pending') return { backgroundColor: '#fef3c7', color: '#92400e' };
  return { backgroundColor: '#fee2e2', color: '#991b1b' };
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 1400 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 24 },
  title: { margin: 0, color: '#111827', fontSize: 24 },
  subtitle: { color: '#6b7280', margin: '6px 0 0' },
  filters: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  filterButton: { border: 0, borderRadius: 999, padding: '9px 14px', cursor: 'pointer', color: '#374151', background: '#e5e7eb' },
  filterButtonActive: { color: '#fff', background: '#2563eb' },
  createButton: { border: 0, borderRadius: 999, padding: '9px 14px', cursor: 'pointer', color: '#fff', background: '#0f766e' },
  error: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, color: '#991b1b', background: '#fee2e2', borderRadius: 8, padding: 14, marginBottom: 16 },
  retryButton: { border: 0, borderRadius: 6, padding: '7px 12px', cursor: 'pointer' },
  tableWrapper: { overflow: 'auto', background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,.1)' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '12px 14px', textAlign: 'left', color: '#374151', background: '#f9fafb', whiteSpace: 'nowrap' },
  row: { borderTop: '1px solid #e5e7eb' },
  td: { padding: '14px', color: '#111827', verticalAlign: 'top' },
  muted: { color: '#6b7280', fontSize: 13, marginTop: 4 },
  badge: { display: 'inline-block', padding: '4px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700 },
  actions: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  viewButton: { border: 0, borderRadius: 6, padding: '7px 10px', cursor: 'pointer', background: '#e5e7eb', color: '#111827' },
  approveButton: { border: 0, borderRadius: 6, padding: '7px 10px', cursor: 'pointer', background: '#16a34a', color: '#fff' },
  rejectButton: { border: 0, borderRadius: 6, padding: '7px 10px', cursor: 'pointer', background: '#dc2626', color: '#fff' },
  state: { padding: 40, textAlign: 'center', color: '#6b7280' },
  modalOverlay: { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(0,0,0,.5)' },
  modal: { width: '100%', maxWidth: 620, maxHeight: '85vh', overflow: 'auto', borderRadius: 10, padding: 24, background: '#fff' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20 },
  modalTitle: { margin: '0 0 8px', color: '#111827', fontSize: 22 },
  closeButton: { border: 0, background: 'transparent', color: '#4b5563', cursor: 'pointer', fontSize: 28, lineHeight: 1 },
  details: { margin: 0, display: 'grid', gap: 10 },
  detailRow: { display: 'grid', gridTemplateColumns: '140px 1fr', gap: 14, paddingBottom: 10, borderBottom: '1px solid #e5e7eb' },
  detailLabel: { color: '#6b7280', fontWeight: 600 },
  detailValue: { margin: 0, color: '#111827', overflowWrap: 'anywhere' },
  input: { display: 'block', width: '100%', boxSizing: 'border-box', margin: '6px 0 14px', padding: 10, border: '1px solid #cbd5e1', borderRadius: 6 },
};
