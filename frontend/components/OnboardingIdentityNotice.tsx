"use client";

import Link from 'next/link';
import { CSSProperties } from 'react';
import { dashboardFor, OnboardingIdentity, OnboardingRole, ROLE_LABEL } from '../lib/onboarding-identity';
import { statusLabel as dbStatusLabel } from '../lib/status-labels';

const box = (bg: string, fg: string): CSSProperties => ({ padding: 12, borderRadius: 6, fontSize: 14, backgroundColor: bg, color: fg, display: 'flex', flexDirection: 'column', gap: 8, lineHeight: 1.5 });
const linkButton: CSSProperties = { alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, color: '#1d4ed8', textDecoration: 'underline', cursor: 'pointer', fontSize: 14 };
const stepRow: CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', margin: 0, padding: 0, listStyle: 'none', fontSize: 13, fontWeight: 600 };
const stepDone: CSSProperties = { padding: '4px 10px', borderRadius: 999, backgroundColor: '#d1fae5', color: '#065f46' };
const stepNow: CSSProperties = { padding: '4px 10px', borderRadius: 999, backgroundColor: '#1d4ed8', color: '#ffffff' };

const roleLabel = (role?: string) => ROLE_LABEL[role || ''] || 'khác';
// Shown inside a sentence, so lower-case; the wording itself comes from lib/status-labels (database "pending" = "Chờ phê duyệt").
const statusLabel = (s?: string) => dbStatusLabel(s).toLowerCase();

/**
 * Explains, above the onboarding form, which verified identity the page is acting for. It deliberately never calls the confirmed
 * session an approved login: operational access still depends on Admin approval.
 */
export default function OnboardingIdentityNotice({ identity, role, onSwitch }: { identity: OnboardingIdentity; role: OnboardingRole; onSwitch: () => void }) {
  const target = ROLE_LABEL[role];

  if (identity.kind === 'ready') {
    // The owner confirmed the e-mail, saw a blank form and left without pressing the button: confirmation alone submits NOTHING, so say it plainly.
    return <div role="status" data-testid="onboarding-step2" style={{ ...box('#eff6ff', '#1e3a8a'), border: '2px solid #1d4ed8', marginBottom: 16 }}>
      <ol style={stepRow} aria-label="Các bước đăng ký">
        <li style={stepDone}>✓ Bước 1/2 · Xác nhận email (xong)</li>
        <li style={stepNow} aria-current="step">Bước 2/2 · Hoàn tất và gửi hồ sơ (bạn đang ở đây)</li>
      </ol>
      <strong style={{ fontSize: 17 }}>Bước 2/2 — Hoàn tất và gửi hồ sơ {target}</strong>
      <span><b>Email đã xác nhận thành công. Vui lòng hoàn tất hồ sơ {target}.</b> Xác nhận email chưa phải là đăng ký: hồ sơ của bạn <b>CHƯA được gửi</b> và Admin chưa nhìn thấy nó. Hãy điền thông tin bên dưới rồi bấm nút “Gửi hồ sơ” ở cuối trang.</span>
      <span>Hồ sơ sẽ được tạo cho email <b>{identity.email}</b>. Bạn không cần nhập lại mật khẩu. Sau khi gửi, hồ sơ ở trạng thái “Chờ phê duyệt” và chức năng {target} chỉ mở sau khi Admin phê duyệt.</span>
      <button type="button" style={linkButton} onClick={onSwitch}>Không phải email của bạn? Đăng xuất để dùng email khác</button>
    </div>;
  }

  if (identity.kind === 'existing') {
    const own = identity.profile.role === role;
    const st = identity.profile.user_profiles_status;
    const title = own
      ? (st === 'pending' ? 'Hồ sơ đang chờ phê duyệt' : st === 'active' ? 'Hồ sơ đã được duyệt' : 'Hồ sơ cần chỉnh sửa hoặc đã bị từ chối')
      : `Bạn đang đăng nhập bằng ${identity.email}`;
    const calm = own && st === 'pending';
    return <div role="alert" style={box(calm ? '#eff6ff' : '#fffbeb', calm ? '#1e3a8a' : '#92400e')}>
      <strong>{title}</strong>
      <span>{own
        ? (st === 'active'
          ? `Email ${identity.email} đã có hồ sơ ${target} được duyệt. Không thể tạo thêm hồ sơ mới; hãy đăng nhập để vào trang làm việc.`
          : `Email ${identity.email} đã có hồ sơ ${target} (${statusLabel(st)}). Không thể tạo thêm hồ sơ mới.`)
        : `Email này đã thuộc về một hồ sơ ${roleLabel(identity.profile.role)} (${statusLabel(st)}). Để đăng ký ${target} bằng email khác, hãy đăng xuất trước. Hồ sơ hiện tại không bị thay đổi.`}</span>
      <span style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Link href={st === 'active' ? '/login' : dashboardFor(identity.profile.role)} style={{ color: '#1d4ed8', textDecoration: 'underline' }}>{st === 'active' ? 'Đăng nhập' : 'Đến trang tài khoản của tôi'}</Link>
        <button type="button" style={linkButton} onClick={onSwitch}>Đăng xuất để dùng email khác</button>
      </span>
    </div>;
  }

  if (identity.kind === 'mismatch') {
    return <div role="alert" style={box('#fffbeb', '#92400e')}>
      <strong>Phiên đăng nhập hiện tại không phải email đang đăng ký {target}</strong>
      <span>{identity.reason === 'email'
        ? `Trình duyệt đang đăng nhập bằng ${identity.email}, khác với email bạn đã nhập (${identity.expectedEmail}). Hồ sơ sẽ không được tạo cho phiên này.`
        : `Email ${identity.email} được đăng ký cho vai trò ${roleLabel(identity.sessionRole)}, không phải ${target}. Hồ sơ sẽ không được tạo cho phiên này.`}</span>
      <button type="button" style={linkButton} onClick={onSwitch}>Đăng xuất phiên này để tiếp tục</button>
    </div>;
  }

  return null;
}
