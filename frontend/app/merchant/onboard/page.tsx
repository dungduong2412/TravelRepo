"use client";


import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';

export default function MerchantOnboardPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    commissionRate: '',
    customerDiscountRate: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await apiFetch('/merchants', {
        method: 'POST',
        body: JSON.stringify({
          ...formData,
          commissionRate: Number(formData.commissionRate),
          customerDiscountRate: Number(formData.customerDiscountRate),
        }),
      });
      router.push('/success?role=merchant');
    } catch (err: any) {
      setError(err.message || 'Failed to submit merchant');
    } finally {
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
          <div style={styles.formGroup}>
            <label htmlFor="name" style={styles.label}>
              Tên Doanh Nghiệp *
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              value={formData.name}
              onChange={handleChange}
              style={styles.input}
              placeholder="Nhập tên doanh nghiệp của bạn"
            />
          </div>

          <div style={styles.formGroup}>
            <label htmlFor="description" style={styles.label}>
              Mô Tả
            </label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              style={{ ...styles.input, ...styles.textarea }}
              placeholder="Mô tả ngắn về doanh nghiệp của bạn (tùy chọn)"
              rows={3}
            />
          </div>

          <div style={styles.formGroup}>
            <label htmlFor="commissionRate" style={styles.label}>
              Tỷ Lệ Hoa Hồng (%) *
            </label>
            <input
              id="commissionRate"
              name="commissionRate"
              type="number"
              required
              min="0"
              max="100"
              step="0.01"
              value={formData.commissionRate}
              onChange={handleChange}
              style={styles.input}
              placeholder="Ví dụ: 10.5"
            />
            <small style={styles.hint}>
              Tỷ lệ hoa hồng bạn trả cho cộng tác viên (0-100%)
            </small>
          </div>

          <div style={styles.formGroup}>
            <label htmlFor="customerDiscountRate" style={styles.label}>
              Tỷ Lệ Giảm Giá Khách Hàng (%) *
            </label>
            <input
              id="customerDiscountRate"
              name="customerDiscountRate"
              type="number"
              required
              min="0"
              max="100"
              step="0.01"
              value={formData.customerDiscountRate}
              onChange={handleChange}
              style={styles.input}
              placeholder="Ví dụ: 5"
            />
            <small style={styles.hint}>
              Tỷ lệ giảm giá cho khách hàng qua cộng tác viên (0-100%)
            </small>
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
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '24px',
    fontFamily: 'system-ui, sans-serif',
    backgroundColor: '#f9fafb',
  },
  formContainer: {
    width: '100%',
    maxWidth: '500px',
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '32px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  title: {
    fontSize: '28px',
    fontWeight: 600,
    marginBottom: '8px',
    color: '#111827',
  },
  subtitle: {
    fontSize: '14px',
    color: '#6b7280',
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
    gap: '6px',
  },
  label: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#374151',
  },
  input: {
    padding: '10px 12px',
    fontSize: '16px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  textarea: {
    resize: 'vertical',
    minHeight: '80px',
    fontFamily: 'inherit',
  },
  hint: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '-2px',
  },
  errorBox: {
    padding: '12px',
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    borderRadius: '6px',
    fontSize: '14px',
  },
  buttonGroup: {
    display: 'flex',
    gap: '12px',
    marginTop: '8px',
  },
  primaryButton: {
    flex: 1,
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 500,
    color: 'white',
    backgroundColor: '#2563eb',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  secondaryButton: {
    flex: 1,
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: 'white',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
};
