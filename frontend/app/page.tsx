// This is the main page for the frontend app. Replace with your actual UI implementation.
"use client";

import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();

  return (
    <main style={styles.container}>
      <h1 style={styles.title}>Chào mừng</h1>
      <p style={styles.subtitle}>
        Vui lòng chọn vai trò của bạn để tham gia nền tảng
      </p>

      <div style={styles.buttonGroup}>
        <button
          style={styles.primaryButton}
          onClick={() => router.push('/merchant/onboard')}
        >
          Tôi là Nhà Cung Cấp
        </button>

        <button
          style={styles.secondaryButton}
          onClick={() => router.push('/collaborator/onboard')}
        >
          Tôi là Cộng Tác Viên
        </button>
      </div>
    </main>
  );
}

/* --- Minimal inline styles (no dependencies) --- */

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '24px',
    fontFamily: 'system-ui, sans-serif',
  },
  title: {
    fontSize: '32px',
    fontWeight: 600,
  },
  subtitle: {
    fontSize: '16px',
    color: '#555',
  },
  buttonGroup: {
    display: 'flex',
    gap: '16px',
    marginTop: '24px',
  },
  primaryButton: {
    padding: '12px 24px',
    fontSize: '16px',
    cursor: 'pointer',
    backgroundColor: '#000',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
  },
  secondaryButton: {
    padding: '12px 24px',
    fontSize: '16px',
    cursor: 'pointer',
    backgroundColor: '#fff',
    color: '#000',
    border: '1px solid #000',
    borderRadius: '6px',
  },
};
