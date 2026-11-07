"use client";

import { CSSProperties, FormEvent, useEffect, useState } from 'react';
import { resumeErrorMessage } from '../lib/auth-errors';
import { ROLE_LABEL, OnboardingRole } from '../lib/onboarding-identity';

const field: CSSProperties = { padding: '10px 12px', fontSize: 16, border: '1px solid #d1d5db', borderRadius: 6, width: '100%', boxSizing: 'border-box' };
const link: CSSProperties = { background: 'none', border: 'none', padding: 0, color: '#1d4ed8', textDecoration: 'underline', cursor: 'pointer', fontSize: 14, textAlign: 'left' };

/**
 * "Đã xác nhận email? Tiếp tục hồ sơ": re-enter an already registered, e-mail-confirmed identity with its ORIGINAL e-mail and password.
 * It authenticates against Supabase Auth only (see resume() in the identity hook); it never signs up again, never sends mail, and the
 * password is held in component state only (never in the draft).
 */
export default function ResumeOnboarding({ role, defaultEmail, forceOpen, resume, onAttempt }: {
  role: OnboardingRole;
  defaultEmail: string;
  forceOpen: boolean;
  resume: (email: string, password: string) => Promise<string | null>;
  onAttempt: (email: string) => void; // lets the page record the e-mail the person explicitly chose to resume as
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (forceOpen) setOpen(true); }, [forceOpen]);
  useEffect(() => { if (!email && defaultEmail) setEmail(defaultEmail); }, [defaultEmail, email]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) { setError('Vui lòng nhập email và mật khẩu đã đăng ký.'); return; }
    setBusy(true); setError(null);
    onAttempt(email.trim());
    const code = await resume(email, password);
    setBusy(false);
    if (code) setError(resumeErrorMessage(code)); else setPassword('');
  }

  if (!open) {
    return <button type="button" style={link} onClick={() => setOpen(true)}>Đã xác nhận email? Tiếp tục hồ sơ {ROLE_LABEL[role]}</button>;
  }
  return <form onSubmit={submit} aria-label="Tiếp tục hồ sơ" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 6 }}>
    <strong style={{ fontSize: 14, color: '#1e3a8a' }}>Tiếp tục hồ sơ {ROLE_LABEL[role]}</strong>
    <span style={{ fontSize: 13, color: '#1e3a8a' }}>Nhập email và mật khẩu bạn đã đăng ký. Không gửi email mới và không tạo tài khoản mới.</span>
    <input id="resumeEmail" name="resumeEmail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email đã đăng ký" style={field} />
    <input id="resumePassword" name="resumePassword" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu đã đăng ký" style={field} />
    {error && <div role="alert" style={{ fontSize: 14, color: '#991b1b', background: '#fee2e2', padding: 10, borderRadius: 6 }}>{error}</div>}
    <button type="submit" disabled={busy} style={{ padding: '10px 16px', fontSize: 15, fontWeight: 500, color: 'white', background: '#2563eb', border: 'none', borderRadius: 6, cursor: 'pointer' }}>{busy ? 'Đang kiểm tra…' : 'Tiếp tục hồ sơ'}</button>
  </form>;
}
