"use client";

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

type Approval = { id: string; status: string; decision_reason?: string | null };
type MediaAsset = { id: string; original_filename?: string; mime_type?: string; size_bytes?: number; publication_status?: string; is_hero?: boolean; display_order?: number; approval_requests?: Approval[]; signedUrl?: string };
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const EFFECTIVE = ['legacy_effective', 'preexisting_effective', 'approved'];

export default function MediaManager({ title = 'Hình ảnh' }: { title?: string }) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<'main' | 'gallery'>('gallery');
  const load = useCallback(async () => {
    const rows: MediaAsset[] = await apiFetch('/media/me');
    setItems(await Promise.all(rows.map(async (item) => { try { const signed = await apiFetch(`/media/${item.id}/signed-url`); return { ...item, signedUrl: signed.signedUrl }; } catch { return item; } })));
  }, []);
  useEffect(() => { load().catch((err) => setError(err.message || 'Không thể tải hình ảnh')); }, [load]);

  async function upload(file?: File, target?: MediaAsset) {
    if (!file) return;
    if (!TYPES.includes(file.type)) return setError('Chỉ hỗ trợ JPEG, PNG hoặc WebP');
    if (file.size > 5 * 1024 * 1024) return setError('Kích thước ảnh tối đa là 5 MB');
    setBusy(true); setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Không thể đọc file')); reader.readAsDataURL(file); });
      await apiFetch('/media/upload', { method: 'POST', body: JSON.stringify({ filename: file.name, mime_type: file.type, size_bytes: file.size, base64_data: dataUrl.split(',', 2)[1], action: target ? 'replace' : 'add', slot: target?.is_hero ? 'main' : target ? 'gallery' : slot, ...(target ? { target_media_id: target.id } : {}) }) });
      await load();
    } catch (err: any) { setError(err.message || 'Không thể tải ảnh lên'); } finally { setBusy(false); }
  }

  async function cancel(item: MediaAsset) {
    const request = item.approval_requests?.find((candidate) => candidate.status === 'pending');
    if (!request || !confirm('Hủy đề xuất đang chờ duyệt?')) return;
    setBusy(true); try { await apiFetch(`/media/requests/${request.id}`, { method: 'DELETE' }); await load(); } catch (err: any) { setError(err.message || 'Không thể hủy'); } finally { setBusy(false); }
  }

  async function change(item: MediaAsset, action: 'remove' | 'reorder') {
    const order = action === 'reorder' ? Number(prompt('Thứ tự mới', String(item.display_order ?? 0))) : undefined;
    if (action === 'reorder' && (!Number.isInteger(order) || Number(order) < 0)) return;
    if (action === 'remove' && !confirm('Gửi yêu cầu gỡ? Ảnh hiện tại vẫn hiệu lực tới khi Admin duyệt.')) return;
    setBusy(true); try { await apiFetch('/media/requests/change', { method: 'POST', body: JSON.stringify({ action, target_media_id: item.id, ...(order === undefined ? {} : { display_order: order }) }) }); await load(); } catch (err: any) { setError(err.message || 'Không thể gửi yêu cầu'); } finally { setBusy(false); }
  }

  return <section style={styles.card}><div style={styles.header}><div><h2 style={styles.title}>{title}</h2><p style={styles.help}>Mọi ảnh mới, thay thế, gỡ hoặc đổi thứ tự phải được Platform Admin phê duyệt.</p></div><div style={styles.controls}><select value={slot} onChange={(event) => setSlot(event.target.value as 'main' | 'gallery')} style={styles.select}><option value="main">Ảnh chính</option><option value="gallery">Thư viện</option></select><label style={styles.button}>{busy ? 'Đang xử lý…' : 'Đề xuất ảnh'}<input type="file" accept={TYPES.join(',')} disabled={busy} onChange={(event) => upload(event.target.files?.[0])} style={{ display: 'none' }} /></label></div></div>{error && <p style={styles.error}>{error}</p>}<div style={styles.grid}>{items.map((item) => { const request = item.approval_requests?.[0]; const effective = EFFECTIVE.includes(item.publication_status || ''); return <article key={item.id} style={styles.item}>{item.signedUrl ? <img src={item.signedUrl} alt={item.original_filename || 'Media'} style={styles.image} /> : <div style={styles.missing}>Không thể xem</div>}<div style={styles.name}>{item.original_filename || item.id}</div><div style={styles.meta}>{item.mime_type} · {Math.ceil(Number(item.size_bytes || 0) / 1024)} KB</div><span style={{ ...styles.badge, ...(effective ? styles.effective : item.publication_status === 'rejected' ? styles.rejected : styles.pending) }}>{label(item.publication_status)}</span>{request?.decision_reason && <p style={styles.reason}>Lý do: {request.decision_reason}</p>}<div style={styles.actions}>{request?.status === 'pending' && <button type="button" onClick={() => cancel(item)} style={styles.secondary}>Hủy đề xuất</button>}{effective && <><label style={styles.secondary}>Thay ảnh<input type="file" accept={TYPES.join(',')} disabled={busy} onChange={(event) => upload(event.target.files?.[0], item)} style={{ display: 'none' }} /></label><button type="button" onClick={() => change(item, 'reorder')} style={styles.secondary}>Đổi thứ tự</button><button type="button" onClick={() => change(item, 'remove')} style={styles.danger}>Yêu cầu gỡ</button></>}</div></article>; })}{!items.length && <p style={styles.help}>Chưa có hình ảnh.</p>}</div></section>;
}

function label(status?: string) { return ({ pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Bị từ chối', cancelled: 'Đã hủy', legacy_effective: 'Ảnh V1 lưu giữ', preexisting_effective: 'Ảnh có trước quy trình', superseded: 'Đã thay thế', removed: 'Đã gỡ', failed: 'Tải lỗi' } as Record<string, string>)[status || ''] || status || 'Chưa phân loại'; }
const styles: Record<string, React.CSSProperties> = { card: { background: 'white', borderRadius: 12, padding: 24, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,.1)' }, header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }, title: { fontSize: 18, margin: 0 }, help: { color: '#64748b', fontSize: 13 }, controls: { display: 'flex', gap: 8 }, select: { border: '1px solid #cbd5e1', borderRadius: 8, padding: '9px 10px', background: '#fff' }, button: { background: '#ea580c', color: 'white', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }, error: { color: '#b91c1c', background: '#fef2f2', padding: 10, borderRadius: 8 }, grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 16, marginTop: 16 }, item: { border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, minWidth: 0 }, image: { width: '100%', height: 130, objectFit: 'cover', borderRadius: 6 }, missing: { height: 130, display: 'grid', placeItems: 'center', background: '#f8fafc', color: '#64748b' }, name: { fontSize: 13, fontWeight: 600, marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis' }, meta: { fontSize: 11, color: '#64748b', marginTop: 4 }, badge: { display: 'inline-block', marginTop: 8, borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 700 }, effective: { background: '#dcfce7', color: '#166534' }, pending: { background: '#fef3c7', color: '#92400e' }, rejected: { background: '#fee2e2', color: '#991b1b' }, reason: { color: '#991b1b', fontSize: 12 }, actions: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }, secondary: { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 7, padding: '6px 8px', cursor: 'pointer' }, danger: { border: '1px solid #fecaca', background: '#fff1f2', color: '#be123c', borderRadius: 7, padding: '6px 8px', cursor: 'pointer' } };
