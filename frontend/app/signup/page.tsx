"use client";

import { Store, Users } from 'lucide-react';
import { Wordmark, Card } from '../../components/ui/Brand';
import { ButtonLink } from '../../components/ui/Button';

const OPTIONS = [
  { href: '/merchant/onboard', Icon: Store, title: 'Nhà cung cấp', text: 'Dành cho khách sạn, nhà hàng, tour và các dịch vụ khác.', points: ['Đăng ký dịch vụ của bạn', 'Quản lý đơn hàng', 'Thiết lập chiết khấu cho khách hàng'], cta: 'Đăng ký làm nhà cung cấp' },
  { href: '/collaborator/onboard', Icon: Users, title: 'Đối tác', text: 'Dành cho hướng dẫn viên và người giới thiệu dịch vụ.', points: ['Điền một lần, Admin phê duyệt', 'Nhận email kích hoạt, vào Cổng Đối tác bằng một lần nhấp', 'Nhận hoa hồng và quản lý mã QR cá nhân'], cta: 'Đăng ký làm đối tác' },
];

export default function SignupPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="text-center"><Wordmark className="text-3xl" /><h1 className="mt-4 text-2xl font-bold tracking-tight">Tạo tài khoản VNO</h1><p className="mt-1 text-sm text-ink-muted">Chọn loại tài khoản bạn muốn đăng ký.</p></div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {OPTIONS.map(({ href, Icon, title, text, points, cta }) => (
          <Card key={href} className="flex flex-col p-5">
            <span className="grid size-11 place-items-center rounded-full bg-brand-50 text-brand-700"><Icon aria-hidden="true" className="size-5" /></span>
            <h2 className="mt-3 text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-ink-muted">{text}</p>
            <ul className="mt-3 flex-1 list-disc space-y-1 pl-5 text-sm">{points.map((p) => <li key={p}>{p}</li>)}</ul>
            <ButtonLink href={href} className="mt-5 w-full">{cta}</ButtonLink>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-center text-sm text-ink-muted">Đã có tài khoản? <a href="/login" className="font-semibold text-brand-700 underline">Đăng nhập</a></p>
    </main>
  );
}
