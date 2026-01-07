"use client";

import { useState, useEffect, useRef } from 'react';
import { publicApiFetch } from '../../../../lib/api';

interface OrganizationProfile {
  id: string;
  org_id: string;
  org_name: string;
  org_address?: string;
  org_phone?: string;
  org_email?: string;
  org_description?: string;
  org_avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export default function OrganizationProfilePage() {
  const [profile, setProfile] = useState<OrganizationProfile | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    org_name: '',
    org_address: '',
    org_phone: '',
    org_email: '',
    org_description: '',
    org_avatar_url: '',
  });

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      setIsLoading(true);
      const data = await publicApiFetch('/organization-profile');
      if (data) {
        setProfile(data);
        setFormData({
          org_name: data.org_name || '',
          org_address: data.org_address || '',
          org_phone: data.org_phone || '',
          org_email: data.org_email || '',
          org_description: data.org_description || '',
          org_avatar_url: data.org_avatar_url || '',
        });
        setIsEditing(false);
      } else {
        setIsEditing(true);
      }
    } catch (err: any) {
      console.error('Error fetching organization profile:', err);
      if (err.message.includes('not exist')) {
        setIsEditing(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setError(null);
    setSuccessMessage(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Image size should be less than 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setFormData(prev => ({ ...prev, org_avatar_url: base64String }));
      setError(null);
    };
    reader.onerror = () => {
      setError('Failed to read image file');
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await publicApiFetch('/organization-profile/upsert', {
        method: 'POST',
        body: JSON.stringify(formData),
      });

      setProfile(data);
      setSuccessMessage('✅ Organization profile saved successfully!');
      setIsEditing(false);
      setTimeout(() => fetchProfile(), 1000);
    } catch (err: any) {
      console.error('Error saving organization profile:', err);
      setError(err.message || 'Failed to save organization profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (profile) {
      setFormData({
        org_name: profile.org_name || '',
        org_address: profile.org_address || '',
        org_phone: profile.org_phone || '',
        org_email: profile.org_email || '',
        org_description: profile.org_description || '',
        org_avatar_url: profile.org_avatar_url || '',
      });
      setIsEditing(false);
    }
    setError(null);
    setSuccessMessage(null);
  };

  if (isLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading organization profile...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Organization Profile</h1>
        {!isEditing && profile && (
          <button onClick={() => setIsEditing(true)} style={styles.editButton}>
            ✏️ Edit
          </button>
        )}
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {successMessage && <div style={styles.success}>{successMessage}</div>}

      {profile && !isEditing ? (
        <div style={styles.viewMode}>
          <div style={styles.infoSection}>
            {profile.org_avatar_url && (
              <div style={styles.avatarContainer}>
                <img src={profile.org_avatar_url} alt="Organization Avatar" style={styles.avatarCircle} />
              </div>
            )}
            <div style={styles.infoRow}>
              <span style={styles.label}>Organization ID:</span>
              <span style={styles.value}>{profile.org_id}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.label}>Name:</span>
              <span style={styles.value}>{profile.org_name}</span>
            </div>
            {profile.org_address && (
              <div style={styles.infoRow}>
                <span style={styles.label}>Address:</span>
                <span style={styles.value}>{profile.org_address}</span>
              </div>
            )}
            {profile.org_phone && (
              <div style={styles.infoRow}>
                <span style={styles.label}>Phone:</span>
                <span style={styles.value}>{profile.org_phone}</span>
              </div>
            )}
            {profile.org_email && (
              <div style={styles.infoRow}>
                <span style={styles.label}>Email:</span>
                <span style={styles.value}>{profile.org_email}</span>
              </div>
            )}
            {profile.org_description && (
              <div style={styles.infoRow}>
                <span style={styles.label}>Description:</span>
                <span style={styles.value}>{profile.org_description}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Avatar Picture</label>
            <div style={styles.avatarUploadContainer}>
              {formData.org_avatar_url && (
                <img src={formData.org_avatar_url} alt="Avatar Preview" style={styles.avatarCirclePreview} />
              )}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} style={styles.fileInput} />
              <button type="button" onClick={() => fileInputRef.current?.click()} style={styles.uploadButton}>
                {formData.org_avatar_url ? '📷 Change Picture' : '📷 Upload Picture'}
              </button>
              <small style={styles.hint}>Upload an image (max 2MB)</small>
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.formLabel}>
              Organization Name <span style={styles.required}>*</span>
            </label>
            <input
              type="text"
              name="org_name"
              value={formData.org_name}
              onChange={handleChange}
              required
              style={styles.input}
              placeholder="Enter organization name"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Address</label>
            <input
              type="text"
              name="org_address"
              value={formData.org_address}
              onChange={handleChange}
              style={styles.input}
              placeholder="Enter address"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Phone</label>
            <input
              type="tel"
              name="org_phone"
              value={formData.org_phone}
              onChange={handleChange}
              style={styles.input}
              placeholder="Enter phone number"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Email</label>
            <input
              type="email"
              name="org_email"
              value={formData.org_email}
              onChange={handleChange}
              style={styles.input}
              placeholder="Enter email address"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Description</label>
            <textarea
              name="org_description"
              value={formData.org_description}
              onChange={handleChange}
              style={{ ...styles.input, ...styles.textarea }}
              placeholder="Enter organization description"
              rows={4}
            />
          </div>

          <div style={styles.buttonGroup}>
            <button type="submit" disabled={isSaving} style={styles.saveButton}>
              {isSaving ? 'Saving...' : '💾 Save'}
            </button>
            <button type="button" onClick={handleCancel} disabled={isSaving} style={styles.cancelButton}>
              ✖️ Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '24px',
    maxWidth: '800px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0,
  },
  loading: {
    textAlign: 'center',
    padding: '48px',
    color: '#6b7280',
    fontSize: '16px',
  },
  error: {
    backgroundColor: '#fee2e2',
    border: '1px solid #ef4444',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '20px',
    color: '#dc2626',
  },
  success: {
    backgroundColor: '#d1fae5',
    border: '1px solid #10b981',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '20px',
    color: '#059669',
  },
  viewMode: {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  infoSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  avatarContainer: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '16px',
  },
  avatarCircle: {
    width: '150px',
    height: '150px',
    borderRadius: '50%',
    objectFit: 'cover',
    border: '4px solid #e5e7eb',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  infoRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  label: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#6b7280',
  },
  value: {
    fontSize: '16px',
    color: '#1f2937',
  },
  form: {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  formGroup: {
    marginBottom: '20px',
  },
  formLabel: {
    display: 'block',
    marginBottom: '8px',
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
  },
  required: {
    color: '#ef4444',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  textarea: {
    resize: 'vertical' as const,
    fontFamily: 'inherit',
  },
  avatarUploadContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '12px',
    padding: '20px',
    border: '2px dashed #d1d5db',
    borderRadius: '8px',
    backgroundColor: '#f9fafb',
  },
  avatarCirclePreview: {
    width: '150px',
    height: '150px',
    borderRadius: '50%',
    objectFit: 'cover' as const,
    border: '4px solid #e5e7eb',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  fileInput: {
    display: 'none',
  },
  uploadButton: {
    padding: '10px 20px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  hint: {
    fontSize: '12px',
    color: '#6b7280',
  },
  buttonGroup: {
    display: 'flex',
    gap: '12px',
    marginTop: '24px',
  },
  editButton: {
    padding: '8px 16px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  saveButton: {
    padding: '10px 20px',
    backgroundColor: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: '#6b7280',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
};
