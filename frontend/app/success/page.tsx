"use client";

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import PendingApplicantMedia from '../../components/PendingApplicantMedia';

function SuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const type = searchParams.get('type') || 'application';

  const messages: Record<string, { title: string; description: string }> = {
    collaborator: {
      title: 'Hồ sơ đang chờ phê duyệt',
      description:
        'Hồ sơ Đối tác của bạn đã được gửi. Tài khoản chưa hoạt động cho đến khi Admin phê duyệt; trong thời gian chờ, bạn chỉ xem được trạng thái hồ sơ và gửi ảnh đại diện để duyệt.',
    },
    merchant: {
      title: 'Hồ sơ đang chờ phê duyệt',
      description:
        'Hồ sơ Nhà cung cấp của bạn đã được gửi. Tài khoản chưa hoạt động cho đến khi Admin phê duyệt; trong thời gian chờ, bạn chỉ xem được trạng thái hồ sơ và gửi ảnh đại diện để duyệt.',
    },
    application: {
      title: 'Hồ sơ đang chờ phê duyệt',
      description: 'Hồ sơ của bạn đã được gửi và đang chờ Admin phê duyệt.',
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

        {(type === 'merchant' || type === 'collaborator') && <PendingApplicantMedia role={type} />}

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
