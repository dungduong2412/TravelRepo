"use client";

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';

type Role = 'admin' | 'merchant' | 'collaborator';
type Status = 'active' | 'pending' | 'inactive' | 'blocked';
type UserProfile = {
  id: string; email: string; full_name?: string | null; role: Role;
  user_profiles_status: Status; merchant_id: string | null; collaborator_id: string | null;
  last_login_at?: string | null; login_count?: number;
};
type Option = { id: string; label: string };

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [merchants, setMerchants] = useState<Option[]>([]);
  const [collaborators, setCollaborators] = useState<Option[]>([]);
  const [filter, setFilter] = useState<'all' | Role>('all');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [profiles, merchantRows, collaboratorRows] = await Promise.all([
        api.get('/user-profiles'), api.get('/merchants'), api.get('/collaborators'),
      ]);
      setUsers((profiles || []).map((row: any) => ({ ...row, user_profiles_status: row.user_profiles_status || 'pending', merchant_id: row.merchant_id || null, collaborator_id: row.collaborator_id || null })));
      setMerchants((merchantRows || []).map((row: any) => ({ id: row.merchant_system_id, label: `${row.merchant_code || '—'} · ${row.merchant_name || row.merchant_system_id}` })));
      setCollaborators((collaboratorRows || []).map((row: any) => ({ id: row.id, label: `${row.collaborators_code || '—'} · ${row.collaborators_name || row.id}` })));
    } catch (err: any) { setError(err.message || 'Unable to load user management data'); }
  };

  useEffect(() => { void load(); }, []);
  const visible = useMemo(() => filter === 'all' ? users : users.filter((user) => user.role === filter), [filter, users]);
  const update = (id: string, patch: Partial<UserProfile>) => setUsers((current) => current.map((user) => user.id === id ? normalize({ ...user, ...patch }) : user));

  const save = async (user: UserProfile) => {
    setSaving(user.id); setError(null);
    try {
      await api.patch(`/user-profiles/${user.id}`, { role: user.role, user_profiles_status: user.user_profiles_status, merchant_id: user.merchant_id, collaborator_id: user.collaborator_id });
      await load();
    } catch (err: any) { setError(err.message || 'Unable to update user'); }
    finally { setSaving(null); }
  };

  return <div>
    <div style={styles.header}>
      <div><h2 style={styles.title}>User and Access Management</h2><p style={styles.help}>Role, activation state, and business assignments are enforced together and audited.</p></div>
      <div style={styles.filters}>{(['all', 'admin', 'merchant', 'collaborator'] as const).map((value) => <button key={value} onClick={() => setFilter(value)} style={{ ...styles.filter, ...(filter === value ? styles.active : {}) }}>{value === 'collaborator' ? 'partner' : value}</button>)}</div>
    </div>
    {error && <div style={styles.error}>{error}</div>}
    <div style={styles.wrapper}><table style={styles.table}>
      <thead><tr><th style={styles.th}>User</th><th style={styles.th}>Role</th><th style={styles.th}>Status</th><th style={styles.th}>Business assignment</th><th style={styles.th}>Login activity</th><th style={styles.th}>Action</th></tr></thead>
      <tbody>{visible.map((user) => <tr key={user.id} style={styles.row}>
        <td style={styles.td}><strong>{user.full_name || '—'}</strong><div>{user.email}</div></td>
        <td style={styles.td}><select value={user.role} onChange={(e) => update(user.id, { role: e.target.value as Role })} style={styles.select}><option value="admin">Admin</option><option value="merchant">Merchant</option><option value="collaborator">Partner</option></select></td>
        <td style={styles.td}><select value={user.user_profiles_status} onChange={(e) => update(user.id, { user_profiles_status: e.target.value as Status })} style={styles.select}><option value="active">Active</option><option value="pending">Pending</option><option value="inactive">Inactive</option><option value="blocked">Blocked</option></select></td>
        <td style={styles.td}>{user.role === 'merchant' ? <select value={user.merchant_id || ''} onChange={(e) => update(user.id, { merchant_id: e.target.value || null })} style={styles.select}><option value="">Select merchant</option>{merchants.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : user.role === 'collaborator' ? <select value={user.collaborator_id || ''} onChange={(e) => update(user.id, { collaborator_id: e.target.value || null })} style={styles.select}><option value="">Select partner</option>{collaborators.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : 'Platform-wide'}</td>
        <td style={styles.td}>{user.login_count || 0} logins<br />{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : 'Never'}</td>
        <td style={styles.td}><button disabled={saving === user.id || (user.role === 'merchant' && !user.merchant_id) || (user.role === 'collaborator' && !user.collaborator_id)} onClick={() => save(user)} style={styles.save}>{saving === user.id ? 'Saving…' : 'Save'}</button></td>
      </tr>)}</tbody>
    </table></div>
  </div>;
}

function normalize(user: UserProfile): UserProfile {
  if (user.role === 'admin') return { ...user, merchant_id: null, collaborator_id: null };
  if (user.role === 'merchant') return { ...user, collaborator_id: null };
  return { ...user, merchant_id: null };
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }, title: { margin: 0, fontSize: 24 }, help: { color: '#64748b', margin: '6px 0 0' },
  filters: { display: 'flex', gap: 8 }, filter: { border: 0, borderRadius: 999, padding: '8px 13px', cursor: 'pointer' }, active: { background: '#2563eb', color: 'white' }, error: { background: '#fef2f2', color: '#b91c1c', padding: 12, borderRadius: 8, marginBottom: 12 },
  wrapper: { overflow: 'auto', background: 'white', borderRadius: 10 }, table: { width: '100%', borderCollapse: 'collapse' }, th: { textAlign: 'left', padding: 12, background: '#f8fafc', whiteSpace: 'nowrap' }, row: { borderTop: '1px solid #e2e8f0' }, td: { padding: 12, minWidth: 140, verticalAlign: 'top' }, select: { width: '100%', minWidth: 150, padding: 8, border: '1px solid #cbd5e1', borderRadius: 6 }, save: { border: 0, borderRadius: 6, background: '#0f766e', color: 'white', padding: '8px 14px', cursor: 'pointer' },
};
