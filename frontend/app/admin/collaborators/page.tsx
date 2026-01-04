"use client";

import { useState, useEffect } from 'react';

interface Collaborator {
  id: string;
  collaborators_code: string;
  collaborators_name: string;
  collaborators_email: string;
  collaborators_phone: string;
  collaborators_verified: boolean;
  collaborators_status?: string;
  collaborators_bank_name?: string;
  collaborators_bank_acc_number?: string;
  collaborators_qr_code?: string;
  collaborators_rating?: number;
  created_at: string;
  updated_at: string;
}

export default function CollaboratorsManagementPage() {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [filteredCollaborators, setFilteredCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'pending'>('all');
  const [selectedCollaborator, setSelectedCollaborator] = useState<Collaborator | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetchCollaborators();
  }, []);

  useEffect(() => {
    filterCollaborators();
  }, [filter, collaborators]);

  const fetchCollaborators = async () => {
    try {
      setLoading(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/collaborators`);

      if (!response.ok) {
        throw new Error('Failed to fetch collaborators');
      }

      const data = await response.json();
      setCollaborators(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load collaborators');
    } finally {
      setLoading(false);
    }
  };

  const filterCollaborators = () => {
    if (filter === 'all') {
      setFilteredCollaborators(collaborators);
    } else if (filter === 'active') {
      setFilteredCollaborators(collaborators.filter(c => c.collaborators_verified === true));
    } else {
      setFilteredCollaborators(collaborators.filter(c => c.collaborators_verified === false));
    }
  };

  const handleViewDetails = (collaborator: Collaborator) => {
    setSelectedCollaborator(collaborator);
    setShowModal(true);
  };

  const handleApprove = async (id: string) => {
    if (!confirm('Are you sure you want to approve this collaborator?')) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/collaborators/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collaborators_verified: true }),
      });

      if (!response.ok) throw new Error('Failed to approve collaborator');

      alert('Collaborator approved successfully!');
      fetchCollaborators();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve collaborator');
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Are you sure you want to deactivate this collaborator?')) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/collaborators/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collaborators_verified: false }),
      });

      if (!response.ok) throw new Error('Failed to deactivate collaborator');

      alert('Collaborator deactivated successfully!');
      fetchCollaborators();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to deactivate collaborator');
    }
  };

  if (loading) {
    return <div style={styles.loadingContainer}>Loading collaborators...</div>;
  }

  if (error) {
    return (
      <div style={styles.errorContainer}>
        <p style={styles.errorText}>❌ {error}</p>
        <button onClick={fetchCollaborators} style={styles.retryButton}>Retry</button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Collaborators Management</h2>
        <div style={styles.filterButtons}>
          <button
            onClick={() => setFilter('all')}
            style={{
              ...styles.filterButton,
              backgroundColor: filter === 'all' ? '#3b82f6' : '#e5e7eb',
              color: filter === 'all' ? 'white' : '#374151',
            }}
          >
            All ({collaborators.length})
          </button>
          <button
            onClick={() => setFilter('active')}
            style={{
              ...styles.filterButton,
              backgroundColor: filter === 'active' ? '#10b981' : '#e5e7eb',
              color: filter === 'active' ? 'white' : '#374151',
            }}
          >
            Active ({collaborators.filter(c => c.collaborators_verified).length})
          </button>
          <button
            onClick={() => setFilter('pending')}
            style={{
              ...styles.filterButton,
              backgroundColor: filter === 'pending' ? '#f59e0b' : '#e5e7eb',
              color: filter === 'pending' ? 'white' : '#374151',
            }}
          >
            Pending ({collaborators.filter(c => !c.collaborators_verified).length})
          </button>
        </div>
      </div>

      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.tableHeader}>
              <th style={styles.th}>Code</th>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Email</th>
              <th style={styles.th}>Phone</th>
              <th style={styles.th}>Bank</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Created</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCollaborators.map((collaborator) => (
              <tr key={collaborator.id} style={styles.tableRow}>
                <td style={styles.td}>{collaborator.collaborators_code}</td>
                <td style={styles.td}>{collaborator.collaborators_name}</td>
                <td style={styles.td}>{collaborator.collaborators_email}</td>
                <td style={styles.td}>{collaborator.collaborators_phone}</td>
                <td style={styles.td}>{collaborator.collaborators_bank_name || 'N/A'}</td>
                <td style={styles.td}>
                  <span style={{
                    ...styles.statusBadge,
                    backgroundColor: 
                      collaborator.collaborators_status === 'active' ? '#d1fae5' : 
                      collaborator.collaborators_status === 'pending' ? '#fef3c7' :
                      collaborator.collaborators_status === 'inactive' ? '#e5e7eb' :
                      collaborator.collaborators_status === 'blocked' ? '#fee2e2' : '#e5e7eb',
                    color: 
                      collaborator.collaborators_status === 'active' ? '#065f46' : 
                      collaborator.collaborators_status === 'pending' ? '#92400e' :
                      collaborator.collaborators_status === 'inactive' ? '#374151' :
                      collaborator.collaborators_status === 'blocked' ? '#991b1b' : '#374151',
                  }}>
                    {collaborator.collaborators_status ? 
                      collaborator.collaborators_status.charAt(0).toUpperCase() + collaborator.collaborators_status.slice(1) : 
                      (collaborator.collaborators_verified ? 'Active' : 'Pending')
                    }
                  </span>
                </td>
                <td style={styles.td}>
                  {new Date(collaborator.created_at).toLocaleDateString()}
                </td>
                <td style={styles.td}>
                  <div style={styles.actionButtons}>
                    <button
                      onClick={() => handleViewDetails(collaborator)}
                      style={styles.viewButton}
                    >
                      View
                    </button>
                    {!collaborator.collaborators_verified ? (
                      <button
                        onClick={() => handleApprove(collaborator.id)}
                        style={styles.approveButton}
                      >
                        Approve
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDeactivate(collaborator.id)}
                        style={styles.deactivateButton}
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Details Modal */}
      {showModal && selectedCollaborator && (
        <div style={styles.modalOverlay} onClick={() => setShowModal(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Collaborator Details</h3>
            <div style={styles.detailsGrid}>
              <div style={styles.detailItem}>
                <strong>Code:</strong> {selectedCollaborator.collaborators_code}
              </div>
              <div style={styles.detailItem}>
                <strong>Name:</strong> {selectedCollaborator.collaborators_name}
              </div>
              <div style={styles.detailItem}>
                <strong>Email:</strong> {selectedCollaborator.collaborators_email}
              </div>
              <div style={styles.detailItem}>
                <strong>Phone:</strong> {selectedCollaborator.collaborators_phone}
              </div>
              <div style={styles.detailItem}>
                <strong>Bank Name:</strong> {selectedCollaborator.collaborators_bank_name || 'N/A'}
              </div>
              <div style={styles.detailItem}>
                <strong>Bank Account:</strong> {selectedCollaborator.collaborators_bank_acc_number || 'N/A'}
              </div>
              <div style={styles.detailItem}>
                <strong>QR Code:</strong> {selectedCollaborator.collaborators_qr_code || 'N/A'}
              </div>
              <div style={styles.detailItem}>
                <strong>Status:</strong> {selectedCollaborator.collaborators_verified ? 'Active' : 'Pending'}
              </div>
              <div style={styles.detailItem}>
                <strong>Created:</strong> {new Date(selectedCollaborator.created_at).toLocaleString()}
              </div>
              <div style={styles.detailItem}>
                <strong>Updated:</strong> {new Date(selectedCollaborator.updated_at).toLocaleString()}
              </div>
            </div>
            <button onClick={() => setShowModal(false)} style={styles.closeButton}>
              Close
            </button>
          </div>
        </div>
      )}
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
  },
  tableRow: {
    borderBottom: '1px solid #e5e7eb',
  },
  td: {
    padding: '12px 16px',
    fontSize: '14px',
    color: '#111827',
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 500,
    display: 'inline-block',
  },
  actionButtons: {
    display: 'flex',
    gap: '8px',
  },
  viewButton: {
    padding: '6px 12px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
  },
  approveButton: {
    padding: '6px 12px',
    backgroundColor: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
  },
  deactivateButton: {
    padding: '6px 12px',
    backgroundColor: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
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
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: 'white',
    padding: '30px',
    borderRadius: '8px',
    maxWidth: '600px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'auto',
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: 600,
    marginBottom: '20px',
    color: '#111827',
  },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '12px',
    marginBottom: '20px',
  },
  detailItem: {
    padding: '10px',
    backgroundColor: '#f9fafb',
    borderRadius: '4px',
    fontSize: '14px',
  },
  closeButton: {
    padding: '10px 20px',
    backgroundColor: '#6b7280',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    width: '100%',
  },
};
