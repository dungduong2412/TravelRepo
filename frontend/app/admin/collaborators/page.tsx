'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { CheckCircle, ChevronLeft, ChevronRight, Image as ImageIcon, QrCode, Search, User } from 'lucide-react';

type Collaborator = {
  id: string; collaborators_code: string; collaborators_name: string; collaborators_email?: string | null;
  collaborators_phone?: string | null; collaborators_verified: boolean; collaborators_status?: string | null;
  collaborators_registered_date?: string | null; collaborators_qr_code?: string | null; collaborators_rating?: number | null;
  collaborators_actions?: string | null; collaborators_remark_followup_action?: string | null; merchant_system_id?: string | null;
};
type MediaAsset = { id: string; collaborator_id?: string | null; original_filename?: string | null; is_hero?: boolean; publication_status?: string | null; transfer_status?: string | null; created_at?: string | null; signed_url?: string | null };
type Approval = { id: string; collaborator_id?: string | null; action: string; slot: string; status: string; requested_at?: string | null; decided_at?: string | null; decision_reason?: string | null };
type Detail = { collaborator: Collaborator; media: MediaAsset[]; approvals: Approval[] };
const PAGE_SIZE = 25;

export default function AdminCollaboratorsPage() {
  const [allItems, setAllItems] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedQr, setSelectedQr] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ collaborators_name: '', collaborators_email: '', collaborators_phone: '', collaborators_bank_name: '', collaborators_bank_acc_name: '', collaborators_bank_acc_number: '', merchant_system_id: '' });
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fetchCollaborators = useCallback(async () => {
    try { setError(null); setAllItems((await api.get('/collaborators')) || []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load partners'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void fetchCollaborators(); }, [fetchCollaborators]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return allItems.filter((item) => {
      const itemStatus = statusOf(item);
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'legacy' ? !KNOWN_STATUSES.has(itemStatus) : itemStatus === statusFilter);
      const haystack = [item.collaborators_name, item.collaborators_code, item.collaborators_email, item.collaborators_phone].filter(Boolean).join(' ').toLocaleLowerCase();
      return matchesStatus && (!needle || haystack.includes(needle));
    });
  }, [allItems, search, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, statusFilter]);
  useEffect(() => {
    let active = true;
    const missing = visibleItems.filter((item) => !(item.id in avatars));
    if (!missing.length) return;
    void Promise.all(missing.map(async (item) => {
      try {
        const media = await api.get(`/media/approved/collaborator/${item.id}`);
        const hero = (media || []).find((asset: MediaAsset) => asset.is_hero) || media?.[0];
        return [item.id, hero?.signed_url || null] as const;
      } catch { return [item.id, null] as const; }
    })).then((entries) => { if (active) setAvatars((current) => ({ ...current, ...Object.fromEntries(entries) })); });
    return () => { active = false; };
  }, [avatars, visibleItems]);

  async function openDetail(collaborator: Collaborator) {
    try {
      setDetailLoading(true); setError(null);
      const [allMedia, ...queues] = await Promise.all([api.get('/media'), ...['pending', 'approved', 'rejected', 'cancelled'].map((state) => api.get(`/media/approvals?owner_type=collaborator&status=${state}&page=1&page_size=100`))]);
      const ownedMedia = ((allMedia || []) as MediaAsset[]).filter((asset) => asset.collaborator_id === collaborator.id);
      const media = await Promise.all(ownedMedia.map(async (asset) => {
        try { const signed = await api.get(`/media/${asset.id}/signed-url`); return { ...asset, signed_url: signed?.signedUrl || signed?.signed_url || null }; }
        catch { return { ...asset, signed_url: null }; }
      }));
      const approvals = queues.flatMap((queue) => queue?.items || []).filter((request: Approval) => request.collaborator_id === collaborator.id);
      setDetail({ collaborator, media, approvals });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load partner details'); }
    finally { setDetailLoading(false); }
  }
  async function handleApprove(id: string) { if (!confirm('Approve this partner? A QR code will be generated.')) return; try { await api.post(`/collaborators/${id}/approve`); await fetchCollaborators(); setDetail(null); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to approve partner'); } }
  async function handleReject(id: string) { if (!confirm('Reject this pending partner?')) return; try { await api.post(`/collaborators/${id}/reject`); await fetchCollaborators(); setDetail(null); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to reject partner'); } }
  async function handleDeactivate(id: string) { if (!confirm('Deactivate this partner and its application access? This action is audited.')) return; try { await api.delete(`/collaborators/${id}`); await fetchCollaborators(); setDetail(null); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to deactivate partner'); } }
  async function createCollaborator(event: FormEvent) {
    event.preventDefault();
    const opt = (v: string) => v.trim() === '' ? undefined : v.trim();
    try {
      await api.post('/collaborators/admin', {
        collaborators_name: createForm.collaborators_name, collaborators_email: createForm.collaborators_email, collaborators_phone: createForm.collaborators_phone,
        collaborators_bank_name: opt(createForm.collaborators_bank_name), collaborators_bank_acc_name: opt(createForm.collaborators_bank_acc_name),
        collaborators_bank_acc_number: opt(createForm.collaborators_bank_acc_number), merchant_system_id: opt(createForm.merchant_system_id) || null,
      });
      setCreateForm({ collaborators_name: '', collaborators_email: '', collaborators_phone: '', collaborators_bank_name: '', collaborators_bank_acc_name: '', collaborators_bank_acc_number: '', merchant_system_id: '' });
      setShowCreate(false); await fetchCollaborators();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create partner'); }
  }

  async function adminUpload(collaboratorId: string, file: File) {
    const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    if (!TYPES.includes(file.type)) { setUploadError('Only JPEG, PNG or WebP images are supported'); return; }
    if (file.size > 5 * 1024 * 1024) { setUploadError('Maximum file size is 5 MB'); return; }
    setUploadBusy(true); setUploadError(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Cannot read file'));
        reader.readAsDataURL(file);
      });
      await api.post('/media/upload', { collaborator_id: collaboratorId, filename: file.name, mime_type: file.type, size_bytes: file.size, base64_data: base64, action: 'add', slot: 'main', direct_publish: true });
      await openDetail(detail!.collaborator);
    } catch (cause) { setUploadError(cause instanceof Error ? cause.message : 'Unable to upload media'); }
    finally { setUploadBusy(false); }
  }

  return <main className="min-h-screen bg-slate-50 p-4 md:p-8">
    <div className="mx-auto grid max-w-[1500px] gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-1 text-xs font-bold uppercase tracking-[.14em] text-teal-700">VNO partner network</p><h1 className="text-2xl font-bold text-slate-950">Partner Management</h1><p className="mt-1 text-sm text-slate-500">{allItems.length} records · private avatars are served through expiring signed URLs</p></div><button type="button" onClick={() => setShowCreate(true)} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">Create partner</button></header>
      {error && <div role="alert" className="flex items-center justify-between gap-4 rounded-xl bg-red-100 p-4 text-sm text-red-900"><span>{error}</span><button type="button" onClick={fetchCollaborators} className="rounded bg-white px-3 py-1 font-semibold">Retry</button></div>}
      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-[minmax(240px,2fr)_minmax(160px,1fr)_auto] md:items-end"><label className="text-xs font-bold text-slate-600">Search<div className="relative mt-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" placeholder="Name, code, email or phone" /></div></label><label className="text-xs font-bold text-slate-600">Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"><option value="all">All statuses</option><option value="pending">Pending</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="blocked">Blocked</option><option value="legacy">Legacy / unmapped</option></select></label><span className="pb-2 text-sm text-slate-500">{filtered.length} matches</span></section>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Partner</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Merchant associations</th><th className="px-4 py-3">Registered</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50/70"><td className="px-4 py-3"><div className="flex items-center gap-3">{avatars[item.id] ? <img src={avatars[item.id] || ''} alt="" className="h-10 w-10 rounded-full border border-slate-200 object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-500"><User className="h-5 w-5" /></span>}<div><strong className="block text-slate-900">{item.collaborators_name || 'Unnamed partner'}</strong><span className="font-mono text-xs text-slate-500">{item.collaborators_code || 'No code'}</span></div></div></td><td className="px-4 py-3 text-slate-600"><div>{item.collaborators_email || '—'}</div><div>{item.collaborators_phone || '—'}</div></td><td className="px-4 py-3"><StatusBadge value={statusOf(item)} /></td><td className="px-4 py-3"><strong>{item.merchant_system_id ? 1 : 0}</strong><div className="text-xs text-slate-500">{item.merchant_system_id ? 'Assigned merchant' : 'No merchant assignment'}</div></td><td className="px-4 py-3 text-slate-600">{formatDate(item.collaborators_registered_date)}</td><td className="px-4 py-3 text-right"><button type="button" disabled={detailLoading} onClick={() => void openDetail(item)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-100">View details</button></td></tr>)}</tbody></table></div>{loading && <div className="p-10 text-center text-slate-500">Loading partners…</div>}{!loading && !visibleItems.length && <div className="p-10 text-center text-slate-500">No partners match the current filters.</div>}<footer className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500"><span>Page {page} of {pageCount}</span><div className="flex gap-2"><button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded border p-2 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><button aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)} className="rounded border p-2 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></footer></section>
    </div>

    {detail && <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50" onClick={() => setDetail(null)}><aside className="h-full w-full max-w-3xl overflow-y-auto bg-white p-5 shadow-2xl md:p-8" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-teal-700">Partner details</p><h2 className="mt-1 text-2xl font-bold text-slate-950">{detail.collaborator.collaborators_name}</h2><p className="font-mono text-xs text-slate-500">{detail.collaborator.collaborators_code}</p></div><button aria-label="Close" onClick={() => setDetail(null)} className="text-3xl text-slate-500">×</button></div>
      <DetailSection title="Profile information"><dl className="grid gap-4 sm:grid-cols-2"><DetailItem label="Email" value={detail.collaborator.collaborators_email} /><DetailItem label="Phone" value={detail.collaborator.collaborators_phone} /><DetailItem label="Status" value={statusOf(detail.collaborator)} /><DetailItem label="Registered" value={formatDate(detail.collaborator.collaborators_registered_date, true)} /><DetailItem label="Rating" value={detail.collaborator.collaborators_rating} /><DetailItem label="System ID" value={detail.collaborator.id} /></dl></DetailSection>
      <DetailSection title="Approved avatar and media"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{detail.media.filter(isEffective).map((asset) => <MediaCard key={asset.id} asset={asset} />)}{!detail.media.some(isEffective) && <EmptyMedia label="No approved or legacy-effective avatar." />}</div></DetailSection>
      <DetailSection title="Pending proposals"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{detail.media.filter((asset) => asset.publication_status === 'pending').map((asset) => <MediaCard key={asset.id} asset={asset} />)}{!detail.media.some((asset) => asset.publication_status === 'pending') && <EmptyMedia label="No pending image proposals." />}</div></DetailSection>
      <DetailSection title="Associations"><dl className="grid gap-4 sm:grid-cols-2"><DetailItem label="Associated merchant count" value={detail.collaborator.merchant_system_id ? 1 : 0} /><DetailItem label="Merchant system ID" value={detail.collaborator.merchant_system_id} /></dl></DetailSection>
      <DetailSection title={`Approval and profile history (${detail.approvals.length})`}>{detail.approvals.length ? detail.approvals.sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at))).map((request) => <div key={request.id} className="mb-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-600"><div className="flex justify-between gap-3"><strong className="text-slate-900">{request.action} · {request.slot}</strong><StatusBadge value={request.status} /></div><p className="mt-1">Requested {formatDate(request.requested_at, true)}</p>{request.decision_reason && <p>Decision reason: {request.decision_reason}</p>}</div>) : <p className="text-sm text-slate-500">No media approval history.</p>}<p className="mt-3 text-sm text-slate-500">Profile action: {detail.collaborator.collaborators_actions || '—'}<br />Follow-up: {detail.collaborator.collaborators_remark_followup_action || '—'}</p></DetailSection>
      <DetailSection title="Upload avatar"><p className="mb-3 text-sm text-slate-500">Admin direct upload — immediately effective and audited. Only JPEG, PNG, or WebP, maximum 5 MB.</p>{uploadError && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{uploadError}</p>}<label className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-teal-700 px-4 font-semibold text-white">{uploadBusy ? 'Uploading…' : 'Upload avatar'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploadBusy} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void adminUpload(detail.collaborator.id, file); event.target.value = ''; }} /></label></DetailSection>
      <DetailSection title="Administrative actions"><div className="flex flex-wrap gap-2">{statusOf(detail.collaborator) === 'pending' && <><button onClick={() => void handleApprove(detail.collaborator.id)} className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white"><CheckCircle className="mr-2 inline h-4 w-4" />Approve</button><button onClick={() => void handleReject(detail.collaborator.id)} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white">Reject</button></>}{detail.collaborator.collaborators_qr_code && <button onClick={() => setSelectedQr(detail.collaborator.collaborators_qr_code || null)} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white"><QrCode className="mr-2 inline h-4 w-4" />View QR</button>}{statusOf(detail.collaborator) === 'active' && <button onClick={() => void handleDeactivate(detail.collaborator.id)} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700">Deactivate collaborator</button>}</div><p className="mt-2 text-xs text-slate-500">Destructive controls are confined to this detail view and require confirmation.</p></DetailSection>
    </aside></div>}
    {selectedQr && <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/50 p-4" onClick={() => setSelectedQr(null)}><div className="w-full max-w-sm rounded-xl bg-white p-6" onClick={(event) => event.stopPropagation()}><h3 className="mb-4 text-center text-lg font-bold">Partner QR Code</h3><img src={selectedQr} alt="Partner QR code" className="mx-auto h-64 w-64 rounded-lg border-4 border-slate-100" /><button onClick={() => setSelectedQr(null)} className="mt-4 w-full rounded-lg bg-slate-700 px-4 py-2 font-semibold text-white">Close</button></div></div>}
    {showCreate && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onClick={() => setShowCreate(false)}><form className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6" onSubmit={createCollaborator} onClick={(event) => event.stopPropagation()}><div className="mb-5 flex items-center justify-between"><h3 className="text-xl font-bold">Create pending partner</h3><button type="button" onClick={() => setShowCreate(false)} className="text-2xl">×</button></div>
      <fieldset className="mb-4 rounded-xl border border-slate-200 p-4"><legend className="px-2 text-sm font-bold text-slate-700">Identity (required)</legend><FormField label="Name" value={createForm.collaborators_name} onChange={(value) => setCreateForm({ ...createForm, collaborators_name: value })} /><FormField label="Email" type="email" value={createForm.collaborators_email} onChange={(value) => setCreateForm({ ...createForm, collaborators_email: value })} /><FormField label="Phone" value={createForm.collaborators_phone} onChange={(value) => setCreateForm({ ...createForm, collaborators_phone: value })} /></fieldset>
      <fieldset className="mb-4 rounded-xl border border-slate-200 p-4"><legend className="px-2 text-sm font-bold text-slate-700">Bank details (optional)</legend><FormField required={false} label="Bank name" value={createForm.collaborators_bank_name} onChange={(value) => setCreateForm({ ...createForm, collaborators_bank_name: value })} /><FormField required={false} label="Account holder name" value={createForm.collaborators_bank_acc_name} onChange={(value) => setCreateForm({ ...createForm, collaborators_bank_acc_name: value })} /><FormField required={false} label="Account number" value={createForm.collaborators_bank_acc_number} onChange={(value) => setCreateForm({ ...createForm, collaborators_bank_acc_number: value })} /></fieldset>
      <fieldset className="mb-4 rounded-xl border border-slate-200 p-4"><legend className="px-2 text-sm font-bold text-slate-700">Merchant assignment (optional)</legend><FormField required={false} label="Merchant system ID (UUID)" value={createForm.merchant_system_id} onChange={(value) => setCreateForm({ ...createForm, merchant_system_id: value })} /><p className="text-xs text-slate-500">Paste the merchant_system_id from the Merchants page to pre-assign this partner. Leave blank to assign later.</p></fieldset>
      <p className="mb-4 text-sm text-slate-500">This creates a pending business record only. Account assignment and activation remain governed separately.</p>
      <button type="submit" className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white">Create pending partner</button></form></div>}
  </main>;
}

function statusOf(item: Collaborator) { return item.collaborators_status?.toLowerCase() || (item.collaborators_verified ? 'active' : 'pending'); }
function isEffective(asset: MediaAsset) { return ['approved', 'legacy_effective', 'preexisting_effective'].includes(asset.publication_status || '') && asset.transfer_status === 'verified'; }
function formatDate(value?: string | null, includeTime = false) { if (!value) return '—'; const date = new Date(value); if (Number.isNaN(date.getTime()) || date.getTime() === 0) return '—'; return includeTime ? date.toLocaleString('vi-VN') : date.toLocaleDateString('vi-VN'); }
const KNOWN_STATUSES = new Set(['active', 'approved', 'pending', 'inactive', 'blocked', 'rejected', 'cancelled']);
function StatusBadge({ value }: { value: string }) { const tone = value === 'active' || value === 'approved' ? 'bg-green-100 text-green-800' : value === 'pending' ? 'bg-amber-100 text-amber-800' : KNOWN_STATUSES.has(value) ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'; const label = KNOWN_STATUSES.has(value) ? value.replaceAll('_', ' ') : `Legacy status ${value}`; return <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${tone}`}>{label}</span>; }
function DetailSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="mt-5 rounded-xl border border-slate-200 p-4"><h3 className="mb-3 font-bold text-slate-950">{title}</h3>{children}</section>; }
function DetailItem({ label, value }: { label: string; value: unknown }) { return <div className="min-w-0"><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className="mt-1 break-all text-sm text-slate-800">{value === null || value === undefined || value === '' ? '—' : String(value)}</dd></div>; }
function MediaCard({ asset }: { asset: MediaAsset }) { return <article className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">{asset.signed_url ? <img src={asset.signed_url} alt={asset.original_filename || 'Partner media'} className="h-36 w-full object-cover" /> : <div className="grid h-36 place-items-center text-slate-400"><ImageIcon className="h-7 w-7" /></div>}<div className="grid gap-1 p-3 text-xs text-slate-500"><strong className="truncate text-slate-800">{asset.original_filename || asset.id}</strong><StatusBadge value={asset.publication_status || 'unknown'} /></div></article>; }
function EmptyMedia({ label }: { label: string }) { return <div className="col-span-full rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">{label}</div>; }
function FormField({ label, value, onChange, type = 'text', required = true }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) { return <label className="mb-4 block text-sm font-semibold">{label}<input required={required} type={type} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal" value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
