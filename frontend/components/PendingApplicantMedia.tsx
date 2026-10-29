'use client';

import { ChangeEvent, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

type MediaRow = {
  id: string;
  original_filename?: string | null;
  publication_status?: string | null;
  approval_requests?: Array<{ id?: string; status?: string; decision_reason?: string | null }>;
};
type Profile = { user_profiles_status?: string; merchant_id?: string | null; collaborator_id?: string | null };

export default function PendingApplicantMedia({ role }: { role: 'merchant' | 'collaborator' }) {
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  async function refresh() {
    try {
      const [media, ownProfile] = await Promise.all([apiFetch('/media/me'), apiFetch('/user-profiles/me')]);
      setRows(media); setProfile(ownProfile);
    } catch { setRows([]); }
  }
  useEffect(() => { refresh(); }, []);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setMessage(null);
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Chỉ hỗ trợ JPEG, PNG hoặc WebP');
      if (file.size > 5 * 1024 * 1024) throw new Error('Ảnh phải nhỏ hơn hoặc bằng 5 MiB');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      await apiFetch('/media/upload', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          base64_data: btoa(binary),
          action: 'add',
          slot: 'main',
          display_order: 0,
          direct_publish: false,
        }),
      });
      setMessage('Ảnh đã được gửi riêng tư và đang chờ Platform Admin duyệt.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải ảnh');
    } finally {
      setBusy(false); event.target.value = '';
    }
  }

  async function resubmit() {
    const entityId = role === 'merchant' ? profile?.merchant_id : profile?.collaborator_id;
    if (!entityId) return;
    setBusy(true); setMessage(null);
    try {
      await apiFetch(`/${role === 'merchant' ? 'merchants' : 'collaborators'}/${entityId}/resubmit`, { method: 'POST' });
      setMessage('Hồ sơ đã được gửi lại để Platform Admin xem xét.'); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể gửi lại hồ sơ'); }
    finally { setBusy(false); }
  }

  async function cancel(id: string) {
    setBusy(true); setMessage(null);
    try { await apiFetch(`/media/requests/${id}`, { method: 'DELETE' }); setMessage('Đã hủy đề xuất ảnh đang chờ.'); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể hủy đề xuất'); }
    finally { setBusy(false); }
  }

  return <section style={styles.section}>
    <div style={styles.statusRow}><div><span style={styles.eyebrow}>Trạng thái hồ sơ</span><strong style={styles.status}>{statusLabel(profile?.user_profiles_status)}</strong></div><a style={styles.link} href={role === 'merchant' ? '/merchant/dashboard/profile' : '/collaborator/dashboard/profile'}>Cập nhật hồ sơ</a></div>
    {profile?.user_profiles_status === 'blocked' && <button type="button" disabled={busy} onClick={resubmit} style={styles.resubmit}>Gửi lại hồ sơ sau khi chỉnh sửa</button>}
    <h2 style={styles.title}>{role === 'merchant' ? 'Ảnh chính doanh nghiệp' : 'Ảnh đại diện cộng tác viên'}</h2>
    <p style={styles.copy}>Ảnh mới luôn ở trạng thái riêng tư cho đến khi Platform Admin phê duyệt.</p>
    <label style={styles.button}>{busy ? 'Đang tải…' : 'Chọn ảnh để gửi'}<input hidden disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} /></label>
    {message && <p style={styles.message}>{message}</p>}
    <ul style={styles.list}>{rows.map((row) => {
      const decision = row.approval_requests?.[0];
      const state = decision?.status || row.publication_status || 'pending';
      return <li key={row.id} style={styles.listItem}><span><strong>{row.original_filename || 'Ảnh'}</strong> — {state}{decision?.decision_reason ? `: ${decision.decision_reason}` : ''}</span>{state === 'pending' && decision?.id && <button type="button" disabled={busy} onClick={() => cancel(decision.id!)} style={styles.cancel}>Hủy</button>}</li>;
    })}</ul>
  </section>;
}

function statusLabel(value?: string) { return value === 'active' ? 'Đã kích hoạt' : value === 'blocked' ? 'Cần chỉnh sửa / đã từ chối' : value === 'pending' ? 'Đang chờ Admin duyệt' : value || 'Đang tải'; }

const styles: Record<string, React.CSSProperties> = {
  section: { width: '100%', borderTop: '1px solid #e5e7eb', paddingTop: 24, textAlign: 'left' },
  title: { margin: '0 0 8px', fontSize: 18, color: '#111827' },
  copy: { color: '#6b7280', lineHeight: 1.5 },
  button: { display: 'inline-block', cursor: 'pointer', padding: '10px 16px', borderRadius: 8, background: '#0f766e', color: '#fff', fontWeight: 700 },
  message: { color: '#334155' },
  list: { paddingLeft: 20, color: '#475569', lineHeight: 1.7 },
  listItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 6 },
  statusRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 18, padding: 14, borderRadius: 10, background: '#f8fafc' },
  eyebrow: { display: 'block', color: '#64748b', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' },
  status: { display: 'block', marginTop: 4, color: '#0f172a' },
  link: { color: '#0369a1', fontWeight: 700, fontSize: 13 },
  resubmit: { marginBottom: 18, border: 0, borderRadius: 8, padding: '10px 14px', background: '#7c3aed', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  cancel: { border: '1px solid #fca5a5', borderRadius: 6, padding: '4px 8px', color: '#b91c1c', background: '#fff', cursor: 'pointer' },
};
