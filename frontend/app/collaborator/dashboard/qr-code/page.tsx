"use client";

import { useEffect, useState } from 'react';
import { publicApiFetch } from '@/lib/api';

export default function CollaboratorQRCodePage() {
  const [qrData, setQrData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchQRCode() {
      try {
        // Get collaborator ID from localStorage
        const collaborator = localStorage.getItem('collaborator');
        if (!collaborator) {
          setError('Collaborator data not found. Please log in again.');
          setLoading(false);
          return;
        }

        const collaboratorData = JSON.parse(collaborator);
        const collaboratorId = collaboratorData.id;

        // Fetch QR code from backend
        const data = await publicApiFetch(`/collaborators/${collaboratorId}/qr-code`);
        setQrData(data);
      } catch (err: any) {
        console.error('Error fetching QR code:', err);
        setError(err.message || 'Failed to load QR code');
      } finally {
        setLoading(false);
      }
    }

    fetchQRCode();
  }, []);

  const downloadQRCode = () => {
    if (!qrData?.qr_code_image) return;

    const link = document.createElement('a');
    link.href = qrData.qr_code_image;
    link.download = `collaborator-${qrData.collaborator_code}-qr.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}></div>
        <p style={styles.loadingText}>Đang tải mã QR của bạn...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.errorContainer}>
        <div style={styles.errorCard}>
          <div style={styles.errorIcon}>⚠️</div>
          <h2 style={styles.errorTitle}>Không thể tải mã QR</h2>
          <p style={styles.errorMessage}>{error}</p>
          <p style={styles.errorHint}>
            Vui lòng liên hệ quản trị viên nếu bạn nghĩ đây là lỗi.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {/* Header */}
        <div style={styles.header}>
          <h1 style={styles.title}>Mã QR Cộng Tác Viên</h1>
          <p style={styles.subtitle}>
            Chia sẻ mã QR này với các Merchant để xác minh danh tính của bạn
          </p>
        </div>

        {/* QR Code Card */}
        <div style={styles.card}>
          {/* Verified Badge */}
          {qrData?.verified && (
            <div style={styles.badgeContainer}>
              <div style={styles.badge}>
                <span style={styles.badgeIcon}>✓</span>
                <span style={styles.badgeText}>Đã Xác Minh</span>
              </div>
            </div>
          )}

          {/* QR Code Image */}
          <div style={styles.qrContainer}>
            <div style={styles.qrWrapper}>
              <img
                src={qrData?.qr_code_image}
                alt="Collaborator QR Code"
                style={styles.qrImage}
              />
            </div>
          </div>

          {/* Collaborator Info */}
          <div style={styles.infoSection}>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Mã Cộng Tác Viên:</span>
              <span style={styles.infoValue}>{qrData?.collaborator_code}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Tên:</span>
              <span style={styles.infoValue}>{qrData?.collaborator_name}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Điện Thoại:</span>
              <span style={styles.infoValue}>{qrData?.collaborator_phone}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Tổ Chức:</span>
              <span style={styles.infoValue}>{qrData?.organization_name}</span>
            </div>
          </div>

          {/* Download Button */}
          <button onClick={downloadQRCode} style={styles.downloadButton}>
            <span style={styles.downloadIcon}>⬇️</span>
            <span>Tải Xuống Mã QR</span>
          </button>

          {/* Instructions */}
          <div style={styles.instructions}>
            <h3 style={styles.instructionsTitle}>Cách sử dụng:</h3>
            <ul style={styles.instructionsList}>
              <li style={styles.instructionItem}>
                Hiển thị mã QR này cho merchant khi check-in
              </li>
              <li style={styles.instructionItem}>
                Merchant sẽ quét mã để xác minh danh tính của bạn
              </li>
              <li style={styles.instructionItem}>
                Giữ mã QR này an toàn và không chia sẻ công khai
              </li>
              <li style={styles.instructionItem}>
                Tải xuống một bản sao để truy cập ngoại tuyến
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
    padding: '48px 16px',
  },
  content: {
    maxWidth: '800px',
    margin: '0 auto',
  },
  loadingContainer: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
  },
  spinner: {
    width: '48px',
    height: '48px',
    border: '4px solid #e5e7eb',
    borderTop: '4px solid #1f2937',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  loadingText: {
    marginTop: '16px',
    color: '#6b7280',
  },
  errorContainer: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
  },
  errorCard: {
    backgroundColor: 'white',
    padding: '32px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    maxWidth: '448px',
    width: '100%',
    textAlign: 'center' as const,
  },
  errorIcon: {
    fontSize: '64px',
    marginBottom: '16px',
  },
  errorTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '8px',
  },
  errorMessage: {
    color: '#6b7280',
    marginBottom: '16px',
  },
  errorHint: {
    fontSize: '14px',
    color: '#9ca3af',
  },
  header: {
    textAlign: 'center' as const,
    marginBottom: '32px',
  },
  title: {
    fontSize: '30px',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '8px',
  },
  subtitle: {
    color: '#6b7280',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    padding: '32px',
  },
  badgeContainer: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '24px',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '8px 16px',
    borderRadius: '9999px',
    backgroundColor: '#d1fae5',
    color: '#065f46',
  },
  badgeIcon: {
    marginRight: '8px',
  },
  badgeText: {
    fontWeight: '600',
  },
  qrContainer: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '24px',
  },
  qrWrapper: {
    backgroundColor: 'white',
    padding: '16px',
    borderRadius: '12px',
    boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',
    border: '4px solid #f3f4f6',
  },
  qrImage: {
    width: '256px',
    height: '256px',
    objectFit: 'contain' as const,
  },
  infoSection: {
    marginBottom: '24px',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: '1px solid #e5e7eb',
  },
  infoLabel: {
    color: '#6b7280',
    fontWeight: '500',
  },
  infoValue: {
    fontWeight: '600',
    fontSize: '16px',
  },
  downloadButton: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px 24px',
    backgroundColor: '#FF385C',
    color: 'white',
    fontWeight: '600',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    transition: 'background-color 0.2s',
  },
  downloadIcon: {
    fontSize: '20px',
  },
  instructions: {
    marginTop: '24px',
    padding: '16px',
    backgroundColor: '#dbeafe',
    borderRadius: '8px',
  },
  instructionsTitle: {
    fontWeight: '600',
    color: '#1e3a8a',
    marginBottom: '8px',
  },
  instructionsList: {
    fontSize: '14px',
    color: '#1e40af',
    paddingLeft: '20px',
    margin: 0,
  },
  instructionItem: {
    marginBottom: '4px',
  },
};
