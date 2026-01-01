"use client";

import { useRouter } from 'next/navigation';

export default function SignupPage() {
  const router = useRouter();

  return (
    <main style={styles.container}>
      <div style={styles.content}>
        <div style={styles.header}>
          <h1 style={styles.title}>Chào Mừng Đến Với VN01</h1>
          <p style={styles.subtitle}>
            Chọn loại tài khoản bạn muốn tạo
          </p>
        </div>

        <div style={styles.cardGrid}>
          {/* Merchant Card */}
          <div style={styles.card}>
            <div style={styles.cardIcon}>🏪</div>
            <h2 style={styles.cardTitle}>Nhà Cung Cấp</h2>
            <p style={styles.cardDescription}>
              Dành cho khách sạn, nhà hàng, tour du lịch và các dịch vụ khác
            </p>
            <ul style={styles.featureList}>
              <li>Đăng ký dịch vụ của bạn</li>
              <li>Quản lý đơn hàng</li>
              <li>Nhận thanh toán trực tiếp</li>
              <li>Thiết lập chiết khấu cho khách hàng</li>
            </ul>
            <button
              onClick={() => router.push('/merchant/onboard')}
              style={styles.primaryButton}
            >
              Đăng Ký Làm Nhà Cung Cấp
            </button>
          </div>

          {/* Collaborator Card */}
          <div style={styles.card}>
            <div style={styles.cardIcon}>👥</div>
            <h2 style={styles.cardTitle}>Cộng Tác Viên</h2>
            <p style={styles.cardDescription}>
              Dành cho hướng dẫn viên du lịch, người giới thiệu dịch vụ
            </p>
            <ul style={styles.featureList}>
              <li>Giới thiệu dịch vụ cho khách hàng</li>
              <li>Nhận hoa hồng hấp dẫn</li>
              <li>Theo dõi doanh thu của bạn</li>
              <li>Quản lý mã QR cá nhân</li>
            </ul>
            <button
              onClick={() => router.push('/collaborator/onboard')}
              style={styles.primaryButton}
            >
              Đăng Ký Làm Cộng Tác Viên
            </button>
          </div>
        </div>

        <div style={styles.footer}>
          <p style={styles.loginText}>
            Đã có tài khoản?{' '}
            <a
              href="/login"
              style={styles.loginLink}
            >
              Đăng nhập ngay
            </a>
          </p>
          <button
            onClick={() => router.push('/')}
            style={styles.backButton}
          >
            ← Quay về trang chủ
          </button>
        </div>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: 'system-ui, sans-serif',
  },
  content: {
    maxWidth: '1000px',
    width: '100%',
  },
  header: {
    textAlign: 'center',
    marginBottom: '48px',
  },
  title: {
    fontSize: '36px',
    fontWeight: 700,
    color: '#111827',
    marginBottom: '12px',
  },
  subtitle: {
    fontSize: '18px',
    color: '#6b7280',
  },
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '32px',
    marginBottom: '48px',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '16px',
    padding: '32px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    transition: 'transform 0.2s, box-shadow 0.2s',
    cursor: 'default',
  },
  cardIcon: {
    fontSize: '64px',
    marginBottom: '20px',
  },
  cardTitle: {
    fontSize: '24px',
    fontWeight: 600,
    color: '#111827',
    marginBottom: '12px',
    textAlign: 'center',
  },
  cardDescription: {
    fontSize: '15px',
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: '24px',
    lineHeight: 1.6,
  },
  featureList: {
    listStyle: 'none',
    padding: 0,
    margin: '0 0 32px 0',
    width: '100%',
  },
  primaryButton: {
    width: '100%',
    padding: '14px 24px',
    backgroundColor: '#FF385C',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  footer: {
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    alignItems: 'center',
  },
  loginText: {
    fontSize: '16px',
    color: '#6b7280',
  },
  loginLink: {
    color: '#FF385C',
    textDecoration: 'none',
    fontWeight: 600,
  },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    fontSize: '14px',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
};
