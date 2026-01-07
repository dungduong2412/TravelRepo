"use client";

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const menuItems = [
    { name: 'Dashboard', path: '/admin/dashboard', icon: '📊' },
    { name: 'Collaborators', path: '/admin/collaborators', icon: '👥' },
    { name: 'Merchants', path: '/admin/merchants', icon: '🏪' },
    { name: 'User Management', path: '/admin/users', icon: '👤' },
    { name: 'Master Data', path: '/admin/master-data', icon: '📋', 
      subItems: [
        { name: 'Organization', path: '/admin/master-data/organization' },
        { name: 'Categories', path: '/admin/master-data/categories' }
      ]
    },
  ];

  return (
    <div style={styles.container}>
      {/* Sidebar */}
      <aside style={{
        ...styles.sidebar,
        width: isSidebarOpen ? '250px' : '60px',
      }}>
        <div style={styles.sidebarHeader}>
          <h2 style={{
            ...styles.logo,
            display: isSidebarOpen ? 'block' : 'none',
          }}>
            Admin Panel
          </h2>
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            style={styles.toggleButton}
          >
            {isSidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        <nav style={styles.nav}>
          {menuItems.map((item) => (
            <div key={item.path}>
              <Link
                href={item.path}
                style={{
                  ...styles.menuItem,
                  backgroundColor: pathname === item.path ? '#3b82f6' : 'transparent',
                  justifyContent: isSidebarOpen ? 'flex-start' : 'center',
                }}
              >
                <span style={styles.icon}>{item.icon}</span>
                {isSidebarOpen && <span>{item.name}</span>}
              </Link>
              
              {/* Submenu items */}
              {item.subItems && isSidebarOpen && (
                <div style={styles.subMenu}>
                  {item.subItems.map((subItem) => (
                    <Link
                      key={subItem.path}
                      href={subItem.path}
                      style={{
                        ...styles.subMenuItem,
                        backgroundColor: pathname === subItem.path ? '#2563eb' : 'transparent',
                      }}
                    >
                      {subItem.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.pageTitle}>
            {menuItems.find(item => item.path === pathname)?.name || 'Admin'}
          </h1>
          <div style={styles.userInfo}>
            <span>Admin User</span>
            <button style={styles.logoutButton}>Logout</button>
          </div>
        </header>

        <div style={styles.content}>
          {children}
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    height: '100vh',
    backgroundColor: '#f3f4f6',
  },
  sidebar: {
    backgroundColor: '#1f2937',
    color: 'white',
    transition: 'width 0.3s ease',
    overflowX: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  sidebarHeader: {
    padding: '20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #374151',
  },
  logo: {
    fontSize: '20px',
    fontWeight: 'bold',
    margin: 0,
  },
  toggleButton: {
    background: 'transparent',
    border: 'none',
    color: 'white',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '5px',
  },
  nav: {
    flex: 1,
    padding: '20px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 20px',
    color: 'white',
    textDecoration: 'none',
    transition: 'background-color 0.2s',
    cursor: 'pointer',
    borderRadius: '0',
  },
  icon: {
    fontSize: '20px',
  },
  subMenu: {
    display: 'flex',
    flexDirection: 'column',
    marginLeft: '20px',
  },
  subMenuItem: {
    display: 'block',
    padding: '8px 20px',
    color: '#d1d5db',
    textDecoration: 'none',
    fontSize: '14px',
    transition: 'background-color 0.2s',
    borderRadius: '4px',
    margin: '2px 10px',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    backgroundColor: 'white',
    padding: '20px 30px',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pageTitle: {
    fontSize: '24px',
    fontWeight: 600,
    margin: 0,
    color: '#111827',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },
  logoutButton: {
    padding: '8px 16px',
    backgroundColor: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  content: {
    flex: 1,
    padding: '30px',
    overflow: 'auto',
  },
};
