"use client";

import { useState, useEffect } from 'react';
import { publicApiFetch } from '../../../../lib/api';

interface Category {
  id: string;
  category_name: string;
  category_name_vi: string;
  category_description?: string | null;
  category_icon?: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState({
    category_name: '',
    category_name_vi: '',
    category_description: '',
    category_icon: '',
    is_active: true,
    display_order: 0,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      const data = await publicApiFetch('/categories');
      setCategories(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch categories');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (category?: Category) => {
    if (category) {
      setEditingCategory(category);
      setFormData({
        category_name: category.category_name,
        category_name_vi: category.category_name_vi,
        category_description: category.category_description || '',
        category_icon: category.category_icon || '',
        is_active: category.is_active,
        display_order: category.display_order,
      });
    } else {
      setEditingCategory(null);
      setFormData({
        category_name: '',
        category_name_vi: '',
        category_description: '',
        category_icon: '',
        is_active: true,
        display_order: categories.length,
      });
    }
    setShowModal(true);
    setFormError(null);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingCategory(null);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      if (editingCategory) {
        await publicApiFetch(`/categories/${editingCategory.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
      } else {
        await publicApiFetch('/categories', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
      }

      handleCloseModal();
      await fetchCategories();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save category');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa danh mục này?')) {
      return;
    }

    try {
      await publicApiFetch(`/categories/${id}`, {
        method: 'DELETE',
      });
      await fetchCategories();
    } catch (err: any) {
      alert(err.message || 'Failed to delete category');
    }
  };

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
          <button onClick={fetchCategories} style={styles.retryButton}>
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
            <h1 style={styles.title}>Quản Lý Danh Mục</h1>
            <p style={styles.subtitle}>
              Tổng số: {categories.length} danh mục
            </p>
          </div>
          <button onClick={() => handleOpenModal()} style={styles.addButton}>
            + Thêm Danh Mục
          </button>
        </div>

        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.tableHeaderRow}>
                <th style={styles.tableHeader}>Thứ Tự</th>
                <th style={styles.tableHeader}>Tên (EN)</th>
                <th style={styles.tableHeader}>Tên (VI)</th>
                <th style={styles.tableHeader}>Mô Tả</th>
                <th style={styles.tableHeader}>Trạng Thái</th>
                <th style={styles.tableHeader}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={6} style={styles.emptyCell}>
                    Chưa có danh mục nào
                  </td>
                </tr>
              ) : (
                categories.map((category) => (
                  <tr key={category.id} style={styles.tableRow}>
                    <td style={styles.tableCell}>
                      <span style={styles.orderBadge}>{category.display_order}</span>
                    </td>
                    <td style={styles.tableCell}>
                      <span style={styles.categoryName}>{category.category_name}</span>
                    </td>
                    <td style={styles.tableCell}>
                      <span style={styles.categoryNameVi}>{category.category_name_vi}</span>
                    </td>
                    <td style={styles.tableCell}>
                      <span style={styles.description}>
                        {category.category_description || '-'}
                      </span>
                    </td>
                    <td style={styles.tableCell}>
                      <span
                        style={{
                          ...styles.statusBadge,
                          backgroundColor: category.is_active ? '#16a34a' : '#dc2626',
                        }}
                      >
                        {category.is_active ? 'Hoạt Động' : 'Tạm Ngưng'}
                      </span>
                    </td>
                    <td style={styles.tableCell}>
                      <div style={styles.actionButtons}>
                        <button
                          onClick={() => handleOpenModal(category)}
                          style={styles.editButton}
                        >
                          Sửa
                        </button>
                        <button
                          onClick={() => handleDelete(category.id)}
                          style={styles.deleteButton}
                        >
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div style={styles.modalOverlay} onClick={handleCloseModal}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>
              {editingCategory ? 'Chỉnh Sửa Danh Mục' : 'Thêm Danh Mục Mới'}
            </h2>

            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Tên Danh Mục (English) *</label>
                <input
                  type="text"
                  value={formData.category_name}
                  onChange={(e) => setFormData({ ...formData, category_name: e.target.value })}
                  required
                  style={styles.input}
                  placeholder="hotel, restaurant, tour..."
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Tên Danh Mục (Tiếng Việt) *</label>
                <input
                  type="text"
                  value={formData.category_name_vi}
                  onChange={(e) => setFormData({ ...formData, category_name_vi: e.target.value })}
                  required
                  style={styles.input}
                  placeholder="Khách Sạn, Nhà Hàng, Tour Du Lịch..."
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Mô Tả</label>
                <textarea
                  value={formData.category_description}
                  onChange={(e) => setFormData({ ...formData, category_description: e.target.value })}
                  style={styles.textarea}
                  placeholder="Mô tả chi tiết về danh mục..."
                  rows={3}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Icon (optional)</label>
                <input
                  type="text"
                  value={formData.category_icon}
                  onChange={(e) => setFormData({ ...formData, category_icon: e.target.value })}
                  style={styles.input}
                  placeholder="🏨 or icon-name"
                />
              </div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Thứ Tự Hiển Thị *</label>
                  <input
                    type="number"
                    value={formData.display_order}
                    onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
                    required
                    style={styles.input}
                    min={0}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      style={styles.checkbox}
                    />
                    <span>Hoạt động</span>
                  </label>
                </div>
              </div>

              {formError && (
                <div style={styles.errorMessage}>
                  {formError}
                </div>
              )}

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={handleCloseModal}
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
                  {submitting ? 'Đang Lưu...' : editingCategory ? 'Cập Nhật' : 'Tạo Danh Mục'}
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
  orderBadge: {
    display: 'inline-block',
    padding: '4px 12px',
    backgroundColor: '#e0e7ff',
    color: '#3730a3',
    borderRadius: '12px',
    fontSize: '13px',
    fontWeight: 600,
  },
  categoryName: {
    fontWeight: 500,
    fontFamily: 'monospace',
    color: '#374151',
  },
  categoryNameVi: {
    fontWeight: 600,
    color: '#111827',
  },
  description: {
    color: '#6b7280',
    fontSize: '13px',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '13px',
    fontWeight: 500,
    color: 'white',
  },
  actionButtons: {
    display: 'flex',
    gap: '8px',
  },
  editButton: {
    padding: '6px 12px',
    backgroundColor: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
  deleteButton: {
    padding: '6px 12px',
    backgroundColor: '#dc2626',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
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
    maxWidth: '600px',
    width: '90%',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
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
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
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
  textarea: {
    padding: '12px',
    fontSize: '16px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    outline: 'none',
    fontFamily: 'system-ui, sans-serif',
    resize: 'vertical',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#374151',
    cursor: 'pointer',
    marginTop: '8px',
  },
  checkbox: {
    width: '18px',
    height: '18px',
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
