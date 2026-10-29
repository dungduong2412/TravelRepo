"use client";


import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { signUp, supabase } from '../../../lib/supabase';

type Category = { id: string; category_name?: string | null; category_name_vi?: string | null };
const DRAFT_KEY = 'vno-merchant-onboarding-draft';

export default function MerchantOnboardPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    ownerEmail: '',
    password: '',
    confirmPassword: '',
    name: '',
    description: '',
    ownerName: '', ownerPhone: '', merchantPhone: '', contactPhone: '', taxCode: '',
    country: 'Vietnam', province: '', district: '', ward: '', address: '',
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [hasVerifiedSession, setHasVerifiedSession] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
      if (draft?.formData) setFormData((current) => ({ ...current, ...draft.formData, password: '', confirmPassword: '' }));
      if (Array.isArray(draft?.categoryIds)) setCategoryIds(draft.categoryIds.slice(0, 3));
    } catch { /* Invalid local draft is ignored. */ }
    apiFetch('/categories/active').then(setCategories).catch(() => setCategories([]));
    supabase.auth.getSession().then(({ data }) => setHasVerifiedSession(Boolean(data.session?.user?.email_confirmed_at)));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasVerifiedSession(Boolean(session?.user?.email_confirmed_at));
      if (session?.user?.email) setFormData((current) => ({ ...current, ownerEmail: session.user.email || current.ownerEmail }));
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const next = { ...prev, [name]: value };
      const { password: _password, confirmPassword: _confirmPassword, ...safe } = next;
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ formData: safe, categoryIds }));
      return next;
    });
  };

  function toggleCategory(id: string) {
    const next = categoryIds.includes(id) ? categoryIds.filter((value) => value !== id) : [...categoryIds, id];
    if (next.length > 3) { setError('Chỉ được chọn tối đa 3 danh mục'); return; }
    setCategoryIds(next); setError(null);
    const { password: _password, confirmPassword: _confirmPassword, ...safe } = formData;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ formData: safe, categoryIds: next }));
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    if (!hasVerifiedSession && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/.test(formData.password)) {
      setError('Mật khẩu phải có ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt');
      setIsSubmitting(false);
      return;
    }
    if (!hasVerifiedSession && formData.password !== formData.confirmPassword) {
      setError('Hai mật khẩu không khớp');
      setIsSubmitting(false);
      return;
    }

    try {
      if (!hasVerifiedSession) {
        const data = await signUp(
          formData.ownerEmail,
          formData.password,
          'merchant',
          `${window.location.origin}/merchant/onboard?confirmed=1`,
        );
        if (!data.session) {
          setNotice('Kiểm tra email để xác nhận địa chỉ. Sau khi xác nhận, quay lại trang này để hoàn tất hồ sơ.');
          setIsSubmitting(false);
          return;
        }
        setHasVerifiedSession(Boolean(data.user?.email_confirmed_at));
      }
      await apiFetch('/merchants', {
        method: 'POST',
        body: JSON.stringify({
          owner_email: formData.ownerEmail,
          merchant_name: formData.name,
          merchant_description: formData.description || undefined,
          merchant_email: formData.ownerEmail,
          owner_name: formData.ownerName || undefined,
          owner_phone: formData.ownerPhone || undefined,
          owner_tax_code: formData.taxCode || undefined,
          merchant_phone: formData.merchantPhone || undefined,
          merchant_contact_phone: formData.contactPhone || undefined,
          new_address_country: formData.country || undefined,
          new_address_province: formData.province || undefined,
          new_address_district: formData.district || undefined,
          new_address_ward: formData.ward || undefined,
          new_address_line: formData.address || undefined,
          category_ids: categoryIds,
        }),
      });
      sessionStorage.removeItem(DRAFT_KEY);
      router.push('/success?type=merchant');
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
        <p style={styles.hint}>Email phải được Supabase xác nhận trước khi hồ sơ được tạo. Tỷ lệ thương mại chỉ do Platform Admin thiết lập.</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label htmlFor="ownerEmail" style={styles.label}>Email chủ tài khoản *</label>
            <input
              id="ownerEmail"
              name="ownerEmail"
              type="email"
              autoComplete="email"
              required
              value={formData.ownerEmail}
              onChange={handleChange}
              readOnly={hasVerifiedSession}
              style={styles.input}
            />
          </div>

          {!hasVerifiedSession && <><div style={styles.formGroup}>
            <label htmlFor="password" style={styles.label}>Mật khẩu *</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={formData.password}
              onChange={handleChange}
              style={styles.input}
            />
            <small style={styles.hint}>Ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.</small>
          </div>

          <div style={styles.formGroup}>
            <label htmlFor="confirmPassword" style={styles.label}>Xác nhận mật khẩu *</label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={formData.confirmPassword}
              onChange={handleChange}
              style={styles.input}
            />
          </div></>}

          <div style={styles.formGroup}><label htmlFor="ownerName" style={styles.label}>Họ tên chủ tài khoản</label><input id="ownerName" name="ownerName" value={formData.ownerName} onChange={handleChange} style={styles.input} /></div>
          <div style={styles.formGroup}><label htmlFor="ownerPhone" style={styles.label}>Điện thoại chủ tài khoản</label><input id="ownerPhone" name="ownerPhone" type="tel" value={formData.ownerPhone} onChange={handleChange} style={styles.input} /></div>
          <div style={styles.formGroup}><label htmlFor="taxCode" style={styles.label}>Mã số thuế</label><input id="taxCode" name="taxCode" value={formData.taxCode} onChange={handleChange} style={styles.input} /></div>

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

          <div style={styles.formGroup}><label htmlFor="merchantPhone" style={styles.label}>Điện thoại doanh nghiệp</label><input id="merchantPhone" name="merchantPhone" type="tel" value={formData.merchantPhone} onChange={handleChange} style={styles.input} /></div>
          <div style={styles.formGroup}><label htmlFor="contactPhone" style={styles.label}>Điện thoại liên hệ</label><input id="contactPhone" name="contactPhone" type="tel" value={formData.contactPhone} onChange={handleChange} style={styles.input} /></div>

          <fieldset style={styles.fieldset}><legend style={styles.legend}>Danh mục ({categoryIds.length}/3)</legend><div style={styles.categoryGrid}>{categories.map((category) => <label key={category.id} style={styles.category}><input type="checkbox" checked={categoryIds.includes(category.id)} onChange={() => toggleCategory(category.id)} disabled={!categoryIds.includes(category.id) && categoryIds.length >= 3} /> {category.category_name_vi || category.category_name || category.id}</label>)}</div></fieldset>

          <fieldset style={styles.fieldset}><legend style={styles.legend}>Địa chỉ doanh nghiệp</legend><div style={styles.form}><div style={styles.formGroup}><label htmlFor="country" style={styles.label}>Quốc gia</label><input id="country" name="country" value={formData.country} onChange={handleChange} style={styles.input} /></div><div style={styles.formGroup}><label htmlFor="province" style={styles.label}>Tỉnh / thành</label><input id="province" name="province" value={formData.province} onChange={handleChange} style={styles.input} /></div><div style={styles.formGroup}><label htmlFor="district" style={styles.label}>Quận / huyện</label><input id="district" name="district" value={formData.district} onChange={handleChange} style={styles.input} /></div><div style={styles.formGroup}><label htmlFor="ward" style={styles.label}>Phường / xã</label><input id="ward" name="ward" value={formData.ward} onChange={handleChange} style={styles.input} /></div><div style={styles.formGroup}><label htmlFor="address" style={styles.label}>Địa chỉ đường</label><input id="address" name="address" value={formData.address} onChange={handleChange} style={styles.input} /></div></div></fieldset>

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

          {notice && <div style={{ ...styles.errorBox, background: '#ecfdf5', color: '#065f46' }}>{notice}</div>}

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
              {isSubmitting ? 'Đang gửi...' : hasVerifiedSession ? 'Gửi Hồ Sơ Để Duyệt' : 'Xác Nhận Email'}
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
  fieldset: { border: '1px solid #d1d5db', borderRadius: 8, padding: 16 },
  legend: { padding: '0 8px', fontWeight: 700, color: '#374151' },
  categoryGrid: { display: 'grid', gap: 8 },
  category: { display: 'flex', alignItems: 'center', gap: 8, color: '#374151', fontSize: 14 },
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
