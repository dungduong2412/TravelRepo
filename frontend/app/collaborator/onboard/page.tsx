"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CollaboratorOnboardPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    email: '',
    bankName: '',
    bankAccountNumber: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/collaborators`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // TODO: Add authentication token when implemented
          // 'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create collaborator');
      }

      // Redirect to success page
      router.push('/success?type=collaborator');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsSubmitting(false);
    }
  };

  return (
    <main style={styles.container}>
      <div style={styles.formContainer}>
        <h1 style={styles.title}>Đăng Ký Cộng Tác Viên</h1>
        <p style={styles.subtitle}>Tham gia với vai trò hướng dẫn viên du lịch và bắt đầu nhận hoa hồng</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label htmlFor="fullName" style={styles.label}>
              Họ và Tên *
            </label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              required
              value={formData.fullName}
              onChange={handleChange}
              style={styles.input}
              placeholder="Nhập họ và tên đầy đủ"
            />
          </div>

          <div style={styles.formGroup}>
            <label htmlFor="phone" style={styles.label}>
              Số Điện Thoại *
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              required
              value={formData.phone}
              onChange={handleChange}
              style={styles.input}
              placeholder="+84 XXX XXX XXX"
            />
          </div>

          <div style={styles.formGroup}>
            <label htmlFor="email" style={styles.label}>
              Email *
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={formData.email}
              onChange={handleChange}
              style={styles.input}
              placeholder="email.cua.ban@example.com"
            />
          </div>

          <div style={styles.formGroup}>
            <label htmlFor="bankName" style={styles.label}>
              Tên Ngân Hàng *
            </label>
            <input
              id="bankName"
              name="bankName"
              type="text"
              required
              value={formData.bankName}
              onChange={handleChange}
              style={styles.input}
              placeholder="Ví dụ: Vietcombank, Techcombank"
            />
          </div>

          <div style={styles.formGroup}>
            <label htmlFor="bankAccountNumber" style={styles.label}>
              Số Tài Khoản Ngân Hàng *
            </label>
            <input
              id="bankAccountNumber"
              name="bankAccountNumber"
              type="text"
              required
              value={formData.bankAccountNumber}
              onChange={handleChange}
              style={styles.input}
              placeholder="Nhập số tài khoản của bạn"
            />
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
