'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { CheckCircle, User, Mail, Phone, Calendar, QrCode } from 'lucide-react';

interface Collaborator {
  id: string;
  collaborators_code: string;
  collaborators_name: string;
  collaborators_email: string;
  collaborators_phone: string;
  collaborators_verified: boolean;
  collaborators_status?: string;
  collaborators_registered_date: string;
  collaborators_qr_code?: string;
}

function formatCollaboratorDate(value?: string | null, includeTime = false) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return '—';

  return includeTime ? date.toLocaleString() : date.toLocaleDateString();
}

function getCollaboratorStatus(item: Collaborator) {
  if (item.collaborators_status) {
    return item.collaborators_status.toLowerCase();
  }
  return item.collaborators_verified ? 'active' : 'pending';
}

export default function AdminCollaboratorsPage() {
  const [allItems, setAllItems] = useState<Collaborator[]>([]);
  const [pendingItems, setPendingItems] = useState<Collaborator[]>([]);
  const [verifiedItems, setVerifiedItems] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedQr, setSelectedQr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Collaborator | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'active'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ collaborators_name: '', collaborators_email: '', collaborators_phone: '' });

  const fetchCollaborators = useCallback(async () => {
    try {
      setError(null);
      const all = await api.get('/collaborators');
      const normalized = (all || []) as Collaborator[];

      const pending = normalized.filter((c: Collaborator) => getCollaboratorStatus(c) === 'pending');
      const verified = normalized.filter((c: Collaborator) => getCollaboratorStatus(c) === 'active');

      setAllItems(normalized);
      setPendingItems(pending);
      setVerifiedItems(verified);
    } catch (e: any) {
      setError(e.message || 'Unable to load collaborators');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCollaborators();
  }, [fetchCollaborators]);

  const visibleItems =
    statusFilter === 'pending'
      ? pendingItems
      : statusFilter === 'active'
        ? verifiedItems
        : allItems;

  async function handleApprove(id: string) {
    if (!confirm('Approve this collaborator? A QR code will be generated.')) return;
    
    try {
      await api.post(`/collaborators/${id}/approve`);
      alert('Collaborator approved and QR code generated!');
      fetchCollaborators();
    } catch (e: any) {
      setError('Failed to approve: ' + e.message);
    }
  }

  async function handleReject(id: string) {
    if (!confirm('Reject this pending collaborator?')) return;

    try {
      await api.post(`/collaborators/${id}/reject`);
      alert('Collaborator rejected.');
      fetchCollaborators();
    } catch (e: any) {
      setError('Failed to reject: ' + e.message);
    }
  }

  async function handleDeactivate(id: string) {
    if (!confirm('Deactivate this collaborator and its application access?')) return;
    try {
      await api.delete(`/collaborators/${id}`);
      await fetchCollaborators();
    } catch (e: any) {
      setError(e.message || 'Unable to deactivate collaborator');
    }
  }

  async function createCollaborator(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api.post('/collaborators/admin', createForm);
      setCreateForm({ collaborators_name: '', collaborators_email: '', collaborators_phone: '' });
      setShowCreate(false);
      await fetchCollaborators();
    } catch (e: any) {
      setError(e.message || 'Unable to create collaborator');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading collaborators...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold text-gray-900">Collaborator Management</h1>
          <button type="button" onClick={() => setShowCreate(true)} className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white">Create collaborator</button>
        </div>

        {error && (
          <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-lg bg-red-100 p-4 text-red-800">
            <span>{error}</span>
            <button type="button" onClick={fetchCollaborators} className="rounded bg-white px-3 py-1 text-sm font-semibold">Retry</button>
          </div>
        )}

        <div className="mb-6 flex flex-wrap gap-2">
          {[
            ['all', 'All'],
            ['pending', 'Pending'],
            ['active', 'Active'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value as 'all' | 'pending' | 'active')}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                statusFilter === value
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mb-12">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            {statusFilter === 'pending'
              ? `Pending Approval (${pendingItems.length})`
              : statusFilter === 'active'
                ? `Active Collaborators (${verifiedItems.length})`
                : `All Collaborators (${allItems.length})`}
          </h2>

          {visibleItems.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
              {statusFilter === 'pending'
                ? 'No pending collaborators for approval'
                : statusFilter === 'active'
                  ? 'No active collaborators yet'
                  : 'No collaborators found'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleItems.map((c) => {
                const isPending = getCollaboratorStatus(c) === 'pending';
                return (
                  <div key={c.id} className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center">
                        <div className="bg-gray-100 rounded-full p-3 mr-3">
                          {isPending ? <User className="w-6 h-6 text-gray-600" /> : <CheckCircle className="w-6 h-6 text-green-500" />}
                        </div>
                        <div>
                          <h3 className="font-bold text-lg">{c.collaborators_name}</h3>
                          <p className="text-sm text-gray-500 font-mono">{c.collaborators_code}</p>
                        </div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${isPending ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                        {isPending ? 'PENDING' : 'ACTIVE'}
                      </span>
                    </div>

                    <div className="space-y-2 mb-4 text-sm">
                      <div className="flex items-center text-gray-600">
                        <Mail className="w-4 h-4 mr-2" />
                        {c.collaborators_email}
                      </div>
                      <div className="flex items-center text-gray-600">
                        <Phone className="w-4 h-4 mr-2" />
                        {c.collaborators_phone}
                      </div>
                      <div className="flex items-center text-gray-600">
                        <Calendar className="w-4 h-4 mr-2" />
                        {formatCollaboratorDate(c.collaborators_registered_date)}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setSelected(c)}
                        className="w-full px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-900 font-semibold rounded-lg transition"
                      >
                        View Details
                      </button>
                      {isPending ? (
                        <>
                        <button
                          onClick={() => handleApprove(c.id)}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition"
                        >
                          <CheckCircle className="w-5 h-5" />
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(c.id)}
                          className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition"
                        >
                          Reject
                        </button>
                        </>
                      ) : c.collaborators_qr_code ? (
                        <>
                          <button onClick={() => setSelectedQr(c.collaborators_qr_code!)} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded transition"><QrCode className="w-4 h-4" />View QR Code</button>
                          <button onClick={() => handleDeactivate(c.id)} className="w-full rounded bg-red-700 px-3 py-2 text-sm font-semibold text-white">Deactivate</button>
                        </>
                      ) : <button onClick={() => handleDeactivate(c.id)} className="w-full rounded bg-red-700 px-3 py-2 text-sm font-semibold text-white">Deactivate</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* QR Code Modal */}
      {selected && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelected(null)}
        >
          <div className="bg-white rounded-lg p-8 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h3 className="text-xl font-bold">{selected.collaborators_name}</h3>
                <p className="text-sm text-gray-500 font-mono">{selected.collaborators_code}</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setSelected(null)} className="text-2xl text-gray-500">×</button>
            </div>
            <dl className="grid gap-3 text-sm">
              <div><dt className="font-semibold text-gray-500">System ID</dt><dd className="break-all">{selected.id}</dd></div>
              <div><dt className="font-semibold text-gray-500">Email</dt><dd>{selected.collaborators_email || '—'}</dd></div>
              <div><dt className="font-semibold text-gray-500">Phone</dt><dd>{selected.collaborators_phone || '—'}</dd></div>
              <div><dt className="font-semibold text-gray-500">Status</dt><dd>{getCollaboratorStatus(selected).toUpperCase()}</dd></div>
              <div><dt className="font-semibold text-gray-500">Registered</dt><dd>{formatCollaboratorDate(selected.collaborators_registered_date, true)}</dd></div>
            </dl>
          </div>
        </div>
      )}

      {selectedQr && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedQr(null)}
        >
          <div 
            className="bg-white rounded-lg p-8 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold mb-4 text-center">Collaborator QR Code</h3>
            <div className="flex justify-center mb-4">
              <img 
                src={selectedQr} 
                alt="QR Code" 
                className="w-64 h-64 border-4 border-gray-200 rounded-lg"
              />
            </div>
            <button
              onClick={() => setSelectedQr(null)}
              className="w-full px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg transition"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={() => setShowCreate(false)}>
          <form className="w-full max-w-lg rounded-lg bg-white p-8" onSubmit={createCollaborator} onClick={(event) => event.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between"><h3 className="text-xl font-bold">Create pending collaborator</h3><button type="button" onClick={() => setShowCreate(false)} className="text-2xl">×</button></div>
            <label className="mb-4 block text-sm font-semibold">Name<input required className="mt-1 w-full rounded border p-2 font-normal" value={createForm.collaborators_name} onChange={(e) => setCreateForm({ ...createForm, collaborators_name: e.target.value })} /></label>
            <label className="mb-4 block text-sm font-semibold">Email<input required type="email" className="mt-1 w-full rounded border p-2 font-normal" value={createForm.collaborators_email} onChange={(e) => setCreateForm({ ...createForm, collaborators_email: e.target.value })} /></label>
            <label className="mb-4 block text-sm font-semibold">Phone<input required className="mt-1 w-full rounded border p-2 font-normal" value={createForm.collaborators_phone} onChange={(e) => setCreateForm({ ...createForm, collaborators_phone: e.target.value })} /></label>
            <p className="mb-4 text-sm text-gray-500">This creates a pending business record only. Account assignment and activation remain separate governed actions.</p>
            <button type="submit" className="rounded bg-green-700 px-4 py-2 font-semibold text-white">Create pending collaborator</button>
          </form>
        </div>
      )}
    </div>
  );
}
