"use client";

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function SuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = searchParams.get('type') || 'application';

  const messages: Record<string, { title: string; description: string }> = {
    collaborator: {
      title: 'Đã Gửi Đơn Đăng Ký Cộng Tác Viên!',
      description:
        'Cảm ơn bạn đã đăng ký làm cộng tác viên. Đơn đăng ký của bạn đã được tiếp nhận và đang ở trạng thái nháp. Bạn sẽ nhận được hướng dẫn chi tiết qua email.',
    },
    merchant: {
      title: 'Đã Gửi Đơn Đăng Ký Nhà Cung Cấp!',
      description:
        'Đơn đăng ký nhà cung cấp của bạn đã được gửi thành công. Đội ngũ của chúng tôi sẽ xem xét đơn đăng ký và liên hệ với bạn sớm.',
    },
    application: {
      title: 'Thành Công!',
      description: 'Đơn đăng ký của bạn đã được gửi thành công.',
    },
  };

  const message = messages[type] || messages.application;

  return (
    <main style={styles.container}>
      <div style={styles.card}>
        <div style={styles.iconContainer}>
          <svg
            style={styles.icon}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        <h1 style={styles.title}>{message.title}</h1>
        <p style={styles.description}>{message.description}</p>

        <div style={styles.buttonGroup}>
          <button
            onClick={() => router.push('/')}
            style={styles.primaryButton}
          >
            Về Trang Chủ
          </button>
        </div>
      </div>
    </main>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<div>Đang tải...</div>}>
      <SuccessContent />
    </Suspense>
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
  card: {
    width: '100%',
    maxWidth: '500px',
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '48px 32px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '24px',
  },
  iconContainer: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    backgroundColor: '#d1fae5',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    width: '48px',
    height: '48px',
    color: '#059669',
  },
  title: {
    fontSize: '28px',
    fontWeight: 600,
    color: '#111827',
    marginTop: '8px',
  },
  description: {
    fontSize: '16px',
    color: '#6b7280',
    lineHeight: '1.6',
    maxWidth: '400px',
  },
  buttonGroup: {
    display: 'flex',
    gap: '12px',
    width: '100%',
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
};
