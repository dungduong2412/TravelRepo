"use client";

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { publicApiFetch } from '../../../lib/api';
import { clearDraft, DRAFT_KEYS, loadDraft } from '../../../lib/onboarding-draft';
import { existingNotice, ExistingState, RegistrationField, registrationFailure, validateRegistration, validationSummary } from '../../../lib/partner-registration';
import { AuthShell } from '../../../components/ui/AuthShell';
import { Field } from '../../../components/ui/Form';
import { Button } from '../../../components/ui/Button';
import { Alert } from '../../../components/ui/Feedback';

/**
 * Partner registration: ONE form, ONE submit. It creates the account, the Partner application and the profile together (status "Chờ phê duyệt"),
 * visible to the Admin straight away. There is no e-mail confirmation first and no second form: the person is e-mailed an activation link when the
 * Admin approves, and that link opens the Partner Portal. Optional details (bank account, photo, ...) are edited inside the portal afterwards.
 */
export default function PartnerRegistrationPage() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: '', phone: '', email: '' });
  const [honeypot, setHoneypot] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RegistrationField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingState | null>(null);
  const [busy, setBusy] = useState(false);
  const feedback = useRef<HTMLDivElement | null>(null);

  // An e-mail remembered from a login attempt of an older, unfinished sign-up is offered as the starting value (never a password).
  useEffect(() => {
    const remembered = loadDraft<{ email?: string }>(DRAFT_KEYS.collaborator)?.email;
    if (remembered) setForm((f) => (f.email ? f : { ...f, email: remembered }));
  }, []);

  useEffect(() => { if (error || existing) feedback.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); }, [error, existing]);

  const set = (field: RegistrationField) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null); setExisting(null);
    const errors = validateRegistration(form);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setError(validationSummary(errors));
      document.getElementById(Object.keys(errors)[0])?.focus();
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const result = await publicApiFetch('/partner-registrations', {
        method: 'POST',
        body: JSON.stringify({ full_name: form.fullName.trim(), phone: form.phone.trim(), email: form.email.trim(), website: honeypot }),
      });
      if (result?.outcome === 'created') {
        clearDraft(DRAFT_KEYS.collaborator);
        const ref = typeof result.reference === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(result.reference) ? `&ref=${encodeURIComponent(result.reference)}` : '';
        router.push(`/success?type=partner-registered${ref}`);
        return;
      }
      if (result?.outcome === 'exists' && ['pending', 'active', 'support'].includes(result.state)) { setExisting(result.state); setBusy(false); return; }
      setError('Phản hồi từ máy chủ không hợp lệ nên đăng ký CHƯA được xác nhận. Hãy thử lại.');
    } catch (err) {
      setError(registrationFailure(err));
    }
    setBusy(false);
  }

  const notice = existing ? existingNotice(existing) : null;

  return (
    <AuthShell
      title="Đăng ký Đối tác"
      subtitle="Dành cho hướng dẫn viên và người giới thiệu dịch vụ. Điền một lần, Admin phê duyệt, rồi bạn nhận email để vào Cổng Đối tác."
      footer={<>Đã có tài khoản? <Link href="/login" className="font-semibold text-brand-700 underline">Đăng nhập</Link></>}
    >
      <form onSubmit={submit} noValidate className="space-y-4" data-testid="registration-form">
        <Field id="fullName" name="fullName" label="Họ và Tên *" autoComplete="name" value={form.fullName} onChange={set('fullName')} error={fieldErrors.fullName} placeholder="Nhập họ và tên đầy đủ" required />
        <Field id="phone" name="phone" type="tel" label="Số Điện Thoại *" autoComplete="tel" inputMode="tel" value={form.phone} onChange={set('phone')} error={fieldErrors.phone} placeholder="+84 912 345 678" required />
        <Field id="email" name="email" type="email" label="Email *" autoComplete="email" value={form.email} onChange={set('email')} error={fieldErrors.email} placeholder="email.cua.ban@example.com" hint="Chúng tôi gửi email kích hoạt tới địa chỉ này khi hồ sơ được phê duyệt." required />

        {/* Honeypot: people never see or reach this field; a value means a bot filled the form. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
          <label htmlFor="website">Website</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
        </div>

        <div ref={feedback} className="space-y-3">
          {error && <div data-testid="registration-error"><Alert tone="danger" title="Chưa thể đăng ký">{error}</Alert></div>}
          {notice && (
            <div data-testid="registration-existing" data-state={existing}>
              <Alert tone={notice.tone} title={notice.title}>
                <p>{notice.body}</p>
                {existing !== 'pending' && (
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {existing === 'active' && <><Link href="/login" className="font-semibold underline">Đăng nhập</Link><Link href="/auth/activate" className="font-semibold underline">Gửi lại liên kết kích hoạt</Link><Link href="/forgot-password" className="font-semibold underline">Quên mật khẩu</Link></>}
                  </p>
                )}
              </Alert>
            </div>
          )}
        </div>

        <p className="text-xs text-ink-muted">Các thông tin khác (tài khoản ngân hàng, ảnh đại diện…) bạn có thể bổ sung trong Cổng Đối tác sau khi tài khoản được kích hoạt.</p>
        <div className="flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => router.push('/signup')} disabled={busy}>Hủy</Button>
          <Button type="submit" className="flex-1" disabled={busy}>{busy ? 'Đang gửi…' : 'Đăng ký'}</Button>
        </div>
      </form>
    </AuthShell>
  );
}
