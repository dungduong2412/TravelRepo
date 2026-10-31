"use client";

import { useState, useEffect } from 'react';
import { api } from '../../../lib/api';

interface DashboardStats {
  activeCollaborators: number;
  pendingCollaborators: number;
  activeMerchants: number;
  pendingMerchants: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    activeCollaborators: 0,
    pendingCollaborators: 0,
    activeMerchants: 0,
    pendingMerchants: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const [collaborators, merchants] = await Promise.all([
        api.get('/collaborators'),
        api.get('/merchants'),
      ]);

      const collaboratorStatus = (item: any) =>
        item.collaborators_status?.toLowerCase() ||
        (item.collaborators_verified ? 'active' : 'pending');
      const merchantStatus = (item: any) =>
        item.merchants_status?.toLowerCase() ||
        (item.merchant_verified ? 'active' : 'pending');

      // Calculate statistics
      setStats({
        activeCollaborators: collaborators.filter((c: any) => collaboratorStatus(c) === 'active').length,
        pendingCollaborators: collaborators.filter((c: any) => collaboratorStatus(c) === 'pending').length,
        activeMerchants: merchants.filter((m: any) => merchantStatus(m) === 'active').length,
        pendingMerchants: merchants.filter((m: any) => merchantStatus(m) === 'pending').length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.errorContainer}>
        <p style={styles.errorText}>❌ {error}</p>
        <button onClick={fetchStats} style={styles.retryButton}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Dashboard Overview</h2>

      <div style={styles.statsGrid}>
        {/* Collaborators Stats */}
        <div style={styles.statCard}>
          <div style={styles.statIcon}>👥</div>
          <div style={styles.statContent}>
            <h3 style={styles.statLabel}>Active Partners</h3>
            <p style={styles.statValue}>{stats.activeCollaborators}</p>
          </div>
        </div>

        <div style={styles.statCard}>
          <div style={{ ...styles.statIcon, backgroundColor: '#fef3c7' }}>⏳</div>
          <div style={styles.statContent}>
            <h3 style={styles.statLabel}>Pending Partners</h3>
            <p style={styles.statValue}>{stats.pendingCollaborators}</p>
          </div>
        </div>

        {/* Merchants Stats */}
        <div style={styles.statCard}>
          <div style={{ ...styles.statIcon, backgroundColor: '#d1fae5' }}>🏪</div>
          <div style={styles.statContent}>
            <h3 style={styles.statLabel}>Active Merchants</h3>
            <p style={styles.statValue}>{stats.activeMerchants}</p>
          </div>
        </div>

        <div style={styles.statCard}>
          <div style={{ ...styles.statIcon, backgroundColor: '#fecaca' }}>⏳</div>
          <div style={styles.statContent}>
            <h3 style={styles.statLabel}>Pending Merchants</h3>
            <p style={styles.statValue}>{stats.pendingMerchants}</p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={styles.quickActions}>
        <h3 style={styles.sectionTitle}>Quick Actions</h3>
        <div style={styles.actionButtons}>
          <button 
            style={styles.actionButton}
            onClick={() => window.location.href = '/admin/collaborators'}
          >
            Manage Partners
          </button>
          <button 
            style={styles.actionButton}
            onClick={() => window.location.href = '/admin/merchants'}
          >
            Manage Merchants
          </button>
          <button 
            style={styles.actionButton}
            onClick={() => window.location.href = '/admin/master-data/categories'}
          >
            Manage Categories
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1200px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 600,
    marginBottom: '30px',
    color: '#111827',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
    marginBottom: '40px',
  },
  statCard: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },
  statIcon: {
    fontSize: '32px',
    backgroundColor: '#dbeafe',
    padding: '15px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statContent: {
    flex: 1,
  },
  statLabel: {
    fontSize: '14px',
    color: '#6b7280',
    margin: '0 0 8px 0',
    fontWeight: 500,
  },
  statValue: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#111827',
    margin: 0,
  },
  quickActions: {
    backgroundColor: 'white',
    padding: '25px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 600,
    marginBottom: '15px',
    color: '#111827',
  },
  actionButtons: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  actionButton: {
    padding: '10px 20px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    transition: 'background-color 0.2s',
  },
  loadingContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '300px',
  },
  spinner: {
    fontSize: '18px',
    color: '#6b7280',
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '15px',
    padding: '40px',
  },
  errorText: {
    color: '#dc2626',
    fontSize: '16px',
  },
  retryButton: {
    padding: '10px 20px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};
