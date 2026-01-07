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
  const [avatarPreview, setAvatarPreview] = useState<string>('');
  
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
      
      // Get collaborator ID from localStorage
      const collaboratorData = localStorage.getItem('collaborator');
      if (!collaboratorData) {
        setError('Không tìm thấy thông tin đăng nhập. Vui lòng đăng nhập lại.');
        setLoading(false);
        return;
      }
      
      const { id } = JSON.parse(collaboratorData);
      
      // Fetch collaborator profile
      const data = await apiFetch(`/collaborators/${id}`);
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
      
      // Set avatar preview if exists
      if (data.collaborators_avatar_url) {
        setAvatarPreview(data.collaborators_avatar_url);
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

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('Ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn 10MB');
      return;
    }

    // Check file type
    if (!file.type.startsWith('image/')) {
      setError('Vui lòng chọn file ảnh');
      return;
    }

    // Convert to base64
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setAvatarPreview(base64String);
      setFormData(prev => ({ ...prev, collaborators_avatar_url: base64String }));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const collaboratorData = localStorage.getItem('collaborator');
      if (!collaboratorData) {
        setError('Không tìm thấy thông tin đăng nhập');
        setSaving(false);
        return;
      }
      
      const { id } = JSON.parse(collaboratorData);
      
      await apiFetch(`/collaborators/${id}`, {
        method: 'PATCH',
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

      {collaborator && !collaborator.collaborators_verified && (
        <div style={styles.pendingCard}>
          <span style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</span>
          <p style={styles.pendingText}>
            Tài khoản của bạn đang chờ admin phê duyệt.
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
          
          {/* Avatar Upload Section */}
          <div style={styles.avatarSection}>
            <label style={styles.label}>Ảnh Đại Diện</label>
            <div style={styles.avatarContainer}>
              <div style={styles.avatarCircle}>
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar" style={styles.avatarImage} />
                ) : (
                  <div style={styles.avatarPlaceholder}>
                    <span style={{ fontSize: '48px' }}>👤</span>
                  </div>
                )}
              </div>
              <div style={styles.avatarUpload}>
                <label htmlFor="avatar-upload" style={styles.uploadButton}>
                  📷 Chọn Ảnh
                </label>
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  style={styles.fileInput}
                />
                <p style={styles.uploadHint}>Kích thước tối đa: 10MB</p>
              </div>
            </div>
          </div>
          
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
  avatarSection: {
    marginBottom: '24px',
  },
  avatarContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
    marginTop: '12px',
  },
  avatarCircle: {
    width: '120px',
    height: '120px',
    borderRadius: '50%',
    overflow: 'hidden',
    border: '3px solid #e5e7eb',
    backgroundColor: '#f9fafb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  avatarPlaceholder: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    backgroundColor: '#f3f4f6',
  },
  avatarUpload: {
    flex: 1,
  },
  uploadButton: {
    display: 'inline-block',
    padding: '10px 20px',
    backgroundColor: '#4f46e5',
    color: 'white',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  uploadHint: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '8px',
  },
  fileInput: {
    display: 'none',
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
