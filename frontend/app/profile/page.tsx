"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';

interface UserProfile {
  id: string;
  email: string;
  role: 'admin' | 'merchant' | 'collaborator';
  merchant_id?: string | null;
  collaborator_id?: string | null;
  last_login_at?: string | null;
  login_count?: number;
  created_at?: string;
  updated_at?: string;
}

interface MerchantDetails {
  merchant_system_id: string;
  merchant_name: string;
  owner_name?: string;
  owner_phone?: string;
  merchant_contact_phone?: string;
  merchant_category?: string;
  merchant_verified: boolean;
  new_address_city?: string;
  new_address_ward?: string;
  new_address_line?: string;
}

interface CollaboratorDetails {
  id: string;
  collaborators_name?: string;
  collaborators_phone?: string;
  collaborators_email?: string;
  collaborators_bank_name?: string;
  collaborators_verified: boolean;
  collaborators_rating?: number;
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [details, setDetails] = useState<MerchantDetails | CollaboratorDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const profileData = await apiFetch('/user-profiles/me');
      setProfile(profileData);

      // Fetch detailed information based on role
      if (profileData.role === 'merchant' && profileData.merchant_id) {
        const merchantData = await apiFetch(`/merchants/${profileData.merchant_id}`);
        setDetails(merchantData);
      } else if (profileData.role === 'collaborator' && profileData.collaborator_id) {
        const collaboratorData = await apiFetch(`/collaborators/${profileData.collaborator_id}`);
        setDetails(collaboratorData);
      }

      // Track login
      await apiFetch('/user-profiles/track-login', { method: 'POST' });
    } catch (err: any) {
      setError(err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return 'Chưa có';
    const date = new Date(dateString);
    return date.toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':
        return 'Quản Trị Viên';
      case 'merchant':
        return 'Nhà Cung Cấp';
      case 'collaborator':
        return 'Cộng Tác Viên';
      default:
        return role;
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return '#dc2626';
      case 'merchant':
        return '#2563eb';
      case 'collaborator':
        return '#16a34a';
      default:
        return '#6b7280';
    }
  };

  if (loading) {
    return (
      <main style={styles.container}>
        <div style={styles.loadingContainer}>
          <p style={styles.loadingText}>Đang tải thông tin...</p>
        </div>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main style={styles.container}>
        <div style={styles.errorContainer}>
          <p style={styles.errorText}>{error || 'Không tìm thấy thông tin người dùng'}</p>
          <button onClick={() => router.push('/')} style={styles.retryButton}>
            Về Trang Chủ
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.container}>
      <div style={styles.content}>
        <div style={styles.header}>
          <h1 style={styles.title}>Hồ Sơ Của Tôi</h1>
          <button onClick={() => router.push('/')} style={styles.backButton}>
            ← Trang Chủ
          </button>
        </div>

        {/* User Profile Card */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Thông Tin Tài Khoản</h2>
          <div style={styles.cardContent}>
            <div style={styles.infoRow}>
              <span style={styles.label}>Email:</span>
              <span style={styles.value}>{profile.email}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.label}>Vai Trò:</span>
              <span
                style={{
                  ...styles.roleBadge,
                  backgroundColor: getRoleBadgeColor(profile.role),
                }}
              >
                {getRoleLabel(profile.role)}
              </span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.label}>Lần Đăng Nhập Cuối:</span>
              <span style={styles.value}>{formatDate(profile.last_login_at)}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.label}>Tổng Số Lần Đăng Nhập:</span>
              <span style={styles.valueHighlight}>{profile.login_count || 0} lần</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.label}>Ngày Tạo Tài Khoản:</span>
              <span style={styles.value}>{formatDate(profile.created_at)}</span>
            </div>
          </div>
        </div>

        {/* Merchant/Collaborator Details Card */}
        {details && profile.role === 'merchant' && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Thông Tin Doanh Nghiệp</h2>
            <div style={styles.cardContent}>
              <div style={styles.infoRow}>
                <span style={styles.label}>Tên Doanh Nghiệp:</span>
                <span style={styles.value}>{(details as MerchantDetails).merchant_name}</span>
              </div>
              {(details as MerchantDetails).owner_name && (
                <div style={styles.infoRow}>
                  <span style={styles.label}>Tên Chủ Sở Hữu:</span>
                  <span style={styles.value}>{(details as MerchantDetails).owner_name}</span>
                </div>
              )}
              {(details as MerchantDetails).merchant_contact_phone && (
                <div style={styles.infoRow}>
                  <span style={styles.label}>Số Điện Thoại:</span>
                  <span style={styles.value}>{(details as MerchantDetails).merchant_contact_phone}</span>
                </div>
              )}
              {(details as MerchantDetails).merchant_category && (
                <div style={styles.infoRow}>
                  <span style={styles.label}>Danh Mục:</span>
                  <span style={styles.value}>{(details as MerchantDetails).merchant_category}</span>
                </div>
              )}
              {(details as MerchantDetails).new_address_line && (
                <div style={styles.infoRow}>
                  <span style={styles.label}>Địa Chỉ:</span>
                  <span style={styles.value}>
                    {(details as MerchantDetails).new_address_line}, {(details as MerchantDetails).new_address_ward}, {(details as MerchantDetails).new_address_city}
                  </span>
                </div>
              )}
              <div style={styles.infoRow}>
                <span style={styles.label}>Trạng Thái:</span>
                <span
                  style={{
                    ...styles.statusBadge,
                    backgroundColor: (details as MerchantDetails).merchant_verified ? '#10b981' : '#f59e0b',
                  }}
                >
                  {(details as MerchantDetails).merchant_verified ? '✓ Đã Xác Thực' : '⏳ Chờ Xác Thực'}
                </span>
              </div>
            </div>
          </div>
        )}

        {details && profile.role === 'collaborator' && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Thông Tin Cộng Tác Viên</h2>
            <div style={styles.cardContent}>
              {(details as CollaboratorDetails).collaborators_name && (
                <div style={styles.infoRow}>
                  <span style={styles.label}>Họ và Tên:</span>
                  <span style={styles.value}>{(details as CollaboratorDetails).collaborators_name}</span>
                </div>
              )}
              {(details as CollaboratorDetails).collaborators_phone && (
                <div style={styles.infoRow}>
                  <span style={styles.label}>Số Điện Thoại:</span>
                  <span style={styles.value}>{(details as CollaboratorDetails).collaborators_phone}</span>
                </div>
              )}
              {(details as CollaboratorDetails).collaborators_bank_name && (
                <div style={styles.infoRow}>
                  <span style={styles.label}>Ngân Hàng:</span>
                  <span style={styles.value}>{(details as CollaboratorDetails).collaborators_bank_name}</span>
                </div>
              )}
              {(details as CollaboratorDetails).collaborators_rating !== undefined && (
                <div style={styles.infoRow}>
                  <span style={styles.label}>Đánh Giá:</span>
                  <span style={styles.valueHighlight}>
                    ⭐ {(details as CollaboratorDetails).collaborators_rating || 'Chưa có'}
                  </span>
                </div>
              )}
              <div style={styles.infoRow}>
                <span style={styles.label}>Trạng Thái:</span>
                <span
                  style={{
                    ...styles.statusBadge,
                    backgroundColor: (details as CollaboratorDetails).collaborators_verified ? '#10b981' : '#f59e0b',
                  }}
                >
                  {(details as CollaboratorDetails).collaborators_verified ? '✓ Đã Xác Thực' : '⏳ Chờ Xác Thực'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
    fontFamily: 'system-ui, sans-serif',
    padding: '24px',
  },
  content: {
    maxWidth: '800px',
    margin: '0 auto',
  },
  loadingContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '60vh',
  },
  loadingText: {
    fontSize: '18px',
    color: '#6b7280',
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '60vh',
    gap: '16px',
  },
  errorText: {
    fontSize: '18px',
    color: '#dc2626',
    textAlign: 'center',
  },
  retryButton: {
    padding: '10px 20px',
    backgroundColor: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '32px',
  },
  title: {
    fontSize: '32px',
    fontWeight: 700,
    color: '#111827',
  },
  backButton: {
    padding: '10px 20px',
    backgroundColor: 'white',
    color: '#374151',
    border: '2px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 500,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '32px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    marginBottom: '24px',
  },
  cardTitle: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#111827',
    marginBottom: '24px',
    paddingBottom: '12px',
    borderBottom: '2px solid #e5e7eb',
  },
  cardContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '12px',
  },
  label: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#6b7280',
  },
  value: {
    fontSize: '16px',
    color: '#111827',
    textAlign: 'right',
  },
  valueHighlight: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#2563eb',
  },
  roleBadge: {
    display: 'inline-block',
    padding: '6px 16px',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: 500,
    color: 'white',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '6px 16px',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: 500,
    color: 'white',
  },
};
