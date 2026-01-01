"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { publicApiFetch } from '../../../lib/api';

export default function MerchantOnboardPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    owner_name: '',
    owner_email: '',
    owner_phone: '',
    owner_password: '',
    merchant_name: '',
    merchant_email: '',
    merchant_phone: '',
    merchant_description: '',
    merchant_category: '',
    merchant_contact_phone: '',
    new_address_city: '',
    new_address_ward: '',
    new_address_line: '',
    old_address_city: '',
    old_address_ward: '',
    old_address_line: '',
    merchant_commission_type: 'percentage' as 'percentage' | 'fixed',
    merchant_commission_value: '',
    merchant_discount_type: 'percentage' as 'percentage' | 'fixed',
    merchant_discount_value: '',
  });
  const [repeatPassword, setRepeatPassword] = useState('');
  const [pictures, setPictures] = useState<Array<{ file: File; preview: string; base64: string }>>([]);
  const [featuredPictureIndex, setFeaturedPictureIndex] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showRepeatPassword, setShowRepeatPassword] = useState(false);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const data = await publicApiFetch('/categories');
      setCategories(data);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handlePictureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    
    if (pictures.length + files.length > 5) {
      setError('Bạn chỉ có thể tải lên tối đa 5 ảnh');
      return;
    }

    files.forEach(file => {
      if (file.size > 10 * 1024 * 1024) {
        setError(`File ${file.name} vượt quá 10MB`);
        return;
      }

      if (!file.type.startsWith('image/')) {
        setError(`File ${file.name} không phải là ảnh`);
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setPictures(prev => [...prev, {
          file,
          preview: URL.createObjectURL(file),
          base64: reader.result as string,
        }]);
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
  };

  const removePicture = (index: number) => {
    setPictures(prev => {
      const newPictures = prev.filter((_, i) => i !== index);
      if (featuredPictureIndex === index) {
        setFeaturedPictureIndex(0);
      } else if (featuredPictureIndex > index) {
        setFeaturedPictureIndex(featuredPictureIndex - 1);
      }
      return newPictures;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    // Validate passwords match
    if (formData.owner_password !== repeatPassword) {
      setError('Mật khẩu không khớp');
      setIsSubmitting(false);
      return;
    }

    try {
      const payload = {
        ...formData,
        merchant_commission_value: formData.merchant_commission_value 
          ? Number(formData.merchant_commission_value) 
          : undefined,
        merchant_discount_value: formData.merchant_discount_value 
          ? Number(formData.merchant_discount_value) 
          : undefined,
        merchant_pictures: pictures.map((p, i) => ({
          url: p.base64,
          is_featured: i === featuredPictureIndex,
        })),
      };

      await publicApiFetch('/merchants', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // Redirect to success page
      router.push('/success?type=merchant');
    } catch (err: any) {
      setError(err.message || 'Không thể tạo nhà cung cấp');
      setIsSubmitting(false);
    }
  };

  return (
    <main style={styles.container}>
      <div style={styles.formContainer}>
        <h1 style={styles.title}>Đăng Ký Nhà Cung Cấp</h1>
        <p style={styles.subtitle}>
          Đăng ký doanh nghiệp du lịch của bạn và bắt đầu hợp tác với cộng tác viên
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Owner Information */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Thông Tin Chủ Sở Hữu</h2>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Họ và Tên *</label>
              <input
                name="owner_name"
                type="text"
                required
                value={formData.owner_name}
                onChange={handleChange}
                style={styles.input}
                placeholder="Nguyễn Văn A"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Email *</label>
              <input
                name="owner_email"
                type="email"
                required
                value={formData.owner_email}
                onChange={handleChange}
                style={styles.input}
                placeholder="email@example.com"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Số Điện Thoại *</label>
              <input
                name="owner_phone"
                type="tel"
                required
                value={formData.owner_phone}
                onChange={handleChange}
                style={styles.input}
                placeholder="0901234567"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Mật Khẩu *</label>
              <div style={styles.passwordWrapper}>
                <input
                  name="owner_password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={formData.owner_password}
                  onChange={handleChange}
                  style={styles.input}
                  placeholder="Tối thiểu 6 ký tự"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={styles.eyeButton}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Nhập Lại Mật Khẩu *</label>
              <div style={styles.passwordWrapper}>
                <input
                  type={showRepeatPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                  style={styles.input}
                  placeholder="Nhập lại mật khẩu"
                />
                <button
                  type="button"
                  onClick={() => setShowRepeatPassword(!showRepeatPassword)}
                  style={styles.eyeButton}
                >
                  {showRepeatPassword ? '🙈' : '👁️'}
                </button>
              </div>
              {repeatPassword && formData.owner_password !== repeatPassword && (
                <small style={{ ...styles.hint, color: '#dc2626' }}>
                  Mật khẩu không khớp
                </small>
              )}
            </div>
          </div>

          {/* Business Information */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Thông Tin Doanh Nghiệp</h2>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Tên Doanh Nghiệp *</label>
              <input
                name="merchant_name"
                type="text"
                required
                value={formData.merchant_name}
                onChange={handleChange}
                style={styles.input}
                placeholder="Khách sạn ABC"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Danh Mục *</label>
              <select
                name="merchant_category"
                required
                value={formData.merchant_category}
                onChange={handleChange}
                style={styles.input}
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
              <label style={styles.label}>Email Doanh Nghiệp</label>
              <input
                name="merchant_email"
                type="email"
                value={formData.merchant_email}
                onChange={handleChange}
                style={styles.input}
                placeholder="info@business.com"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Số Điện Thoại Doanh Nghiệp</label>
              <input
                name="merchant_phone"
                type="tel"
                value={formData.merchant_phone}
                onChange={handleChange}
                style={styles.input}
                placeholder="0281234567"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Số Điện Thoại Liên Hệ</label>
              <input
                name="merchant_contact_phone"
                type="tel"
                value={formData.merchant_contact_phone}
                onChange={handleChange}
                style={styles.input}
                placeholder="0901234567"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Mô Tả Doanh Nghiệp</label>
              <textarea
                name="merchant_description"
                value={formData.merchant_description}
                onChange={handleChange}
                style={{ ...styles.input, ...styles.textarea }}
                placeholder="Giới thiệu về doanh nghiệp của bạn"
                rows={4}
              />
            </div>
          </div>

          {/* Current Address */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Địa Chỉ Hiện Tại</h2>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Thành Phố/Tỉnh</label>
              <input
                name="new_address_city"
                value={formData.new_address_city}
                onChange={handleChange}
                style={styles.input}
                placeholder="TP. Hồ Chí Minh"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Phường/Xã</label>
              <input
                name="new_address_ward"
                value={formData.new_address_ward}
                onChange={handleChange}
                style={styles.input}
                placeholder="Phường Bến Nghé"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Địa Chỉ Chi Tiết</label>
              <input
                name="new_address_line"
                value={formData.new_address_line}
                onChange={handleChange}
                style={styles.input}
                placeholder="Số nhà, tên đường"
              />
            </div>
          </div>

          {/* Previous Address (Optional) */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Địa Chỉ Cũ (Nếu có)</h2>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Thành Phố/Tỉnh</label>
              <input
                name="old_address_city"
                value={formData.old_address_city}
                onChange={handleChange}
                style={styles.input}
                placeholder="TP. Hồ Chí Minh"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Phường/Xã</label>
              <input
                name="old_address_ward"
                value={formData.old_address_ward}
                onChange={handleChange}
                style={styles.input}
                placeholder="Phường Bến Thành"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Địa Chỉ Chi Tiết</label>
              <input
                name="old_address_line"
                value={formData.old_address_line}
                onChange={handleChange}
                style={styles.input}
                placeholder="Số nhà, tên đường"
              />
            </div>
          </div>

          {/* Pictures Upload */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Hình Ảnh Doanh Nghiệp</h2>
            <p style={styles.hint}>
              Tải lên tối đa 5 ảnh (mỗi ảnh tối đa 10MB). Chọn 1 ảnh làm ảnh đại diện.
            </p>

            <div style={styles.formGroup}>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handlePictureUpload}
                style={{ display: 'none' }}
                id="picture-upload"
                disabled={pictures.length >= 5}
              />
              <label htmlFor="picture-upload" style={styles.uploadButton}>
                📷 {pictures.length >= 5 ? 'Đã đủ 5 ảnh' : 'Chọn Ảnh'}
              </label>
            </div>

            {pictures.length > 0 && (
              <div style={styles.picturesGrid}>
                {pictures.map((pic, index) => (
                  <div key={index} style={styles.pictureCard}>
                    <img src={pic.preview} alt={`Picture ${index + 1}`} style={styles.picturePreview} />
                    <div style={styles.pictureActions}>
                      <button
                        type="button"
                        onClick={() => setFeaturedPictureIndex(index)}
                        style={{
                          ...styles.featuredButton,
                          backgroundColor: featuredPictureIndex === index ? '#16a34a' : '#6b7280',
                        }}
                      >
                        {featuredPictureIndex === index ? '⭐ Ảnh Đại Diện' : 'Đặt Làm Đại Diện'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removePicture(index)}
                        style={styles.removeButton}
                      >
                        🗑️ Xóa
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Commission & Discount */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Hoa Hồng & Giảm Giá</h2>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Loại Hoa Hồng cho Cộng Tác Viên</label>
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
                min="0"
                step="0.01"
                value={formData.merchant_commission_value}
                onChange={handleChange}
                style={styles.input}
                placeholder={formData.merchant_commission_type === 'percentage' ? 'Ví dụ: 10' : 'Ví dụ: 50000'}
              />
              <small style={styles.hint}>
                {formData.merchant_commission_type === 'percentage' 
                  ? 'Tỷ lệ % hoa hồng cho cộng tác viên' 
                  : 'Số tiền cố định (VNĐ) cho cộng tác viên'}
              </small>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Loại Giảm Giá cho Khách Hàng</label>
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
                min="0"
                step="0.01"
                value={formData.merchant_discount_value}
                onChange={handleChange}
                style={styles.input}
                placeholder={formData.merchant_discount_type === 'percentage' ? 'Ví dụ: 5' : 'Ví dụ: 20000'}
              />
              <small style={styles.hint}>
                {formData.merchant_discount_type === 'percentage' 
                  ? 'Tỷ lệ % giảm giá cho khách hàng' 
                  : 'Số tiền cố định (VNĐ) giảm cho khách hàng'}
              </small>
            </div>
          </div>

          {error && (
            <div style={styles.errorBox}>
              {error}
            </div>
          )}

          <div style={styles.buttonGroup}>
            <button
              type="button"
              onClick={() => router.push('/')}
              style={styles.secondaryButton}
              disabled={isSubmitting}
            >
              Hủy
            </button>
            <button
              type="submit"
              style={styles.primaryButton}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Đang gửi...' : 'Gửi Đơn Đăng Ký'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

/* --- Inline styles --- */

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    padding: '40px 24px',
    fontFamily: 'system-ui, sans-serif',
    backgroundColor: '#f9fafb',
  },
  formContainer: {
    width: '100%',
    maxWidth: '800px',
    margin: '0 auto',
  },
  title: {
    fontSize: '32px',
    fontWeight: 700,
    marginBottom: '8px',
    color: '#111827',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: '16px',
    color: '#6b7280',
    marginBottom: '32px',
    textAlign: 'center',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  cardTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#111827',
    marginBottom: '20px',
    paddingBottom: '12px',
    borderBottom: '2px solid #e5e7eb',
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
    transition: 'border-color 0.2s',
  },
  textarea: {
    minHeight: '100px',
    resize: 'vertical',
    fontFamily: 'inherit',
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
    padding: '4px',
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
    cursor: 'pointer',
  },
  hint: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '4px',
    display: 'block',
  },
  uploadButton: {
    display: 'inline-block',
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: 'white',
    backgroundColor: '#2563eb',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'center',
  },
  picturesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '16px',
    marginTop: '16px',
  },
  pictureCard: {
    position: 'relative',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  picturePreview: {
    width: '100%',
    height: '200px',
    objectFit: 'cover',
  },
  pictureActions: {
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  featuredButton: {
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: 600,
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  removeButton: {
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: 600,
    color: 'white',
    backgroundColor: '#dc2626',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  errorBox: {
    padding: '12px',
    backgroundColor: '#fee2e2',
    border: '1px solid #fecaca',
    color: '#dc2626',
    borderRadius: '8px',
    fontSize: '14px',
  },
  buttonGroup: {
    display: 'flex',
    gap: '12px',
    marginTop: '8px',
    backgroundColor: 'white',
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  primaryButton: {
    flex: 1,
    padding: '14px 24px',
    fontSize: '16px',
    fontWeight: 600,
    color: 'white',
    backgroundColor: '#FF385C',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  secondaryButton: {
    flex: 1,
    padding: '14px 24px',
    fontSize: '16px',
    fontWeight: 600,
    color: '#374151',
    backgroundColor: 'white',
    border: '2px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};
