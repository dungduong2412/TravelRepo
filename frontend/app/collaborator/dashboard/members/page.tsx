"use client";

import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../../../lib/api';

interface Member {
  id: string;
  collaborators_name: string;
  collaborators_phone: string;
  collaborators_email: string;
  collaborators_avatar_url?: string;
  collaborators_registered_date: string;
  collaborators_verified: boolean;
}

export default function CollaboratorMembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  
  const [formData, setFormData] = useState({
    collaborators_name: '',
    collaborators_phone: '',
    collaborators_email: '',
    collaborators_bank_name: '',
    collaborators_bank_acc_number: '',
    collaborators_avatar_url: '',
  });
  
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/collaborators/members');
      setMembers(data || []);
    } catch (err: any) {
      setError(err.message || 'Không thể tải danh sách');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  const handleAvatarClick = () => {
    avatarInputRef.current?.click();
  };
  
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      setError('Vui lòng chọn file hình ảnh');
      return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      setError('Kích thước file phải nhỏ hơn 5MB');
      return;
    }
    
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setAvatarPreview(base64String);
      setFormData(prev => ({ ...prev, collaborators_avatar_url: base64String }));
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    setSubmitting(true);
    setError(null);

    try {
      const { collaborators_avatar_url: _avatarPreviewOnly, ...payload } = formData;
      await apiFetch('/collaborators/members', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      
      // Reset form and close modal
      setFormData({
        collaborators_name: '',
        collaborators_phone: '',
        collaborators_email: '',
        collaborators_bank_name: '',
        collaborators_bank_acc_number: '',
        collaborators_avatar_url: '',
      });
      setAvatarPreview(null);
      setShowModal(false);
      
      // Refresh member list
      fetchMembers();
    } catch (err: any) {
      setError(err.message || 'Không thể thêm thành viên');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Thành Viên Nhóm</h1>
          <p style={styles.subtitle}>Quản lý các thành viên trong nhóm của bạn</p>
        </div>
        <button onClick={() => setShowModal(true)} style={styles.addButton}>
          + Thêm Thành Viên
        </button>
      </div>

      {loading ? (
        <div style={styles.loading}>Đang tải...</div>
      ) : members.length === 0 ? (
        <div style={styles.empty}>
          <p style={styles.emptyText}>Chưa có thành viên nào</p>
          <button onClick={() => setShowModal(true)} style={styles.emptyButton}>
            + Thêm Thành Viên Đầu Tiên
          </button>
        </div>
      ) : (
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.tableHeader}>
                <th style={styles.th}>Ảnh</th>
                <th style={styles.th}>Tên</th>
                <th style={styles.th}>Số Điện Thoại</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Ngày Đăng Ký</th>
                <th style={styles.th}>Trạng Thái</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} style={styles.tableRow}>
                  <td style={styles.td}>
                    {member.collaborators_avatar_url ? (
                      <img 
                        src={member.collaborators_avatar_url} 
                        alt={member.collaborators_name}
                        style={styles.avatarSmall}
                      />
                    ) : (
                      <div style={styles.avatarPlaceholderSmall}>👤</div>
                    )}
                  </td>
                  <td style={styles.td}>{member.collaborators_name}</td>
                  <td style={styles.td}>{member.collaborators_phone}</td>
                  <td style={styles.td}>{member.collaborators_email}</td>
                  <td style={styles.td}>
                    {member.collaborators_registered_date 
                      ? new Date(member.collaborators_registered_date).toLocaleDateString('vi-VN')
                      : '-'}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.verifiedBadge}>{member.collaborators_verified ? '✓ Đã xác minh' : '⏳ Chờ duyệt'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Member Modal */}
      {showModal && (
        <div style={styles.modalOverlay} onClick={() => setShowModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Thêm Thành Viên Mới</h2>
            
            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.avatarSection}>
                <div 
                  onClick={handleAvatarClick}
                  style={styles.avatarUpload}
                >
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" style={styles.avatarPreviewImg} />
                  ) : (
                    <div style={styles.avatarPlaceholder}>
                      <span style={styles.avatarIcon}>📷</span>
                      <span style={styles.avatarText}>Thêm Ảnh</span>
                    </div>
                  )}
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  style={{ display: 'none' }}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Họ và Tên *</label>
                <input
                  name="collaborators_name"
                  value={formData.collaborators_name}
                  onChange={handleChange}
                  style={styles.input}
                  required
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Số Điện Thoại *</label>
                <input
                  name="collaborators_phone"
                  value={formData.collaborators_phone}
                  onChange={handleChange}
                  style={styles.input}
                  required
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Email *</label>
                <input
                  name="collaborators_email"
                  type="email"
                  value={formData.collaborators_email}
                  onChange={handleChange}
                  style={styles.input}
                  required
                />
              </div>

              <p style={styles.hint}>Thành viên sẽ tự đăng ký hoặc nhận lời mời được phê duyệt; mật khẩu không đi qua API doanh nghiệp.</p>

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
                <label style={styles.label}>Số Tài Khoản</label>
                <input
                  name="collaborators_bank_acc_number"
                  value={formData.collaborators_bank_acc_number}
                  onChange={handleChange}
                  style={styles.input}
                />
              </div>

              {error && <div style={styles.error}>{error}</div>}

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={styles.cancelButton}
                  disabled={submitting}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  style={styles.submitButton}
                  disabled={submitting}
                >
                  {submitting ? 'Đang thêm...' : 'Thêm Thành Viên'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '32px',
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
  },
  addButton: {
    padding: '12px 24px',
    backgroundColor: '#FF385C',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  loading: {
    textAlign: 'center',
    padding: '40px',
    color: '#6b7280',
  },
  empty: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '80px 24px',
    textAlign: 'center',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  emptyText: {
    fontSize: '18px',
    color: '#6b7280',
    marginBottom: '24px',
  },
  emptyButton: {
    padding: '12px 24px',
    backgroundColor: '#FF385C',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  tableContainer: {
    backgroundColor: 'white',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  tableHeader: {
    backgroundColor: '#f9fafb',
  },
  th: {
    padding: '12px 16px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase',
    borderBottom: '1px solid #e5e7eb',
  },
  tableRow: {
    borderBottom: '1px solid #e5e7eb',
  },
  td: {
    padding: '16px',
    fontSize: '14px',
    color: '#374151',
  },
  avatarSmall: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    objectFit: 'cover',
  },
  avatarPlaceholderSmall: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundColor: '#f3f4f6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
  },
  verifiedBadge: {
    display: 'inline-block',
    padding: '4px 12px',
    backgroundColor: '#dcfce7',
    color: '#16a34a',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '24px',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    textAlign: 'center',
  },
  avatar: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    objectFit: 'cover',
    margin: '0 auto 16px',
  },
  memberName: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#111827',
    marginBottom: '8px',
  },
  memberInfo: {
    fontSize: '14px',
    color: '#6b7280',
    marginBottom: '4px',
  },
  badge: {
    display: 'inline-block',
    marginTop: '12px',
    padding: '4px 12px',
    backgroundColor: '#f3f4f6',
    borderRadius: '12px',
    fontSize: '12px',
    color: '#374151',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '32px',
    maxWidth: '500px',
    width: '90%',
    maxHeight: '90vh',
    overflow: 'auto',
  },
  modalTitle: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#111827',
    marginBottom: '24px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
  },
  avatarSection: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '24px',
  },
  avatarUpload: {
    width: '120px',
    height: '120px',
    borderRadius: '50%',
    border: '2px dashed #d1d5db',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    overflow: 'hidden',
  },
  avatarPreviewImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  avatarPlaceholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  avatarIcon: {
    fontSize: '32px',
    marginBottom: '4px',
  },
  avatarText: {
    fontSize: '12px',
    color: '#6b7280',
  },
  formGroup: {
    marginBottom: '16px',
  },
  hint: { gridColumn: '1 / -1', margin: 0, color: '#64748b', fontSize: '13px', lineHeight: 1.5 },
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
  passwordWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  eyeButton: {
    position: 'absolute',
    right: '12px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '18px',
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
  modalActions: {
    display: 'flex',
    gap: '12px',
    marginTop: '8px',
  },
  cancelButton: {
    flex: 1,
    padding: '12px 24px',
    backgroundColor: 'white',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  submitButton: {
    flex: 1,
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
