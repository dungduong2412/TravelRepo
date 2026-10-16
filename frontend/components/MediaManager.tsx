"use client";

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

type MediaAsset = {
  id: string;
  original_filename?: string;
  mime_type?: string;
  size_bytes?: number;
  transfer_status?: string;
  signedUrl?: string;
};

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

export default function MediaManager({ title = 'Hình ảnh' }: { title?: string }) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const media: MediaAsset[] = await apiFetch('/media/me');
    const signed = await Promise.all(media.map(async (item) => {
      try {
        const result = await apiFetch(`/media/${item.id}/signed-url`);
        return { ...item, signedUrl: result.signedUrl };
      } catch {
        return item;
      }
    }));
    setItems(signed);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message || 'Không thể tải hình ảnh'));
  }, []);

  const upload = async (file?: File) => {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Chỉ hỗ trợ JPEG, PNG hoặc WebP');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('Kích thước ảnh tối đa là 5 MB');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Không thể đọc file'));
        reader.readAsDataURL(file);
      });
      await apiFetch('/media/upload', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          base64_data: dataUrl.split(',', 2)[1],
        }),
      });
      await load();
    } catch (err: any) {
      setError(err.message || 'Không thể tải ảnh lên');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>{title}</h2>
          <p style={styles.help}>Kho riêng tư; JPEG, PNG hoặc WebP, tối đa 5 MB.</p>
        </div>
        <label style={styles.button}>
          {busy ? 'Đang tải…' : 'Tải ảnh lên'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(event) => upload(event.target.files?.[0])}
            style={{ display: 'none' }}
          />
        </label>
      </div>
      {error && <p style={styles.error}>{error}</p>}
      <div style={styles.grid}>
        {items.map((item) => (
          <div key={item.id} style={styles.item}>
            {item.signedUrl ? <img src={item.signedUrl} alt={item.original_filename || 'Media'} style={styles.image} /> : <div style={styles.missing}>Không thể xem</div>}
            <div style={styles.name}>{item.original_filename || item.id}</div>
            <div style={styles.meta}>{item.mime_type} · {Math.ceil(Number(item.size_bytes || 0) / 1024)} KB</div>
          </div>
        ))}
        {!items.length && <p style={styles.help}>Chưa có hình ảnh.</p>}
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: { background: 'white', borderRadius: 12, padding: 24, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,.1)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  title: { fontSize: 18, margin: 0 },
  help: { color: '#64748b', fontSize: 13 },
  button: { background: '#ea580c', color: 'white', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
  error: { color: '#b91c1c', background: '#fef2f2', padding: 10, borderRadius: 8 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 16, marginTop: 16 },
  item: { border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, minWidth: 0 },
  image: { width: '100%', height: 120, objectFit: 'cover', borderRadius: 6 },
  missing: { height: 120, display: 'grid', placeItems: 'center', background: '#f8fafc', color: '#64748b' },
  name: { fontSize: 13, fontWeight: 600, marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis' },
  meta: { fontSize: 11, color: '#64748b', marginTop: 4 },
};
