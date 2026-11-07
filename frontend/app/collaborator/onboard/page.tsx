"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { signUp } from '../../../lib/supabase';
import { useOnboardingIdentity } from '../../../lib/onboarding-identity';
import OnboardingIdentityNotice from '../../../components/OnboardingIdentityNotice';
import ResumeOnboarding from '../../../components/ResumeOnboarding';
import { errorCode } from '../../../lib/auth-diagnostics';
import { ALREADY_REGISTERED_RESUME_TEXT, signupErrorMessage } from '../../../lib/auth-errors';
import { clearDraft, loadDraft, saveDraft } from '../../../lib/onboarding-draft';
import { isValidPassword, PASSWORD_ERROR, PASSWORD_HINT } from '../../../lib/password-policy';

const DRAFT_KEY = 'vno-collaborator-onboarding-draft';
const intendedEmail = () => loadDraft<{ email?: string }>(DRAFT_KEY)?.email || undefined;

export default function CollaboratorOnboardPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    email: '',
    password: '',
    confirmPassword: '',
    bankName: '',
    bankAccountName: '',
    bankAccountNumber: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const { identity, switchAccount, stillCurrent, resume, refresh } = useOnboardingIdentity('collaborator', intendedEmail);
  const [resumeForce, setResumeForce] = useState(false);
  const hasVerifiedSession = identity.kind === 'ready';
  const formVisible = identity.kind === 'anonymous' || identity.kind === 'ready';

  useEffect(() => {
    try {
      const draft = loadDraft<Record<string, string>>(DRAFT_KEY);
      if (draft) setFormData((current) => ({ ...current, ...draft, password: '', confirmPassword: '' }));
    } catch { /* Invalid local draft is ignored. */ }
  }, []);

  // The verified Auth e-mail is the only identity the profile is created for; it replaces whatever was typed, but only for a session that belongs to this sign-up.
  useEffect(() => {
    if (identity.kind === 'ready') setFormData((current) => ({ ...current, email: identity.email }));
  }, [identity]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const next = { ...prev, [name]: value };
      const { password: _password, confirmPassword: _confirmPassword, ...safe } = next;
      saveDraft(DRAFT_KEY, safe);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (identity.kind === 'loading' || identity.kind === 'existing' || identity.kind === 'mismatch') return;
    setIsSubmitting(true);
    setError(null);
    setValidationErrors({});

    // Client-side validation
    const errors: Record<string, string> = {};

    if (!formData.fullName.trim()) {
      errors.fullName = 'Họ và tên là bắt buộc';
    }

    if (!formData.phone.trim()) {
      errors.phone = 'Số điện thoại là bắt buộc';
    } else if (!/^[0-9]{10,11}$/.test(formData.phone.replace(/\s/g, ''))) {
      errors.phone = 'Số điện thoại phải có 10-11 chữ số';
    }

    if (!formData.email.trim()) {
      errors.email = 'Email là bắt buộc';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Email không hợp lệ';
    }

    if (!hasVerifiedSession && !formData.password) {
      errors.password = 'Mật khẩu là bắt buộc';
    } else if (!hasVerifiedSession && !isValidPassword(formData.password)) {
      errors.password = PASSWORD_ERROR;
    }

    if (!hasVerifiedSession && formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Mật khẩu xác nhận không khớp';
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      setIsSubmitting(false);
      return;
    }

    try {
      if (!hasVerifiedSession) {
        const data = await signUp(
          formData.email,
          formData.password,
          'collaborator',
          `${window.location.origin}/collaborator/onboard?confirmed=1`,
        );
        if (!data.session) {
          setNotice('Kiểm tra email và mở liên kết xác nhận. Sau khi xác nhận, bạn sẽ quay lại trang này để hoàn tất hồ sơ Đối tác; hồ sơ chưa được tạo cho đến khi bạn bấm “Gửi hồ sơ”.');
          setIsSubmitting(false);
          return;
        }
      }

      // Another tab may have switched the browser session since this page resolved it: never submit for a different identity than the one shown.
      if (identity.kind === 'ready' && !(await stillCurrent(identity.email))) {
        setError('Phiên đăng nhập đã thay đổi. Vui lòng tải lại trang để tiếp tục.');
        setIsSubmitting(false);
        return;
      }

      const payload = {
        collaborators_name: formData.fullName,
        collaborators_phone: formData.phone,
        collaborators_email: identity.kind === 'ready' ? identity.email : formData.email,
        collaborators_bank_name: formData.bankName || undefined,
        collaborators_bank_acc_name: formData.bankAccountName || undefined,
        collaborators_bank_acc_number: formData.bankAccountNumber || undefined,
      };

      await apiFetch('/collaborators', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      clearDraft(DRAFT_KEY);

      // Redirect to success page
      router.push('/success?type=collaborator');
    } catch (err) {
      const code = errorCode(err);
      if (code === 'user_already_exists' || code === 'email_exists') { setError(ALREADY_REGISTERED_RESUME_TEXT); setResumeForce(true); }
      else if (err instanceof Error && /already exists/i.test(err.message)) {
        // This verified identity already has an application: show its status instead of a raw API message.
        setError('Email này đã có hồ sơ. Không thể tạo thêm hồ sơ mới.'); refresh();
      } else setError(signupErrorMessage(code) ?? (err instanceof Error ? err.message : 'Đã xảy ra lỗi khi gửi đơn đăng ký'));
      setIsSubmitting(false);
    }
  };

  return (
    <main style={styles.container}>
      <div style={styles.formContainer}>
        <h1 style={styles.title}>Đăng Ký Đối Tác</h1>
        <p style={styles.subtitle}>Tham gia với vai trò hướng dẫn viên du lịch và bắt đầu nhận hoa hồng</p>
        <p style={styles.hint}>Email phải được xác nhận trước khi hồ sơ được tạo. Quyền hoạt động và ảnh đại diện được Admin duyệt riêng.</p>
        <OnboardingIdentityNotice identity={identity} role="collaborator" onSwitch={switchAccount} />

        {identity.kind === 'anonymous' && <ResumeOnboarding role="collaborator" defaultEmail={formData.email} forceOpen={resumeForce} resume={resume}
          onAttempt={(email) => { saveDraft(DRAFT_KEY, { ...(loadDraft<Record<string, string>>(DRAFT_KEY) || {}), email }); setFormData((c) => ({ ...c, email })); }} />}
        {identity.kind === 'loading' && <p style={styles.hint} aria-live="polite">Đang kiểm tra phiên đăng nhập…</p>}
        {formVisible && <form onSubmit={handleSubmit} style={styles.form}>
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
            {validationErrors.fullName && (
              <span style={styles.errorText}>{validationErrors.fullName}</span>
            )}
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
            {validationErrors.phone && (
              <span style={styles.errorText}>{validationErrors.phone}</span>
            )}
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
              readOnly={hasVerifiedSession}
              style={styles.input}
              placeholder="email.cua.ban@example.com"
            />
            {validationErrors.email && (
              <span style={styles.errorText}>{validationErrors.email}</span>
            )}
          </div>

          {!hasVerifiedSession && <><div style={styles.formGroup}>
            <label htmlFor="password" style={styles.label}>
              Mật Khẩu *
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              value={formData.password}
              onChange={handleChange}
              style={styles.input}
            />
            <small style={styles.hint}>{PASSWORD_HINT}</small>
            {validationErrors.password && (
              <span style={styles.errorText}>{validationErrors.password}</span>
            )}
          </div>

          <div style={styles.formGroup}>
            <label htmlFor="confirmPassword" style={styles.label}>
              Xác Nhận Mật Khẩu *
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              value={formData.confirmPassword}
              onChange={handleChange}
              style={styles.input}
              placeholder="Nhập lại mật khẩu"
            />
            {validationErrors.confirmPassword && (
              <span style={styles.errorText}>{validationErrors.confirmPassword}</span>
            )}
          </div></>}

          <div style={styles.formGroup}>
            <label htmlFor="bankName" style={styles.label}>
              Tên Ngân Hàng
            </label>
            <input
              id="bankName"
              name="bankName"
              type="text"
              value={formData.bankName}
              onChange={handleChange}
              style={styles.input}
              placeholder="Ví dụ: Vietcombank, Techcombank"
            />
          </div>

          <div style={styles.formGroup}>
            <label htmlFor="bankAccountNumber" style={styles.label}>
              Số Tài Khoản Ngân Hàng
            </label>
            <input
              id="bankAccountNumber"
              name="bankAccountNumber"
              type="text"
              value={formData.bankAccountNumber}
              onChange={handleChange}
              style={styles.input}
              placeholder="Nhập số tài khoản của bạn"
            />
          </div>

          <div style={styles.formGroup}>
            <label htmlFor="bankAccountName" style={styles.label}>Tên Chủ Tài Khoản</label>
            <input id="bankAccountName" name="bankAccountName" type="text" value={formData.bankAccountName} onChange={handleChange} style={styles.input} autoComplete="off" />
          </div>

          {error && (
            <div style={styles.errorBox}>
              {error}
            </div>
          )}
          {notice && <div style={{ ...styles.errorBox, background: '#ecfdf5', color: '#065f46' }}>{notice}</div>}

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
              {isSubmitting ? 'Đang gửi...' : hasVerifiedSession ? 'Gửi hồ sơ' : 'Đăng ký & xác nhận email'}
            </button>
          </div>
        </form>}
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
  errorText: {
    fontSize: '12px',
    color: '#dc2626',
    marginTop: '4px',
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
