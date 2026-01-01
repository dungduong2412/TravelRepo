"use client";

import { useState, useEffect } from 'react';
import { apiFetch } from '../../../../lib/api';
import { useRouter } from 'next/navigation';

export default function CollaboratorProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const [collaborator, setCollaborator] = useState<any>(null);
  const [qrCode, setQrCode] = useState<string>('');
  
  const [formData, setFormData] = useState({
    collaborators_name: '',
    collaborators_phone: '',
    collaborators_email: '',
    collaborators_bank_name: '',
    collaborators_bank_acc_name: '',
    collaborators_bank_acc_number: '',
    collaborators_avatar_url: '',
  });

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/collaborators/me');
      setCollaborator(data);
      setFormData({
        collaborators_name: data.collaborators_name || '',
        collaborators_phone: data.collaborators_phone || '',
        collaborators_email: data.collaborators_email || '',
        collaborators_bank_name: data.collaborators_bank_name || '',
        collaborators_bank_acc_name: data.collaborators_bank_acc_name || '',
        collaborators_bank_acc_number: data.collaborators_bank_acc_number || '',
        collaborators_avatar_url: data.collaborators_avatar_url || '',
      });

      // Fetch QR code if verified
      if (data.collaborators_verified) {
        try {
          const qrData = await apiFetch('/collaborators/me/qr-code');
          setQrCode(qrData.qr_code);
        } catch (qrErr) {
          console.error('Failed to load QR code:', qrErr);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Không thể tải thông tin');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await apiFetch('/collaborators/me', {
        method: 'PUT',
        body: JSON.stringify(formData),
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Không thể cập nhật');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={styles.loading}>Đang tải...</div>;
  }

  return (
    <div>
      <h1 style={styles.title}>Hồ Sơ Cá Nhân</h1>
      <p style={styles.subtitle}>Quản lý thông tin cá nhân của bạn</p>

      {/* QR Code Section - MOST IMPORTANT */}
      {collaborator?.collaborators_verified && qrCode && (
        <div style={styles.qrCard}>
          <h2 style={styles.qrTitle}>💰 Mã QR Kiếm Tiền Của Bạn</h2>
          <p style={styles.qrDescription}>
            Chia sẻ mã này với khách hàng để nhận hoa hồng từ mỗi đơn hàng
          </p>
          <div style={styles.qrContainer}>
            <div style={styles.qrImageWrapper}>
              <img src={qrCode} alt="QR Code" style={styles.qrImage} />
            </div>
            <div style={styles.qrInfo}>
              <div style={styles.qrInfoItem}>
                <span style={styles.qrIcon}>✅</span>
                <div>
                  <p style={styles.qrInfoTitle}>Mã: {collaborator.collaborators_code}</p>
                  <p style={styles.qrInfoSubtitle}>Mã cộng tác viên của bạn</p>
                </div>
              </div>
              <div style={styles.qrInfoItem}>
                <span style={styles.qrIcon}>💵</span>
                <div>
                  <p style={styles.qrInfoTitle}>Nhận hoa hồng tự động</p>
                  <p style={styles.qrInfoSubtitle}>Từ mỗi đơn hàng qua mã QR này</p>
                </div>
              </div>
              <div style={styles.qrInfoItem}>
                <span style={styles.qrIcon}>⭐</span>
                <div>
                  <p style={styles.qrInfoTitle}>Đánh giá: {collaborator.collaborators_rating || 'Chưa có'}</p>
                  <p style={styles.qrInfoSubtitle}>Xếp hạng hiện tại</p>
                </div>
              </div>
              <a
                href={qrCode}
                download={`QR_${collaborator.collaborators_code}.png`}
                style={styles.downloadButton}
              >
                📥 Tải Mã QR
              </a>
            </div>
          </div>
        </div>
      )}

      {collaborator && !collaborator.collaborators_verified && (
        <div style={styles.pendingCard}>
          <span style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</span>
          <p style={styles.pendingText}>
            Tài khoản của bạn đang chờ admin phê duyệt. Sau khi được phê duyệt, bạn sẽ nhận được mã QR để kiếm tiền.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} style={styles.form}>
        {collaborator && (
          <div style={styles.infoCard}>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Mã Cộng Tác Viên:</span>
              <span style={styles.infoValue}>{collaborator.collaborators_code}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Trạng Thái:</span>
              <span style={{
                ...styles.infoValue,
                color: collaborator.collaborators_verified ? '#16a34a' : '#f59e0b',
                fontWeight: 600,
              }}>
                {collaborator.collaborators_verified ? '✓ Đã Phê Duyệt' : '⏳ Chờ Phê Duyệt'}
              </span>
            </div>
            {collaborator.collaborators_rating && (
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>Đánh Giá:</span>
                <span style={styles.infoValue}>⭐ {collaborator.collaborators_rating}</span>
              </div>
            )}
          </div>
        )}

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Thông Tin Cá Nhân</h2>
          
          <div style={styles.formGroup}>
            <label style={styles.label}>Họ và Tên</label>
            <input
              name="collaborators_name"
              value={formData.collaborators_name}
              onChange={handleChange}
              style={styles.input}
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Số Điện Thoại</label>
            <input
              name="collaborators_phone"
              value={formData.collaborators_phone}
              onChange={handleChange}
              style={styles.input}
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Email</label>
            <input
              name="collaborators_email"
              type="email"
              value={formData.collaborators_email}
              onChange={handleChange}
              style={styles.input}
              required
            />
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Thông Tin Ngân Hàng</h2>
          
          <div style={styles.formGroup}>
            <label style={styles.label}>Tên Ngân Hàng</label>
            <input
              name="collaborators_bank_name"
              value={formData.collaborators_bank_name}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Tên Chủ Tài Khoản</label>
            <input
              name="collaborators_bank_acc_name"
              value={formData.collaborators_bank_acc_name}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Số Tài Khoản</label>
            <input
              name="collaborators_bank_acc_number"
              value={formData.collaborators_bank_acc_number}
              onChange={handleChange}
              style={styles.input}
            />
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}
        {success && <div style={styles.success}>✓ Cập nhật thành công!</div>}

        <button type="submit" disabled={saving} style={styles.submitButton}>
          {saving ? 'Đang lưu...' : 'Lưu Thay Đổi'}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  loading: {
    textAlign: 'center',
    padding: '40px',
    color: '#6b7280',
  },
  title: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#111827',
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#6b7280',
    marginBottom: '32px',
  },
  infoCard: {
    backgroundColor: '#f3f4f6',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '24px',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  infoLabel: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#6b7280',
  },
  infoValue: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#111827',
    fontFamily: 'monospace',
  },
  qrCard: {
    backgroundColor: 'white',
    background: 'linear-gradient(135deg, #fff5f5 0%, #fffbea 100%)',
    borderRadius: '16px',
    padding: '32px',
    marginBottom: '32px',
    boxShadow: '0 4px 6px rgba(255, 56, 92, 0.15)',
    border: '2px solid #FF385C',
  },
  qrTitle: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#FF385C',
    marginBottom: '8px',
  },
  qrDescription: {
    fontSize: '16px',
    color: '#6b7280',
    marginBottom: '24px',
  },
  qrContainer: {
    display: 'flex',
    flexDirection: 'row',
    gap: '32px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  qrImageWrapper: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  },
  qrImage: {
    width: '240px',
    height: '240px',
    display: 'block',
  },
  qrInfo: {
    flex: 1,
    minWidth: '300px',
  },
  qrInfoItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    marginBottom: '20px',
  },
  qrIcon: {
    fontSize: '28px',
  },
  qrInfoTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#111827',
    marginBottom: '4px',
  },
  qrInfoSubtitle: {
    fontSize: '14px',
    color: '#6b7280',
  },
  downloadButton: {
    display: 'inline-block',
    padding: '12px 24px',
    backgroundColor: '#FF385C',
    color: 'white',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 600,
    textDecoration: 'none',
    cursor: 'pointer',
    marginTop: '8px',
  },
  pendingCard: {
    backgroundColor: '#fffbea',
    border: '2px solid #fcd34d',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '32px',
    textAlign: 'center',
  },
  pendingText: {
    fontSize: '16px',
    color: '#92400e',
  },
  form: {
    maxWidth: '800px',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  cardTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#111827',
    marginBottom: '20px',
  },
  formGroup: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 500,
    color: '#374151',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  error: {
    padding: '12px',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    color: '#dc2626',
    fontSize: '14px',
    marginBottom: '16px',
  },
  success: {
    padding: '12px',
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '8px',
    color: '#16a34a',
    fontSize: '14px',
    marginBottom: '16px',
  },
  submitButton: {
    padding: '12px 24px',
    backgroundColor: '#FF385C',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
