"use client";

import { useState, useEffect } from 'react';

interface UserProfile {
  id: string;
  email: string;
  role: 'admin' | 'merchant' | 'collaborator';
  merchant_id?: string | null;
  collaborator_id?: string | null;
  user_profiles_status?: string;
  status: 'active' | 'inactive';
  last_login_at?: string | null;
  login_count?: number;
  created_at?: string;
  updated_at?: string;
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'admin' | 'merchant' | 'collaborator'>('all');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/user-profiles`);

      if (!response.ok) {
        throw new Error('Failed to fetch user profiles');
      }

      const data = await response.json();
      
      // Determine status based on user_profiles_status column or fallback
      const processedUsers = data.map((user: any) => ({
        ...user,
        status: user.user_profiles_status || 'active',
      }));
      
      setUsers(processedUsers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = filter === 'all' 
    ? users 
    : users.filter(u => u.role === filter);

  if (loading) {
    return <div style={styles.loadingContainer}>Loading user profiles...</div>;
  }

  if (error) {
    return (
      <div style={styles.errorContainer}>
        <p style={styles.errorText}>❌ {error}</p>
        <button onClick={fetchUsers} style={styles.retryButton}>Retry</button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>User Management</h2>
        <div style={styles.filterButtons}>
          <button
            onClick={() => setFilter('all')}
            style={{
              ...styles.filterButton,
              backgroundColor: filter === 'all' ? '#3b82f6' : '#e5e7eb',
              color: filter === 'all' ? 'white' : '#374151',
            }}
          >
            All ({users.length})
          </button>
          <button
            onClick={() => setFilter('admin')}
            style={{
              ...styles.filterButton,
              backgroundColor: filter === 'admin' ? '#8b5cf6' : '#e5e7eb',
              color: filter === 'admin' ? 'white' : '#374151',
            }}
          >
            Admin ({users.filter(u => u.role === 'admin').length})
          </button>
          <button
            onClick={() => setFilter('merchant')}
            style={{
              ...styles.filterButton,
              backgroundColor: filter === 'merchant' ? '#10b981' : '#e5e7eb',
              color: filter === 'merchant' ? 'white' : '#374151',
            }}
          >
            Merchants ({users.filter(u => u.role === 'merchant').length})
          </button>
          <button
            onClick={() => setFilter('collaborator')}
            style={{
              ...styles.filterButton,
              backgroundColor: filter === 'collaborator' ? '#f59e0b' : '#e5e7eb',
              color: filter === 'collaborator' ? 'white' : '#374151',
            }}
          >
            Collaborators ({users.filter(u => u.role === 'collaborator').length})
          </button>
        </div>
      </div>

      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.tableHeader}>
              <th style={styles.th}>Email</th>
              <th style={styles.th}>Role</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Login Count</th>
              <th style={styles.th}>Last Login</th>
              <th style={styles.th}>Created</th>
              <th style={styles.th}>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user) => (
              <tr key={user.id} style={styles.tableRow}>
                <td style={styles.td}>{user.email}</td>
                <td style={styles.td}>
                  <span style={{
                    ...styles.roleBadge,
                    backgroundColor: 
                      user.role === 'admin' ? '#ede9fe' :
                      user.role === 'merchant' ? '#d1fae5' : '#fef3c7',
                    color:
                      user.role === 'admin' ? '#6b21a8' :
                      user.role === 'merchant' ? '#065f46' : '#92400e',
                  }}>
                    {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                  </span>
                </td>
                <td style={styles.td}>
                  <span style={{
                    ...styles.statusBadge,
                    backgroundColor: 
                      user.status === 'active' ? '#d1fae5' :
                      user.status === 'inactive' ? '#e5e7eb' :
                      user.status === 'suspended' ? '#fee2e2' : '#e5e7eb',
                    color: 
                      user.status === 'active' ? '#065f46' :
                      user.status === 'inactive' ? '#374151' :
                      user.status === 'suspended' ? '#991b1b' : '#374151',
                  }}>
                    {user.status.charAt(0).toUpperCase() + user.status.slice(1)}
                  </span>
                </td>
                <td style={styles.td}>{user.login_count || 0}</td>
                <td style={styles.td}>
                  {user.last_login_at 
                    ? new Date(user.last_login_at).toLocaleString()
                    : 'Never'}
                </td>
                <td style={styles.td}>
                  {user.created_at
                    ? new Date(user.created_at).toLocaleDateString()
                    : 'N/A'}
                </td>
                <td style={styles.td}>
                  {user.updated_at
                    ? new Date(user.updated_at).toLocaleDateString()
                    : 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredUsers.length === 0 && (
          <div style={styles.emptyState}>
            <p>No users found for this filter</p>
          </div>
        )}
      </div>

      <div style={styles.summary}>
        <div style={styles.summaryItem}>
          <strong>Total Users:</strong> {users.length}
        </div>
        <div style={styles.summaryItem}>
          <strong>Active:</strong> {users.filter(u => u.status === 'active').length}
        </div>
        <div style={styles.summaryItem}>
          <strong>Total Logins:</strong> {users.reduce((sum, u) => sum + (u.login_count || 0), 0)}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1400px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '25px',
    flexWrap: 'wrap',
    gap: '15px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 600,
    margin: 0,
    color: '#111827',
  },
  filterButtons: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  filterButton: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    transition: 'all 0.2s',
  },
  tableContainer: {
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    overflow: 'auto',
    marginBottom: '20px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  tableHeader: {
    backgroundColor: '#f9fafb',
  },
  th: {
    padding: '12px 16px',
    textAlign: 'left',
    fontSize: '14px',
    fontWeight: 600,
    color: '#374151',
    borderBottom: '1px solid #e5e7eb',
    whiteSpace: 'nowrap',
  },
  tableRow: {
    borderBottom: '1px solid #e5e7eb',
  },
  td: {
    padding: '12px 16px',
    fontSize: '14px',
    color: '#111827',
  },
  roleBadge: {
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500,
    display: 'inline-block',
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500,
    display: 'inline-block',
  },
  loadingContainer: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '16px',
    color: '#6b7280',
  },
  errorContainer: {
    textAlign: 'center',
    padding: '40px',
  },
  errorText: {
    color: '#dc2626',
    fontSize: '16px',
    marginBottom: '15px',
  },
  retryButton: {
    padding: '10px 20px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
    color: '#6b7280',
  },
  summary: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    display: 'flex',
    gap: '30px',
    flexWrap: 'wrap',
  },
  summaryItem: {
    fontSize: '14px',
    color: '#374151',
  },
};
