/**
 * Branded, bilingual (Vietnamese first, English second) templates for the Supabase Auth Send Email hook.
 * Constraints: e-mail clients ignore most CSS, so layout is a single-column table with inline styles; 16px body text, a 48px-high tap target,
 * a visible copy-able fallback link (in-app mail browsers sometimes block buttons), a plain-text alternative, and a UAT banner.
 * Colours come from the web design system (--color-brand-600 #d91e4a, ink #1b1f27, muted #5b6472, canvas #f7f7f8).
 */
export type TemplateKind = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'reauthentication' | 'generic';

type Copy = { subject: [string, string]; heading: [string, string]; body: [string, string]; button: [string, string]; ignore: [string, string] };

const IGNORE: [string, string] = [
  'Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email — không có gì thay đổi với tài khoản của bạn.',
  'If you did not request this, ignore this email — nothing changes on your account.',
];

const COPY: Record<TemplateKind, Copy> = {
  signup: {
    subject: ['Xác nhận email đăng ký VNO', 'Confirm your VNO email'],
    heading: ['Xác nhận địa chỉ email của bạn', 'Confirm your email address'],
    body: ['Cảm ơn bạn đã đăng ký Vietnam Number One. Nhấn nút bên dưới để xác nhận email và kích hoạt tài khoản.', 'Thanks for signing up to Vietnam Number One. Tap the button below to confirm your email and activate your account.'],
    button: ['Xác nhận email', 'Confirm email'], ignore: IGNORE,
  },
  invite: {
    subject: ['Lời mời tham gia VNO', 'You are invited to VNO'],
    heading: ['Bạn được mời tham gia VNO', 'You are invited to VNO'],
    body: ['Quản trị viên đã tạo tài khoản cho bạn trên Vietnam Number One. Nhấn nút bên dưới để nhận tài khoản và đặt mật khẩu.', 'An administrator created an account for you on Vietnam Number One. Tap the button below to claim it and set your password.'],
    button: ['Nhận tài khoản', 'Claim account'], ignore: IGNORE,
  },
  magiclink: {
    subject: ['Liên kết đăng nhập VNO', 'Your VNO sign-in link'],
    heading: ['Đăng nhập vào VNO', 'Sign in to VNO'],
    body: ['Nhấn nút bên dưới để đăng nhập. Liên kết chỉ dùng được một lần.', 'Tap the button below to sign in. The link works once.'],
    button: ['Đăng nhập', 'Sign in'], ignore: IGNORE,
  },
  recovery: {
    subject: ['Đặt lại mật khẩu VNO', 'Reset your VNO password'],
    heading: ['Đặt lại mật khẩu', 'Reset your password'],
    body: ['Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Nhấn nút bên dưới để chọn mật khẩu mới. Liên kết chỉ dùng được một lần.', 'We received a request to reset your account password. Tap the button below to choose a new one. The link works once.'],
    button: ['Đặt lại mật khẩu', 'Reset password'], ignore: IGNORE,
  },
  email_change: {
    subject: ['Xác nhận thay đổi email VNO', 'Confirm your VNO email change'],
    heading: ['Xác nhận thay đổi email', 'Confirm your email change'],
    body: ['Nhấn nút bên dưới để xác nhận thay đổi địa chỉ email của tài khoản.', 'Tap the button below to confirm the email address change on your account.'],
    button: ['Xác nhận thay đổi', 'Confirm change'], ignore: IGNORE,
  },
  reauthentication: {
    subject: ['Mã xác minh VNO', 'Your VNO verification code'],
    heading: ['Mã xác minh của bạn', 'Your verification code'],
    body: ['Nhập mã dưới đây để tiếp tục thao tác.', 'Enter the code below to continue.'],
    button: ['', ''], ignore: IGNORE,
  },
  generic: {
    subject: ['Thông báo từ VNO', 'A message from VNO'],
    heading: ['Thông báo từ VNO', 'A message from VNO'],
    body: ['Nhấn nút bên dưới để tiếp tục.', 'Tap the button below to continue.'],
    button: ['Tiếp tục', 'Continue'], ignore: IGNORE,
  },
};

const UAT_NOTE: [string, string] = [
  'Đây là môi trường thử nghiệm (UAT) của VNO. Email này chỉ gửi cho người kiểm thử đã được duyệt.',
  'This is the VNO test (UAT) environment. This email is sent to approved testers only.',
];

export function templateKind(type: string): TemplateKind {
  return (type in COPY ? type : 'generic') as TemplateKind;
}

export function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function renderEmail(opts: { type: string; link?: string; code?: string; subjectPrefix: string }): { subject: string; html: string; text: string } {
  const kind = templateKind(opts.type);
  const c = COPY[kind];
  const subject = `${opts.subjectPrefix}${c.subject[0]} / ${c.subject[1]}`;
  const showCode = kind === 'reauthentication';
  const link = showCode ? '' : opts.link || '';
  const preheader = `${c.heading[0]} · ${c.heading[1]}`;

  const button = link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px"><tr><td align="center" bgcolor="#d91e4a" style="border-radius:12px"><a href="${esc(link)}" target="_blank" style="display:inline-block;min-height:24px;line-height:24px;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px">${esc(c.button[0])} / ${esc(c.button[1])}</a></td></tr></table>`
    : '';
  const code = showCode
    ? `<p style="margin:24px 0;font-family:'Courier New',monospace;font-size:32px;letter-spacing:6px;font-weight:700;color:#1b1f27">${esc(opts.code || '')}</p>`
    : '';
  const fallback = link
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:20px;color:#5b6472">Nếu nút không hoạt động, sao chép liên kết này vào trình duyệt / If the button does not work, copy this link into your browser:<br><a href="${esc(link)}" style="color:#b3153b;word-break:break-all">${esc(link)}</a></p>`
    : '';

  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f7f8;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f7f7f8">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f7f8"><tr><td align="center" style="padding:16px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
<tr><td style="background:#d91e4a;padding:18px 24px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:#ffffff">Vietnam Number One</td></tr>
<tr><td style="padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#1b1f27">
<h1 style="margin:0 0 12px;font-size:22px;line-height:28px;color:#1b1f27">${esc(c.heading[0])}</h1>
<p style="margin:0 0 12px">${esc(c.body[0])}</p>
<h2 style="margin:20px 0 8px;font-size:16px;line-height:24px;color:#5b6472;font-weight:700">${esc(c.heading[1])}</h2>
<p style="margin:0 0 4px;color:#1b1f27">${esc(c.body[1])}</p>
${button}${code}${fallback}
<hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0 16px">
<p style="margin:0 0 8px;font-size:13px;line-height:20px;color:#5b6472">${esc(c.ignore[0])}<br>${esc(c.ignore[1])}</p>
<p style="margin:0;font-size:12px;line-height:18px;color:#93370d;background:#fffaeb;border-radius:8px;padding:8px 10px">${esc(UAT_NOTE[0])}<br>${esc(UAT_NOTE[1])}</p>
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    'Vietnam Number One',
    '',
    c.heading[0], c.body[0], '',
    c.heading[1], c.body[1], '',
    showCode ? `${opts.code || ''}` : `${c.button[0]} / ${c.button[1]}: ${link}`,
    '',
    c.ignore[0], c.ignore[1], '',
    UAT_NOTE[0], UAT_NOTE[1],
  ].join('\n');

  return { subject, html, text };
}
