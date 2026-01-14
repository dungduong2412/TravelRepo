'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { CheckCircle, User, Mail, Phone, Calendar, QrCode } from 'lucide-react';

interface Collaborator {
  id: string;
  collaborators_code: string;
  collaborators_name: string;
  collaborators_email: string;
  collaborators_phone: string;
  collaborators_verified: boolean;
  collaborators_registered_date: string;
  collaborators_qr_code?: string;
}

export default function AdminCollaboratorsPage() {
  const [pendingItems, setPendingItems] = useState<Collaborator[]>([]);
  const [verifiedItems, setVerifiedItems] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedQr, setSelectedQr] = useState<string | null>(null);

  useEffect(() => {
    fetchCollaborators();
  }, []);

  async function fetchCollaborators() {
    try {
      const [pending, all] = await Promise.all([
        api.get('/admin/collaborators/pending').then(r => r.data),
        api.get('/collaborators').then(r => r.data)
      ]);
      
      setPendingItems(pending || []);
      setVerifiedItems((all || []).filter((c: Collaborator) => c.collaborators_verified));
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(id: string) {
    if (!confirm('Approve this collaborator? A QR code will be generated.')) return;
    
    try {
      await api.post(`/admin/collaborators/${id}/approve`);
      alert('Collaborator approved and QR code generated!');
      fetchCollaborators();
    } catch (e: any) {
      alert('Failed to approve: ' + e.message);
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
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Collaborator Management</h1>

        {/* Pending Approval Section */}
        <div className="mb-12">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            Pending Approval ({pendingItems.length})
          </h2>
          
          {pendingItems.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
              No pending collaborators for approval
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pendingItems.map((c) => (
                <div key={c.id} className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center">
                      <div className="bg-gray-100 rounded-full p-3 mr-3">
                        <User className="w-6 h-6 text-gray-600" />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg">{c.collaborators_name}</h3>
                        <p className="text-sm text-gray-500 font-mono">{c.collaborators_code}</p>
                      </div>
                    </div>
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
                      {new Date(c.collaborators_registered_date).toLocaleDateString()}
                    </div>
                  </div>

                  <button
                    onClick={() => handleApprove(c.id)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition"
                  >
                    <CheckCircle className="w-5 h-5" />
                    Approve & Generate QR
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Verified Collaborators Section */}
        <div>
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            Verified Collaborators ({verifiedItems.length})
          </h2>
          
          {verifiedItems.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
              No verified collaborators yet
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {verifiedItems.map((c) => (
                <div key={c.id} className="bg-white rounded-lg shadow-md p-6">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center">
                      <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                      <span className="text-xs font-semibold text-green-600">VERIFIED</span>
                    </div>
                  </div>
                  
                  <h3 className="font-bold text-lg mb-1">{c.collaborators_name}</h3>
                  <p className="text-sm text-gray-500 font-mono mb-3">{c.collaborators_code}</p>
                  
                  {c.collaborators_qr_code && (
                    <button
                      onClick={() => setSelectedQr(c.collaborators_qr_code!)}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded transition"
                    >
                      <QrCode className="w-4 h-4" />
                      View QR Code
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* QR Code Modal */}
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
    </div>
  );
}
