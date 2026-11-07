"use client";

import Link from 'next/link';
import { CSSProperties } from 'react';
import { dashboardFor, OnboardingIdentity, OnboardingRole, ROLE_LABEL } from '../lib/onboarding-identity';

const box = (bg: string, fg: string): CSSProperties => ({ padding: 12, borderRadius: 6, fontSize: 14, backgroundColor: bg, color: fg, display: 'flex', flexDirection: 'column', gap: 8, lineHeight: 1.5 });
const linkButton: CSSProperties = { alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, color: '#1d4ed8', textDecoration: 'underline', cursor: 'pointer', fontSize: 14 };

const roleLabel = (role?: string) => ROLE_LABEL[role || ''] || 'khác';
const statusLabel = (s?: string) => (s === 'active' ? 'đã được duyệt' : s === 'pending' ? 'đang chờ phê duyệt' : s === 'blocked' ? 'cần chỉnh sửa hoặc đã bị từ chối' : s || 'chưa xác định');

/**
 * Explains, above the onboarding form, which verified identity the page is acting for. It deliberately never calls the confirmed
 * session an approved login: operational access still depends on Admin approval.
 */
export default function OnboardingIdentityNotice({ identity, role, onSwitch }: { identity: OnboardingIdentity; role: OnboardingRole; onSwitch: () => void }) {
  const target = ROLE_LABEL[role];

  if (identity.kind === 'ready') {
    return <div role="status" style={box('#ecfdf5', '#065f46')}>
      <strong>Email đã xác nhận thành công. Vui lòng hoàn tất hồ sơ {target}.</strong>
      <span>Hồ sơ sẽ được tạo cho email <b>{identity.email}</b>. Bạn không cần nhập lại mật khẩu. Hồ sơ chỉ được gửi khi bạn bấm “Gửi hồ sơ”, và chức năng {target} chỉ mở sau khi Admin phê duyệt.</span>
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
