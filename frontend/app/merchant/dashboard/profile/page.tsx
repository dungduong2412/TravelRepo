"use client";

import { useState, useEffect } from 'react';
import { apiFetch } from '../../../../lib/api';

export default function MerchantProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [merchant, setMerchant] = useState<any>(null);
  
  const [formData, setFormData] = useState({
    merchant_name: '',
    merchant_email: '',
    merchant_phone: '',
    merchant_description: '',
    merchant_category: '',
    merchant_contact_phone: '',
    new_address_city: '',
    new_address_ward: '',
    new_address_line: '',
    merchant_commission_type: 'percentage' as 'percentage' | 'fixed',
    merchant_commission_value: '',
    merchant_discount_type: 'percentage' as 'percentage' | 'fixed',
    merchant_discount_value: '',
    owner_name: '',
    owner_email: '',
    owner_phone: '',
  });

  useEffect(() => {
    fetchProfile();
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const data = await apiFetch('/categories/active');
      setCategories(data);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  };

  const fetchProfile = async () => {
    try {
      setLoading(true);
      
      // Get merchant ID from localStorage
      const merchantData = localStorage.getItem('merchant');
      if (!merchantData) {
        setError('Không tìm thấy thông tin đăng nhập. Vui lòng đăng nhập lại.');
        setLoading(false);
        return;
      }
      
      const { id } = JSON.parse(merchantData);
      
      // Fetch merchant profile
      const data = await apiFetch(`/merchants/${id}`);
      setMerchant(data);
      setFormData({
        merchant_name: data.merchant_name || '',
        merchant_email: data.merchant_email || '',
        merchant_phone: data.merchant_phone || '',
        merchant_description: data.merchant_description || '',
        merchant_category: data.merchant_category || '',
        merchant_contact_phone: data.merchant_contact_phone || '',
        new_address_city: data.new_address_city || '',
        new_address_ward: data.new_address_ward || '',
        new_address_line: data.new_address_line || '',
        merchant_commission_type: data.merchant_commission_type || 'percentage',
        merchant_commission_value: data.merchant_commission_value || '',
        merchant_discount_type: data.merchant_discount_type || 'percentage',
        merchant_discount_value: data.merchant_discount_value || '',
        owner_name: data.owner_name || '',
        owner_email: data.owner_email || '',
        owner_phone: data.owner_phone || '',
      });
    } catch (err: any) {
      setError(err.message || 'Không thể tải thông tin');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const merchantData = localStorage.getItem('merchant');
      if (!merchantData) {
        setError('Không tìm thấy thông tin đăng nhập');
        setSaving(false);
        return;
      }
      
      const { id } = JSON.parse(merchantData);
      
      const payload = {
        ...formData,
        merchant_commission_value: formData.merchant_commission_value 
          ? Number(formData.merchant_commission_value) 
          : undefined,
        merchant_discount_value: formData.merchant_discount_value 
          ? Number(formData.merchant_discount_value) 
          : undefined,
      };
      
      await apiFetch(`/merchants/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
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
      <h1 style={styles.title}>Hồ Sơ Doanh Nghiệp</h1>
      <p style={styles.subtitle}>Quản lý thông tin doanh nghiệp của bạn</p>

      {merchant && !merchant.merchant_verified && (
        <div style={styles.pendingCard}>
          <span style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</span>
          <p style={styles.pendingText}>
            Tài khoản của bạn đang chờ admin phê duyệt. Sau khi được phê duyệt, bạn có thể bắt đầu nhận đơn hàng.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} style={styles.form}>
        {merchant && (
          <div style={styles.infoCard}>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Mã Nhà Cung Cấp:</span>
              <span style={styles.infoValue}>{merchant.merchant_code}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Trạng Thái:</span>
              <span style={{
                ...styles.infoValue,
                color: merchant.merchant_verified ? '#16a34a' : '#f59e0b',
                fontWeight: 600,
              }}>
                {merchant.merchant_verified ? '✓ Đã Phê Duyệt' : '⏳ Chờ Phê Duyệt'}
              </span>
            </div>
          </div>
        )}

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Thông Tin Chủ Sở Hữu</h2>
          
          <div style={styles.formGroup}>
            <label style={styles.label}>Họ và Tên Chủ Sở Hữu</label>
            <input
              name="owner_name"
              value={formData.owner_name}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Email Chủ Sở Hữu</label>
            <input
              name="owner_email"
              type="email"
              value={formData.owner_email}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Số Điện Thoại Chủ Sở Hữu</label>
            <input
              name="owner_phone"
              value={formData.owner_phone}
              onChange={handleChange}
              style={styles.input}
            />
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Thông Tin Doanh Nghiệp</h2>
          
          <div style={styles.formGroup}>
            <label style={styles.label}>Tên Doanh Nghiệp</label>
            <input
              name="merchant_name"
              value={formData.merchant_name}
              onChange={handleChange}
              style={styles.input}
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Danh Mục</label>
            <select
              name="merchant_category"
              value={formData.merchant_category}
              onChange={handleChange}
              style={styles.input}
              required
            >
              <option value="">-- Chọn danh mục --</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.category_name_vi}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Email</label>
            <input
              name="merchant_email"
              type="email"
              value={formData.merchant_email}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Số Điện Thoại</label>
            <input
              name="merchant_phone"
              value={formData.merchant_phone}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>SĐT Liên Hệ</label>
            <input
              name="merchant_contact_phone"
              value={formData.merchant_contact_phone}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Mô Tả</label>
            <textarea
              name="merchant_description"
              value={formData.merchant_description}
              onChange={handleChange}
              style={{ ...styles.input, ...styles.textarea }}
              rows={4}
            />
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Địa Chỉ</h2>
          
          <div style={styles.formGroup}>
            <label style={styles.label}>Thành Phố/Tỉnh</label>
            <input
              name="new_address_city"
              value={formData.new_address_city}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Quận/Huyện</label>
            <input
              name="new_address_ward"
              value={formData.new_address_ward}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Địa Chỉ Chi Tiết</label>
            <input
              name="new_address_line"
              value={formData.new_address_line}
              onChange={handleChange}
              style={styles.input}
            />
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Hoa Hồng & Giảm Giá</h2>
          
          <div style={styles.formGroup}>
            <label style={styles.label}>Loại Hoa Hồng</label>
            <div style={styles.radioGroup}>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="merchant_commission_type"
                  value="percentage"
                  checked={formData.merchant_commission_type === 'percentage'}
                  onChange={handleChange}
                />
                <span>Phần trăm (%)</span>
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="merchant_commission_type"
                  value="fixed"
                  checked={formData.merchant_commission_type === 'fixed'}
                  onChange={handleChange}
                />
                <span>Cố định (VNĐ)</span>
              </label>
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Giá Trị Hoa Hồng</label>
            <input
              name="merchant_commission_value"
              type="number"
              value={formData.merchant_commission_value}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Loại Giảm Giá</label>
            <div style={styles.radioGroup}>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="merchant_discount_type"
                  value="percentage"
                  checked={formData.merchant_discount_type === 'percentage'}
                  onChange={handleChange}
                />
                <span>Phần trăm (%)</span>
              </label>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="merchant_discount_type"
                  value="fixed"
                  checked={formData.merchant_discount_type === 'fixed'}
                  onChange={handleChange}
                />
                <span>Cố định (VNĐ)</span>
              </label>
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Giá Trị Giảm Giá</label>
            <input
              name="merchant_discount_value"
              type="number"
              value={formData.merchant_discount_value}
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
  textarea: {
    minHeight: '100px',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  radioGroup: {
    display: 'flex',
    gap: '16px',
    marginTop: '8px',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: '#374151',
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
