"use client";

import { useState, useEffect } from 'react';
import { apiFetch } from '../../../../lib/api';
import { fractionToPercentagePoints } from '../../../../lib/rates';
import MediaManager from '../../../../components/MediaManager';

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
    merchant_description_format: 'plain_text',
    category_ids: [] as string[],
    merchant_contact_phone: '',
    new_address_city: '',
    new_address_ward: '',
    new_address_line: '',
    owner_name: '',
    owner_phone: '',
    owner_tax_code: '',
    new_address_country: '',
    new_address_province: '',
    new_address_district: '',
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
      
      const profile = await apiFetch('/user-profiles/me');
      if (!profile?.merchant_id) throw new Error('Tài khoản chưa được liên kết nhà cung cấp');
      const data = await apiFetch(`/merchants/${profile.merchant_id}`);
      setMerchant(data);
      setFormData({
        merchant_name: data.merchant_name || '',
        merchant_email: data.merchant_email || '',
        merchant_phone: data.merchant_phone || '',
        merchant_description: data.merchant_description || '',
        merchant_description_format: data.merchant_description_format || 'plain_text',
        category_ids: data.category_ids || [],
        merchant_contact_phone: data.merchant_contact_phone || '',
        new_address_city: data.new_address_city || '',
        new_address_ward: data.new_address_ward || '',
        new_address_line: data.new_address_line || '',
        owner_name: data.owner_name || '',
        owner_phone: data.owner_phone || '',
        owner_tax_code: data.owner_tax_code || '',
        new_address_country: data.new_address_country || '',
        new_address_province: data.new_address_province || '',
        new_address_district: data.new_address_district || '',
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
      if (!merchant?.merchant_system_id) throw new Error('Không tìm thấy hồ sơ nhà cung cấp');
      const payload: Record<string, unknown> = { ...formData };
      if (sameCategoryIds(formData.category_ids, merchant?.category_ids || [])) {
        delete payload.category_ids;
      }
      await apiFetch(`/merchants/${merchant.merchant_system_id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await fetchProfile();
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
            <input value={merchant?.owner_email || ''} readOnly style={{ ...styles.input, background: '#f8fafc' }} />
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

          <div style={styles.formGroup}>
            <label style={styles.label}>Mã Số Thuế Chủ Sở Hữu</label>
            <input name="owner_tax_code" value={formData.owner_tax_code} onChange={handleChange} style={styles.input} />
            {merchant?.legacy_tax_code && <small style={styles.hint}>Mã lịch sử V1 (chỉ đọc): {merchant.legacy_tax_code}</small>}
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

          <fieldset style={styles.categoryFieldset}>
            <legend style={styles.label}>Danh Mục ({formData.category_ids.length}/3)</legend>
            <small style={styles.hint}>Chọn tối đa 3 danh mục. Hồ sơ lịch sử có nhiều hơn 3 danh mục được giữ nguyên cho đến khi bạn chủ động thay đổi lựa chọn.</small>
            {categories.map(cat => {
              const checked = formData.category_ids.includes(cat.id);
              return <label key={cat.id} style={styles.categoryOption}><input type="checkbox" checked={checked} disabled={!checked && formData.category_ids.length >= 3} onChange={(event) => setFormData((previous) => ({ ...previous, category_ids: event.target.checked ? [...previous.category_ids, cat.id] : previous.category_ids.filter((id) => id !== cat.id) }))} /> {cat.category_name_vi || cat.category_name}</label>;
            })}
          </fieldset>

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
            <select name="merchant_description_format" value={formData.merchant_description_format} onChange={handleChange} style={{ ...styles.input, marginBottom: 8 }}><option value="plain_text">Văn bản thuần</option><option value="markdown">Markdown định dạng</option></select>
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

          <div style={styles.formGroup}><label style={styles.label}>Quốc Gia</label><input name="new_address_country" value={formData.new_address_country} onChange={handleChange} style={styles.input} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Tỉnh / Thành Phố</label><input name="new_address_province" value={formData.new_address_province} onChange={handleChange} style={styles.input} /></div>
          <div style={styles.formGroup}><label style={styles.label}>Quận / Huyện</label><input name="new_address_district" value={formData.new_address_district} onChange={handleChange} style={styles.input} /></div>
          
          <div style={styles.formGroup}>
            <label style={styles.label}>Thành Phố (trường V2 hiện có)</label>
            <input
              name="new_address_city"
              value={formData.new_address_city}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Phường / Xã</label>
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
          <p style={{ color: '#64748b', margin: 0 }}>Các điều khoản này do Platform Admin quản trị.</p>
          <p>Hoa hồng: {commercialRate(merchant?.merchant_commission_type, merchant?.merchant_commission_value)}</p>
          <p>Giảm giá: {commercialRate(merchant?.merchant_discount_type, merchant?.merchant_discount_value)}</p>
        </div>

        <MediaManager title="Hình ảnh doanh nghiệp" />

        {error && <div style={styles.error}>{error}</div>}
        {success && <div style={styles.success}>✓ Cập nhật thành công!</div>}

        <button type="submit" disabled={saving} style={styles.submitButton}>
          {saving ? 'Đang lưu...' : 'Lưu Thay Đổi'}
        </button>
      </form>
    </div>
  );
}

function commercialRate(type?: string | null, value?: string | number | null) {
  if (value === null || value === undefined || value === '') return 'chưa cấu hình';
  return type === 'percentage' ? `${fractionToPercentagePoints(value)}%` : `${value} VND`;
}

function sameCategoryIds(left: string[], right: string[]) {
  const sortedRight = [...right].sort();
  return left.length === sortedRight.length && [...left].sort().every((id, index) => id === sortedRight[index]);
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
  hint: { display: 'block', color: '#64748b', marginTop: '6px' },
  categoryFieldset: { border: '1px solid #d1d5db', borderRadius: '8px', padding: '12px', marginBottom: '16px' },
  categoryOption: { display: 'inline-flex', alignItems: 'center', gap: '6px', margin: '5px 16px 5px 0', fontSize: '14px', color: '#374151' },
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
