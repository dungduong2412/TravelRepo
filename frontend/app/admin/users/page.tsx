"use client";

import { useState, useEffect } from 'react';
import { publicApiFetch } from '../../../lib/api';

interface UserProfile {
  id: string;
  email: string;
  role: 'admin' | 'merchant' | 'collaborator';
  merchant_id?: string | null;
  collaborator_id?: string | null;
  last_login_at?: string | null;
  login_count?: number;
  created_at?: string;
  updated_at?: string;
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    role: 'merchant' as 'admin' | 'merchant' | 'collaborator',
  });
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const data = await publicApiFetch('/user-profiles');
      setUsers(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setAddError(null);

    try {
      await publicApiFetch('/user-profiles/create', {
        method: 'POST',
        body: JSON.stringify(newUser),
      });

      // Reset form and close modal
      setNewUser({ email: '', password: '', role: 'merchant' });
      setShowAddModal(false);

      // Refresh user list
      await fetchUsers();
    } catch (err: any) {
      setAddError(err.message || 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return '#dc2626'; // red
      case 'merchant':
        return '#2563eb'; // blue
      case 'collaborator':
        return '#16a34a'; // green
      default:
        return '#6b7280'; // gray
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':
        return 'Quản Trị Viên';
      case 'merchant':
        return 'Nhà Cung Cấp';
      case 'collaborator':
        return 'Cộng Tác Viên';
      default:
        return role;
    }
  };

  const filteredUsers = users.filter(user =>
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    getRoleLabel(user.role).toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <main style={styles.container}>
        <div style={styles.loadingContainer}>
          <p style={styles.loadingText}>Đang tải dữ liệu...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main style={styles.container}>
        <div style={styles.errorContainer}>
          <p style={styles.errorText}>{error}</p>
          <button onClick={fetchUsers} style={styles.retryButton}>
            Thử Lại
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.container}>
      <div style={styles.content}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Quản Lý Người Dùng</h1>
            <p style={styles.subtitle}>
              Tổng số: {users.length} người dùng
            </p>
          </div>
          <button onClick={() => setShowAddModal(true)} style={styles.addButton}>
            + Thêm Người Dùng
          </button>
        </div>

        <div style={styles.searchContainer}>
          <input
            type="text"
            placeholder="Tìm kiếm theo email hoặc vai trò..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
        </div>

        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.tableHeaderRow}>
                <th style={styles.tableHeader}>Email</th>
                <th style={styles.tableHeader}>Vai Trò</th>
                <th style={styles.tableHeader}>Lần Đăng Nhập Cuối</th>
                <th style={styles.tableHeader}>Số Lần Đăng Nhập</th>
                <th style={styles.tableHeader}>Ngày Tạo</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} style={styles.emptyCell}>
                    Không tìm thấy người dùng
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} style={styles.tableRow}>
                    <td style={styles.tableCell}>
                      <div style={styles.emailContainer}>
                        <span style={styles.email}>{user.email}</span>
                        {user.merchant_id && (
                          <span style={styles.idBadge}>M: {user.merchant_id.slice(0, 8)}</span>
                        )}
                        {user.collaborator_id && (
                          <span style={styles.idBadge}>C: {user.collaborator_id.slice(0, 8)}</span>
                        )}
                      </div>
                    </td>
                    <td style={styles.tableCell}>
                      <span
                        style={{
                          ...styles.roleBadge,
                          backgroundColor: getRoleBadgeColor(user.role),
                        }}
                      >
                        {getRoleLabel(user.role)}
                      </span>
                    </td>
                    <td style={styles.tableCell}>
                      {formatDate(user.last_login_at)}
                    </td>
                    <td style={styles.tableCell}>
                      <span style={styles.loginCount}>
                        {user.login_count || 0} lần
                      </span>
                    </td>
                    <td style={styles.tableCell}>
                      {formatDate(user.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredUsers.length > 0 && (
          <div style={styles.stats}>
            <div style={styles.statCard}>
              <span style={styles.statLabel}>Quản Trị Viên</span>
              <span style={styles.statValue}>
                {users.filter(u => u.role === 'admin').length}
              </span>
            </div>
            <div style={styles.statCard}>
              <span style={styles.statLabel}>Nhà Cung Cấp</span>
              <span style={styles.statValue}>
                {users.filter(u => u.role === 'merchant').length}
              </span>
            </div>
            <div style={styles.statCard}>
              <span style={styles.statLabel}>Cộng Tác Viên</span>
              <span style={styles.statValue}>
                {users.filter(u => u.role === 'collaborator').length}
              </span>
            </div>
            <div style={styles.statCard}>
              <span style={styles.statLabel}>Tổng Đăng Nhập</span>
              <span style={styles.statValue}>
                {users.reduce((sum, u) => sum + (u.login_count || 0), 0)} lần
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div style={styles.modalOverlay} onClick={() => setShowAddModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Thêm Người Dùng Mới</h2>
            
            <form onSubmit={handleAddUser} style={styles.form}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Email *</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  required
                  style={styles.input}
                  placeholder="user@example.com"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Mật Khẩu *</label>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  required
                  minLength={6}
                  style={styles.input}
                  placeholder="Tối thiểu 6 ký tự"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Vai Trò *</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as any })}
                  required
                  style={styles.select}
                >
                  <option value="admin">Quản Trị Viên</option>
                  <option value="merchant">Nhà Cung Cấp</option>
                  <option value="collaborator">Cộng Tác Viên</option>
                </select>
              </div>

              {addError && (
                <div style={styles.errorMessage}>
                  {addError}
                </div>
              )}

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setAddError(null);
                    setNewUser({ email: '', password: '', role: 'merchant' });
                  }}
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
                  {submitting ? 'Đang Tạo...' : 'Tạo Người Dùng'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
    fontFamily: 'system-ui, sans-serif',
    padding: '24px',
  },
  content: {
    maxWidth: '1400px',
    margin: '0 auto',
  },
  loadingContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '60vh',
  },
  loadingText: {
    fontSize: '18px',
    color: '#6b7280',
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '60vh',
    gap: '16px',
  },
  errorText: {
    fontSize: '18px',
    color: '#dc2626',
  },
  retryButton: {
    padding: '10px 20px',
    backgroundColor: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '32px',
    flexWrap: 'wrap',
    gap: '16px',
  },
  title: {
    fontSize: '32px',
    fontWeight: 700,
    color: '#111827',
    marginBottom: '4px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#6b7280',
  },
  backButton: {
    padding: '10px 20px',
    backgroundColor: 'white',
    color: '#374151',
    border: '2px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 500,
    transition: 'background-color 0.2s',
  },
  searchContainer: {
    marginBottom: '24px',
  },
  searchInput: {
    width: '100%',
    padding: '12px 16px',
    fontSize: '16px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    outline: 'none',
  },
  tableContainer: {
    backgroundColor: 'white',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    overflow: 'hidden',
    marginBottom: '32px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  tableHeaderRow: {
    backgroundColor: '#f9fafb',
    borderBottom: '2px solid #e5e7eb',
  },
  tableHeader: {
    padding: '16px',
    textAlign: 'left',
    fontSize: '14px',
    fontWeight: 600,
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  tableRow: {
    borderBottom: '1px solid #e5e7eb',
    transition: 'background-color 0.2s',
  },
  tableCell: {
    padding: '16px',
    fontSize: '14px',
    color: '#111827',
  },
  emptyCell: {
    padding: '48px',
    textAlign: 'center',
    fontSize: '16px',
    color: '#6b7280',
  },
  emailContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  email: {
    fontWeight: 500,
  },
  idBadge: {
    fontSize: '11px',
    color: '#6b7280',
    backgroundColor: '#f3f4f6',
    padding: '2px 6px',
    borderRadius: '4px',
    display: 'inline-block',
    width: 'fit-content',
  },
  roleBadge: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '13px',
    fontWeight: 500,
    color: 'white',
  },
  loginCount: {
    fontWeight: 600,
    color: '#2563eb',
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
  },
  statCard: {
    backgroundColor: 'white',
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  statLabel: {
    fontSize: '14px',
    color: '#6b7280',
    fontWeight: 500,
  },
  statValue: {
    fontSize: '32px',
    fontWeight: 700,
    color: '#111827',
  },
  headerButtons: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
  },
  addButton: {
    padding: '10px 20px',
    backgroundColor: '#16a34a',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 500,
    transition: 'background-color 0.2s',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
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
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
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
    gap: '20px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#374151',
  },
  input: {
    padding: '12px',
    fontSize: '16px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    outline: 'none',
  },
  select: {
    padding: '12px',
    fontSize: '16px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    outline: 'none',
    backgroundColor: 'white',
    cursor: 'pointer',
  },
  errorMessage: {
    padding: '12px',
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    borderRadius: '8px',
    fontSize: '14px',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '8px',
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: 'white',
    color: '#374151',
    border: '2px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 500,
  },
  submitButton: {
    padding: '10px 20px',
    backgroundColor: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 500,
  },
};
