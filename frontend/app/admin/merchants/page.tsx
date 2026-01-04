"use client";

import { useState, useEffect } from 'react';

interface Merchant {
  merchant_system_id: string;
  merchant_code: string;
  merchant_name: string;
  merchant_email?: string;
  merchant_phone?: string;
  merchant_verified: boolean;
  merchants_status?: string;
  merchant_description?: string;
  owner_email: string;
  new_address_city?: string;
  new_address_ward?: string;
  new_address_line?: string;
  merchant_commission_type?: string;
  merchant_commission_value?: number;
  merchant_discount_type?: string;
  merchant_discount_value?: number;
  merchant_registered_date: string;
  merchant_last_update: string;
}

export default function MerchantsManagementPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [filteredMerchants, setFilteredMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'pending'>('all');
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetchMerchants();
  }, []);

  useEffect(() => {
    filterMerchants();
  }, [filter, merchants]);

  const fetchMerchants = async () => {
    try {
      setLoading(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/merchants`);

      if (!response.ok) {
        throw new Error('Failed to fetch merchants');
      }

      const data = await response.json();
      setMerchants(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load merchants');
    } finally {
      setLoading(false);
    }
  };

  const filterMerchants = () => {
    if (filter === 'all') {
      setFilteredMerchants(merchants);
    } else if (filter === 'active') {
      setFilteredMerchants(merchants.filter(m => m.merchant_verified === true));
    } else {
      setFilteredMerchants(merchants.filter(m => m.merchant_verified === false));
    }
  };

  const handleViewDetails = (merchant: Merchant) => {
    setSelectedMerchant(merchant);
    setShowModal(true);
  };

  const handleApprove = async (id: string) => {
    if (!confirm('Are you sure you want to approve this merchant?')) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/merchants/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_verified: true }),
      });

      if (!response.ok) throw new Error('Failed to approve merchant');

      alert('Merchant approved successfully!');
      fetchMerchants();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve merchant');
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Are you sure you want to deactivate this merchant?')) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/merchants/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_verified: false }),
      });

      if (!response.ok) throw new Error('Failed to deactivate merchant');

      alert('Merchant deactivated successfully!');
      fetchMerchants();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to deactivate merchant');
    }
  };

  if (loading) {
    return <div style={styles.loadingContainer}>Loading merchants...</div>;
  }

  if (error) {
    return (
      <div style={styles.errorContainer}>
        <p style={styles.errorText}>❌ {error}</p>
        <button onClick={fetchMerchants} style={styles.retryButton}>Retry</button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Merchants Management</h2>
        <div style={styles.filterButtons}>
          <button
            onClick={() => setFilter('all')}
            style={{
              ...styles.filterButton,
              backgroundColor: filter === 'all' ? '#3b82f6' : '#e5e7eb',
              color: filter === 'all' ? 'white' : '#374151',
            }}
          >
            All ({merchants.length})
          </button>
          <button
            onClick={() => setFilter('active')}
            style={{
              ...styles.filterButton,
              backgroundColor: filter === 'active' ? '#10b981' : '#e5e7eb',
              color: filter === 'active' ? 'white' : '#374151',
            }}
          >
            Active ({merchants.filter(m => m.merchant_verified).length})
          </button>
          <button
            onClick={() => setFilter('pending')}
            style={{
              ...styles.filterButton,
              backgroundColor: filter === 'pending' ? '#f59e0b' : '#e5e7eb',
              color: filter === 'pending' ? 'white' : '#374151',
            }}
          >
            Pending ({merchants.filter(m => !m.merchant_verified).length})
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
              <th style={styles.th}>City</th>
              <th style={styles.th}>Commission</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Registered</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredMerchants.map((merchant) => (
              <tr key={merchant.merchant_system_id} style={styles.tableRow}>
                <td style={styles.td}>{merchant.merchant_code}</td>
                <td style={styles.td}>{merchant.merchant_name}</td>
                <td style={styles.td}>{merchant.merchant_email || 'N/A'}</td>
                <td style={styles.td}>{merchant.merchant_phone || 'N/A'}</td>
                <td style={styles.td}>{merchant.new_address_city || 'N/A'}</td>
                <td style={styles.td}>
                  {merchant.merchant_commission_type && merchant.merchant_commission_value
                    ? `${merchant.merchant_commission_value}${merchant.merchant_commission_type === 'percentage' ? '%' : 'đ'}`
                    : 'N/A'}
                </td>
                <td style={styles.td}>
                  <span style={{
                    ...styles.statusBadge,
                    backgroundColor: 
                      merchant.merchants_status === 'active' ? '#d1fae5' : 
                      merchant.merchants_status === 'pending' ? '#fef3c7' :
                      merchant.merchants_status === 'inactive' ? '#e5e7eb' :
                      merchant.merchants_status === 'blocked' ? '#fee2e2' : '#e5e7eb',
                    color: 
                      merchant.merchants_status === 'active' ? '#065f46' : 
                      merchant.merchants_status === 'pending' ? '#92400e' :
                      merchant.merchants_status === 'inactive' ? '#374151' :
                      merchant.merchants_status === 'blocked' ? '#991b1b' : '#374151',
                  }}>
                    {merchant.merchants_status ? 
                      merchant.merchants_status.charAt(0).toUpperCase() + merchant.merchants_status.slice(1) : 
                      (merchant.merchant_verified ? 'Active' : 'Pending')
                    }
                  </span>
                </td>
                <td style={styles.td}>
                  {new Date(merchant.merchant_registered_date).toLocaleDateString()}
                </td>
                <td style={styles.td}>
                  <div style={styles.actionButtons}>
                    <button
                      onClick={() => handleViewDetails(merchant)}
                      style={styles.viewButton}
                    >
                      View
                    </button>
                    {!merchant.merchant_verified ? (
                      <button
                        onClick={() => handleApprove(merchant.merchant_system_id)}
                        style={styles.approveButton}
                      >
                        Approve
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDeactivate(merchant.merchant_system_id)}
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
      {showModal && selectedMerchant && (
        <div style={styles.modalOverlay} onClick={() => setShowModal(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Merchant Details</h3>
            <div style={styles.detailsGrid}>
              <div style={styles.detailItem}>
                <strong>Code:</strong> {selectedMerchant.merchant_code}
              </div>
              <div style={styles.detailItem}>
                <strong>Name:</strong> {selectedMerchant.merchant_name}
              </div>
              <div style={styles.detailItem}>
                <strong>Description:</strong> {selectedMerchant.merchant_description || 'N/A'}
              </div>
              <div style={styles.detailItem}>
                <strong>Owner Email:</strong> {selectedMerchant.owner_email}
              </div>
              <div style={styles.detailItem}>
                <strong>Merchant Email:</strong> {selectedMerchant.merchant_email || 'N/A'}
              </div>
              <div style={styles.detailItem}>
                <strong>Phone:</strong> {selectedMerchant.merchant_phone || 'N/A'}
              </div>
              <div style={styles.detailItem}>
                <strong>Address:</strong> {
                  [selectedMerchant.new_address_line, selectedMerchant.new_address_ward, selectedMerchant.new_address_city]
                    .filter(Boolean).join(', ') || 'N/A'
                }
              </div>
              <div style={styles.detailItem}>
                <strong>Commission:</strong> {
                  selectedMerchant.merchant_commission_type && selectedMerchant.merchant_commission_value
                    ? `${selectedMerchant.merchant_commission_value}${selectedMerchant.merchant_commission_type === 'percentage' ? '%' : 'đ'} (${selectedMerchant.merchant_commission_type})`
                    : 'N/A'
                }
              </div>
              <div style={styles.detailItem}>
                <strong>Discount:</strong> {
                  selectedMerchant.merchant_discount_type && selectedMerchant.merchant_discount_value
                    ? `${selectedMerchant.merchant_discount_value}${selectedMerchant.merchant_discount_type === 'percentage' ? '%' : 'đ'} (${selectedMerchant.merchant_discount_type})`
                    : 'N/A'
                }
              </div>
              <div style={styles.detailItem}>
                <strong>Status:</strong> {selectedMerchant.merchant_verified ? 'Active' : 'Pending'}
              </div>
              <div style={styles.detailItem}>
                <strong>Registered:</strong> {new Date(selectedMerchant.merchant_registered_date).toLocaleString()}
              </div>
              <div style={styles.detailItem}>
                <strong>Last Updated:</strong> {new Date(selectedMerchant.merchant_last_update).toLocaleString()}
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
