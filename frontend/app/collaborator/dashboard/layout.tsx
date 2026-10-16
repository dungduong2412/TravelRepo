"use client";

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { api } from '../../../lib/api';

export default function CollaboratorDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }: any) => {
      if (!user) {
        router.push('/login');
      } else {
        const profile = await api.get('/user-profiles/me').catch(() => null);
        if (!profile || profile.user_profiles_status !== 'active') {
          router.replace('/login');
        } else if (profile.role === 'merchant') {
          router.replace('/merchant/dashboard/profile');
        } else if (profile.role === 'admin') {
          router.replace('/admin/dashboard');
        } else if (profile.role === 'collaborator' && profile.collaborator_id) {
          setUser(user);
        } else {
          router.replace('/login');
        }
      }
    });
  }, [router]);

  const menuItems = [
    { label: 'Hồ Sơ', path: '/collaborator/dashboard/profile', icon: '👤' },
    { label: 'Mã QR', path: '/collaborator/dashboard/qr-code', icon: '📱' },
    { label: 'Người Theo Dõi', path: '/collaborator/dashboard/members', icon: '👥' },
    { label: 'Giao Dịch & Hoa Hồng', path: '/collaborator/dashboard/reports', icon: '📊' },
  ];

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('user');
    localStorage.removeItem('userRole');
    localStorage.removeItem('collaborator');
    router.push('/login');
  };

  if (!user) {
    return <div style={styles.loading}>Đang tải...</div>;
  }

  return (
    <div style={styles.container}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <h2 style={styles.logo}>VN01</h2>
          <p style={styles.userRole}>Cộng Tác Viên</p>
          <p style={styles.userEmail}>{user.email}</p>
        </div>

        <nav style={styles.nav}>
          {menuItems.map((item) => {
            const isActive = pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => router.push(item.path)}
                style={{
                  ...styles.navItem,
                  ...(isActive ? styles.navItemActive : {}),
                }}
              >
                <span style={styles.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <button onClick={handleLogout} style={styles.logoutButton}>
          🚪 Đăng Xuất
        </button>
      </aside>

      {/* Main Content */}
      <main style={styles.main}>{children}</main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    minHeight: '100vh',
    fontFamily: 'system-ui, sans-serif',
    backgroundColor: '#f9fafb',
  },
  sidebar: {
    width: '280px',
    backgroundColor: 'white',
    borderRight: '1px solid #e5e7eb',
    display: 'flex',
    flexDirection: 'column',
    position: 'fixed',
    height: '100vh',
    overflow: 'auto',
  },
  sidebarHeader: {
    padding: '24px',
    borderBottom: '1px solid #e5e7eb',
  },
  logo: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#FF385C',
    margin: '0 0 8px 0',
  },
  userRole: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#111827',
    margin: '4px 0',
  },
  userEmail: {
    fontSize: '12px',
    color: '#6b7280',
    margin: '4px 0',
  },
  nav: {
    flex: 1,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'left',
  },
  navItemActive: {
    backgroundColor: '#fef2f2',
    color: '#FF385C',
    borderLeft: '3px solid #FF385C',
  },
  navIcon: {
    fontSize: '18px',
  },
  logoutButton: {
    margin: '16px',
    padding: '12px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#dc2626',
    backgroundColor: 'transparent',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  main: {
    flex: 1,
    marginLeft: '280px',
    padding: '32px',
    minHeight: '100vh',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    fontSize: '18px',
    color: '#6b7280',
  },
};
