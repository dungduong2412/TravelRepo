'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { fractionToPercentagePoints, percentagePointsToFraction } from '../../../lib/rates';
import { ExternalLink } from 'lucide-react';
import { MerchantListRow, verificationLabel } from '../../../components/admin/MerchantListRow';
import { MerchantGallery, MerchantHero, type MerchantMedia } from '../../../components/admin/MerchantGallery';
import { statusLabel } from '../../../lib/status-labels';

type Merchant = {
  merchant_system_id: string; merchant_code?: string | null; merchant_name?: string | null; merchant_description?: string | null;
  merchant_phone?: string | null; merchant_email?: string | null; merchant_contact_phone?: string | null; owner_name?: string | null; owner_email?: string | null; owner_phone?: string | null;
  owner_tax_code?: string | null; merchant_description_format?: 'plain_text' | 'markdown';
  new_address_country?: string | null; new_address_province?: string | null; new_address_district?: string | null;
  new_address_city?: string | null; new_address_ward?: string | null; new_address_line?: string | null;
  merchant_commission_type?: string | null; merchant_commission_value?: string | number | null; merchant_discount_type?: string | null; merchant_discount_value?: string | number | null;
  merchant_priority?: number | null; merchant_verified?: boolean; merchants_status?: string | null; merchant_registered_date?: string | null; merchant_verified_date?: string | null; merchant_last_update?: string | null; merchant_action?: string | null;
  legacy_restaurant_id?: string | null; legacy_status?: number | null; legacy_is_banned?: boolean | null; legacy_min_commission?: string | number | null; legacy_tax_code?: string | null; legacy_rating?: string | number | null; legacy_short_name?: string | null; legacy_is_update_requesting?: boolean | null; legacy_last_update_request_at?: string | null;
  category_names?: string[]; main_image?: { id: string; thumb_url: string | null } | null;
};
type Directory = { items: Merchant[]; page: number; page_size: number; total: number; page_count: number };
type Category = { id: string; category_name?: string | null; category_name_vi?: string | null };
type OperationalDetail = { merchant: Merchant; update_requests: Array<{ id: string; legacy_status?: number | null; requested_at?: string | null; payload?: Record<string, unknown>; request_status?: string; request_source?: string; decided_at?: string | null; decision_reason?: string | null }>; media: MerchantMedia[]; categories: Array<{ category_id?: string; category?: Category | null }> };
type EditForm = { merchant_name: string; merchant_description: string; merchant_description_format: 'plain_text' | 'markdown'; merchant_phone: string; merchant_email: string; merchant_contact_phone: string; owner_name: string; owner_phone: string; owner_tax_code: string; new_address_country: string; new_address_province: string; new_address_district: string; new_address_city: string; new_address_ward: string; new_address_line: string; category_ids: string[]; merchant_commission_type: string; merchant_commission_value: string; merchant_discount_type: string; merchant_discount_value: string; merchant_priority: string; merchant_verified: boolean; merchants_status: string; merchant_action: string };

export default function AdminMerchantsPage() {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [search, setSearch] = useState(''); const [appliedSearch, setAppliedSearch] = useState(''); const [status, setStatus] = useState(''); const [verified, setVerified] = useState('');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25); const [sort, setSort] = useState('merchant_registered_date'); const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [detail, setDetail] = useState<OperationalDetail | null>(null); const [editing, setEditing] = useState<EditForm | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [actionId, setActionId] = useState<string | null>(null); const [showCreate, setShowCreate] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [inviteBusy, setInviteBusy] = useState(false); const [inviteError, setInviteError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ owner_email: '', merchant_name: '', merchant_email: '', merchant_phone: '', merchant_contact_phone: '', merchant_description: '', owner_name: '', owner_phone: '', owner_tax_code: '', new_address_country: '', new_address_province: '', new_address_district: '', new_address_city: '', new_address_ward: '', new_address_line: '', category_ids: [] as string[], merchant_commission_type: '', merchant_commission_value: '', merchant_discount_type: '', merchant_discount_value: '' });
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => { api.get('/categories').then((rows) => setCategories(rows || [])).catch(() => undefined); }, []);

  const fetchDirectory = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), sort, direction });
    if (appliedSearch) params.set('search', appliedSearch); if (status) params.set('status', status); if (verified) params.set('verified', verified);
    try { setLoading(true); setError(null); setDirectory(await api.get(`/merchants/admin-directory?${params}`)); }
    catch (err) { setError(message(err, 'Unable to load merchants')); } finally { setLoading(false); }
  }, [appliedSearch, direction, page, pageSize, sort, status, verified]);
  useEffect(() => { fetchDirectory(); }, [fetchDirectory]);

  async function loadOperational(merchantId: string) {
    const operational = await api.get(`/merchants/${merchantId}/operational-detail`) as OperationalDetail;
    const media = await Promise.all(operational.media.map(async (asset) => {
      try {
        const signed = await api.get(`/media/${asset.id}/signed-url`);
        return { ...asset, signed_url: signed?.signedUrl || signed?.signed_url || null };
      } catch {
        return { ...asset, signed_url: null };
      }
    }));
    return { ...operational, media } as OperationalDetail;
  }
  /** A merchant row opens the editor immediately: the draft starts as the saved values. */
  async function openDetail(merchant: Merchant): Promise<OperationalDetail | null> {
    setInvitation(undefined); setInviteError(null); setEditError(null); setSavedNote(null);
    try {
      setError(null);
      const operational = await loadOperational(merchant.merchant_system_id);
      setDetail(operational); setEditing(toEdit(operational));
      api.get(`/invitations/for/merchant/${merchant.merchant_system_id}`).then(setInvitation).catch(() => setInvitation(null));
      return operational;
    }
    catch (err) { setError(message(err, 'Unable to load merchant detail')); return null; }
  }
  async function createInvitation(merchantId: string) {
    setInviteBusy(true); setInviteError(null);
    try { setInvitation(await api.post('/invitations', { entity_type: 'merchant', entity_id: merchantId })); }
    catch (err) { setInviteError(message(err, 'Unable to create invitation')); }
    finally { setInviteBusy(false); }
  }
  async function revokeInvitation(id: string) {
    if (!confirm('Revoke this invitation?')) return;
    setInviteBusy(true); setInviteError(null);
    try { setInvitation(await api.delete(`/invitations/${id}`)); }
    catch (err) { setInviteError(message(err, 'Unable to revoke invitation')); }
    finally { setInviteBusy(false); }
  }
  async function runAction(merchant: Merchant, action: 'approve' | 'reject' | 'deactivate') {
    if (dirty && !confirm('You have unsaved changes that will be discarded. Continue?')) return;
    if (!confirm(`Are you sure you want to ${action} ${merchant.merchant_name || 'this merchant'}?`)) return;
    try { setActionId(merchant.merchant_system_id); if (action === 'deactivate') await api.delete(`/merchants/${merchant.merchant_system_id}`); else await api.post(`/merchants/${merchant.merchant_system_id}/${action}`); setDetail(null); setEditing(null); await fetchDirectory(); }
    catch (err) { setError(message(err, `Unable to ${action} merchant`)); } finally { setActionId(null); }
  }
  async function createMerchant(event: FormEvent) {
    event.preventDefault();
    const opt = (v: string) => v.trim() === '' ? undefined : v.trim();
    try {
      setError(null);
      await api.post('/merchants/admin', {
        owner_email: createForm.owner_email, merchant_name: createForm.merchant_name,
        merchant_email: opt(createForm.merchant_email), merchant_phone: opt(createForm.merchant_phone),
        merchant_contact_phone: opt(createForm.merchant_contact_phone), merchant_description: opt(createForm.merchant_description),
        owner_name: opt(createForm.owner_name), owner_phone: opt(createForm.owner_phone), owner_tax_code: opt(createForm.owner_tax_code),
        new_address_country: opt(createForm.new_address_country), new_address_province: opt(createForm.new_address_province),
        new_address_district: opt(createForm.new_address_district), new_address_city: opt(createForm.new_address_city),
        new_address_ward: opt(createForm.new_address_ward), new_address_line: opt(createForm.new_address_line),
        category_ids: createForm.category_ids.length ? createForm.category_ids : undefined,
        merchant_commission_type: opt(createForm.merchant_commission_type),
        merchant_commission_value: commercialValueForApi(createForm.merchant_commission_type, createForm.merchant_commission_value),
        merchant_discount_type: opt(createForm.merchant_discount_type),
        merchant_discount_value: commercialValueForApi(createForm.merchant_discount_type, createForm.merchant_discount_value),
      });
      setCreateForm({ owner_email: '', merchant_name: '', merchant_email: '', merchant_phone: '', merchant_contact_phone: '', merchant_description: '', owner_name: '', owner_phone: '', owner_tax_code: '', new_address_country: '', new_address_province: '', new_address_district: '', new_address_city: '', new_address_ward: '', new_address_line: '', category_ids: [], merchant_commission_type: '', merchant_commission_value: '', merchant_discount_type: '', merchant_discount_value: '' });
      setShowCreate(false); await fetchDirectory();
    } catch (err) { setError(message(err, 'Unable to create merchant')); }
  }
  async function saveMerchant(event?: FormEvent) {
    event?.preventDefault(); if (!detail || !editing) return;
    setSavedNote(null);
    try {
      setActionId(detail.merchant.merchant_system_id); setEditError(null);
      const payload = buildPayload(editing, toEdit(detail));
      if (Object.keys(payload).length === 0) { setSavedNote('No changes to save.'); return; }
      await api.patch(`/merchants/${detail.merchant.merchant_system_id}/admin`, payload);
      // Re-read the saved record so the editor shows what was actually persisted, and stay in the editor.
      const fresh = await loadOperational(detail.merchant.merchant_system_id);
      setDetail(fresh); setEditing(toEdit(fresh)); void fetchDirectory();
      setSavedNote(`Saved ${new Date().toLocaleTimeString('vi-VN')}. VNO shows the change within about 30 seconds.`);
    } catch (err) { setEditError(message(err, 'Unable to update merchant')); } finally { setActionId(null); }
  }
  /** Reload photos after an upload / Set as main without touching the unsaved draft. */
  async function refreshDetail() {
    if (!detail) return;
    try { setDetail(await loadOperational(detail.merchant.merchant_system_id)); void fetchDirectory(); }
    catch (err) { setError(message(err, 'Unable to refresh photos')); }
  }
  const dirty = Boolean(detail && editing && JSON.stringify(editing) !== JSON.stringify(toEdit(detail)));
  /** Close / Cancel / outside click / Escape all end up here: unsaved edits are discarded only after confirmation. */
  const closeEditor = useCallback(() => {
    if (dirty && !confirm('Discard your unsaved changes?')) return;
    setDetail(null); setEditing(null); setEditError(null); setSavedNote(null);
  }, [dirty]);
  useEffect(() => {
    if (!detail) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeEditor(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, closeEditor]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const items = directory?.items || [];
  return <div style={styles.container}>
    <div style={styles.header}><div><h2 style={styles.title}>Merchant Management</h2><p style={styles.subtitle}>{directory?.total ?? 0} merchant records · commercial values remain nullable unless sourced or explicitly entered</p></div><button type="button" onClick={() => setShowCreate(true)} style={styles.primaryButton}>Create merchant</button></div>
    {error && <div style={styles.error} role="alert">{error}</div>}
    <form style={styles.filters} onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedSearch(search); }}>
      <label style={styles.label}>Search<input style={styles.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, original code, email or phone" /></label>
      <label style={styles.label}>Status<select style={styles.input} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option><option value="pending">{statusLabel('pending')}</option><option value="active">{statusLabel('active')}</option><option value="inactive">{statusLabel('inactive')}</option><option value="blocked">{statusLabel('blocked')}</option><option value="unmapped">Unmapped legacy</option></select></label>
      <label style={styles.label}>Verification<select style={styles.input} value={verified} onChange={(e) => { setVerified(e.target.value); setPage(1); }}><option value="">All</option><option value="true">Verified</option><option value="false">Not verified</option></select></label>
      <label style={styles.label}>Sort<select style={styles.input} value={sort} onChange={(e) => setSort(e.target.value)}><option value="merchant_registered_date">Registration date</option><option value="merchant_name">Name</option><option value="merchant_code">Original code</option><option value="merchant_priority">Priority</option><option value="merchant_commission_value">Commission</option><option value="merchant_discount_value">Discount</option></select></label>
      <button style={styles.secondaryButton} type="button" onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}>{direction === 'asc' ? 'Ascending ↑' : 'Descending ↓'}</button><button style={styles.primaryButton} type="submit">Apply</button>
    </form>

    <div style={styles.listWrapper}>{items.length > 0 && <ul data-testid="merchant-list" className="divide-y divide-line" style={{ margin: 0, padding: 0, listStyle: 'none' }}>{items.map((merchant) => <MerchantListRow key={merchant.merchant_system_id} merchant={merchant} onOpen={() => void openDetail(merchant)} />)}</ul>}{loading && <div style={styles.state}>Loading merchants…</div>}{!loading && !items.length && <div style={styles.state}>No merchants match the filters.</div>}</div>
    <div style={styles.pagination}><span>Page {directory?.page || 1}/{Math.max(directory?.page_count || 1, 1)}</span><div style={styles.actions}><select style={styles.inputInline} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select><button style={styles.secondaryButton} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button style={styles.secondaryButton} disabled={!directory || page >= directory.page_count} onClick={() => setPage(page + 1)}>Next</button></div></div>

    {detail && editing && <div style={styles.overlay} onClick={closeEditor}><aside data-testid="merchant-editor" aria-label="Edit merchant" style={styles.drawerWide} onClick={(e) => e.stopPropagation()}>
      <div style={styles.stickyHeader}><div style={{ minWidth: 0 }}><p style={styles.eyebrow}>Merchant · {detail.merchant.merchant_code || 'No source code'}</p><h3 data-testid="editor-title" style={styles.drawerTitle}>{detail.merchant.merchant_name || 'Unnamed merchant'}</h3><span style={{ ...styles.badge, ...statusStyle(merchantStatus(detail.merchant)) }}><span data-status={merchantStatus(detail.merchant)} title={merchantStatus(detail.merchant)}>{statusLabel(merchantStatus(detail.merchant))}</span></span> <span className={`rounded-full px-2 py-1 text-xs font-semibold ${verificationLabel(detail.merchant).tone}`}>{verificationLabel(detail.merchant).text}</span>{dirty && <span data-testid="unsaved-flag" style={styles.unsaved}>Unsaved changes</span>}</div>
        <div style={styles.actions}><button type="submit" form="merchant-edit-form" data-testid="save-edit" disabled={actionId === detail.merchant.merchant_system_id || !dirty} style={{ ...styles.primaryButton, opacity: dirty ? 1 : 0.55 }}>{actionId === detail.merchant.merchant_system_id ? 'Saving…' : 'Save'}</button><button type="button" data-testid="cancel-edit" style={styles.secondaryButton} onClick={closeEditor}>Cancel</button><button type="button" data-testid="close-editor" style={styles.close} aria-label="Close" onClick={closeEditor}>×</button></div></div>
      {editError && <div role="alert" data-testid="edit-error" style={styles.error}>{editError}</div>}
      {savedNote && !editError && <div role="status" data-testid="save-notice" style={styles.savedNote}>{savedNote}</div>}
      <MerchantHero media={detail.media} name={detail.merchant.merchant_name || 'merchant'} />
      <div style={{ ...styles.actions, marginTop: 14 }}>{isPublic(detail.merchant)
        ? <a data-testid="view-on-vno" href={`/merchants/${detail.merchant.merchant_system_id}`} target="_blank" rel="noreferrer" style={{ ...styles.secondaryButton, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>View on VNO <ExternalLink aria-hidden="true" size={14} /></a>
        : <button type="button" data-testid="view-on-vno" disabled title="Only verified, non-banned merchants are published on VNO" style={{ ...styles.secondaryButton, opacity: 0.55, cursor: 'not-allowed' }}>View on VNO</button>}
        {merchantStatus(detail.merchant) === 'pending' && <><button type="button" disabled={actionId === detail.merchant.merchant_system_id} onClick={() => runAction(detail.merchant, 'approve')} style={styles.approveButton}>Approve</button><button type="button" disabled={actionId === detail.merchant.merchant_system_id} onClick={() => runAction(detail.merchant, 'reject')} style={styles.dangerButton}>Reject</button></>}
        {merchantStatus(detail.merchant) === 'active' && <button type="button" disabled={actionId === detail.merchant.merchant_system_id} onClick={() => runAction(detail.merchant, 'deactivate')} style={styles.dangerButton}>Deactivate</button>}</div>
      <p style={styles.muted}>{isPublic(detail.merchant) ? 'This merchant is published on VNO.' : 'Not published on VNO yet: only verified, non-banned merchants appear on the public site. Edits are still saved.'} Fields tagged <PublicTag /> appear on the public merchant page; <PrivateTag /> fields never do.</p>

      <form id="merchant-edit-form" data-testid="merchant-edit" aria-label="Merchant fields" onSubmit={saveMerchant} style={{ marginTop: 8 }}>
        <EditGroup title="Public profile"><div style={styles.formGrid}>
          <Field label="Store / service name" tag="public" testId="field-name" required value={editing.merchant_name} onChange={(v) => setEditing({ ...editing, merchant_name: v })} />
          <Field label="Business phone" tag="public" testId="field-contact-phone" hint="The phone number customers see and can call from VNO." value={editing.merchant_contact_phone} onChange={(v) => setEditing({ ...editing, merchant_contact_phone: v })} />
          <label style={{ ...styles.label, gridColumn: '1 / -1' }}>Description (Giới thiệu) <PublicTag /><textarea data-testid="field-description" aria-label="Description (Giới thiệu)" style={{ ...styles.input, minHeight: 160, resize: 'vertical', lineHeight: 1.45 }} maxLength={20000} value={editing.merchant_description} onChange={(e) => setEditing({ ...editing, merchant_description: e.target.value })} placeholder="Giới thiệu về nhà cung cấp…" />
            <span style={styles.muted} data-testid="description-hint">{editing.merchant_description.trim() ? `${editing.merchant_description.length.toLocaleString('vi-VN')} / 20.000 characters · line breaks are kept.` : 'Empty: VNO shows “Nhà cung cấp chưa cập nhật phần giới thiệu.”'}</span></label>
          <label style={styles.label}>Description format<select data-testid="field-description-format" style={styles.input} value={editing.merchant_description_format} onChange={(e) => setEditing({ ...editing, merchant_description_format: e.target.value as 'plain_text' | 'markdown' })}><option value="plain_text">Plain text (shown exactly as typed)</option><option value="markdown">Markdown source (symbols removed on VNO)</option></select></label>
          <fieldset style={{ ...styles.categoryFieldset, gridColumn: '1 / -1' }}><legend>Categories <PublicTag /> ({editing.category_ids.length}/3)</legend><p style={styles.muted}>New selections are limited to 3 distinct categories. Historical associations above the limit remain unchanged unless this selection is edited.</p>{categories.map((category) => { const checked = editing.category_ids.includes(category.id); return <label key={category.id} style={styles.categoryOption}><input type="checkbox" checked={checked} disabled={!checked && editing.category_ids.length >= 3} onChange={(e) => setEditing({ ...editing, category_ids: e.target.checked ? [...editing.category_ids, category.id] : editing.category_ids.filter((id) => id !== category.id) })} /> {category.category_name_vi || category.category_name || category.id}</label>; })}</fieldset>
        </div></EditGroup>

        <EditGroup title="Address & location"><div style={styles.formGrid}>
          <Field label="Street address" tag="public" testId="field-address-line" value={editing.new_address_line} onChange={(v) => setEditing({ ...editing, new_address_line: v })} />
          <Field label="Ward" tag="public" testId="field-address-ward" value={editing.new_address_ward} onChange={(v) => setEditing({ ...editing, new_address_ward: v })} />
          <Field label="City" tag="public" testId="field-address-city" value={editing.new_address_city} onChange={(v) => setEditing({ ...editing, new_address_city: v })} />
          <Field label="District" tag="private" value={editing.new_address_district} onChange={(v) => setEditing({ ...editing, new_address_district: v })} />
          <Field label="Province" tag="private" value={editing.new_address_province} onChange={(v) => setEditing({ ...editing, new_address_province: v })} />
          <Field label="Country" tag="private" value={editing.new_address_country} onChange={(v) => setEditing({ ...editing, new_address_country: v })} />
        </div><p style={styles.muted} data-testid="address-preview">VNO shows: {publicAddress(editing) || 'no address (“Chưa có địa chỉ.”)'}. The map link is built from this address; coordinates are not stored.</p></EditGroup>

        <EditGroup title="Customer offer (discount)"><div style={styles.formGrid}>
          <SelectField label="Discount type" tag="public" testId="field-discount-type" value={editing.merchant_discount_type} onChange={(v) => setEditing({ ...editing, merchant_discount_type: v })} />
          <Field label={editing.merchant_discount_type === 'percentage' ? 'Discount percentage points (0–100)' : 'Discount value (blank preserves null)'} tag="public" testId="field-discount-value" inputMode="decimal" value={editing.merchant_discount_value} onChange={(v) => setEditing({ ...editing, merchant_discount_value: v })} />
        </div><p style={styles.muted} data-testid="offer-preview">VNO shows: {publicOfferPreview(editing.merchant_discount_type, editing.merchant_discount_value) || 'no offer (“Nhà cung cấp hiện chưa công bố ưu đãi.”)'}. The eligibility text on the offer card (introduced by a VNO Partner, QR scanned at the counter) is the same platform rule for every merchant. Offer conditions and validity dates are not stored per merchant.</p></EditGroup>

        <EditGroup title="Photos (applied immediately)"><p style={styles.muted}>Uploading and Set as main take effect right away and are not part of Save / Cancel.</p><MerchantGallery merchantId={detail.merchant.merchant_system_id} media={detail.media} onChanged={refreshDetail} /></EditGroup>

        <EditGroup title="Private contact & owner (not shown on VNO)"><div style={styles.formGrid}>
          <Field label="Merchant e-mail" tag="private" type="email" value={editing.merchant_email} onChange={(v) => setEditing({ ...editing, merchant_email: v })} />
          <Field label="Merchant login phone" tag="private" value={editing.merchant_phone} onChange={(v) => setEditing({ ...editing, merchant_phone: v })} />
          <Field label="Owner name" tag="private" value={editing.owner_name} onChange={(v) => setEditing({ ...editing, owner_name: v })} />
          <Field label="Owner phone" tag="private" value={editing.owner_phone} onChange={(v) => setEditing({ ...editing, owner_phone: v })} />
          <Field label="Owner tax code" tag="private" value={editing.owner_tax_code} onChange={(v) => setEditing({ ...editing, owner_tax_code: v })} />
          <dl style={{ margin: 0 }}><Detail label="Owner e-mail / identity (read-only)" value={detail.merchant.owner_email} /></dl>
        </div><p style={styles.muted}>Identity e-mail changes require the governed Supabase Auth re-verification flow.</p></EditGroup>

        <EditGroup title="Commission & ranking (admin only)"><div style={styles.formGrid}>
          <SelectField label="Commission type" tag="private" value={editing.merchant_commission_type} onChange={(v) => setEditing({ ...editing, merchant_commission_type: v })} />
          <Field label={editing.merchant_commission_type === 'percentage' ? 'Commission percentage points (0–100)' : 'Commission value (blank preserves null)'} tag="private" inputMode="decimal" value={editing.merchant_commission_value} onChange={(v) => setEditing({ ...editing, merchant_commission_value: v })} />
          <Field label="Priority" tag="private" type="number" value={editing.merchant_priority} onChange={(v) => setEditing({ ...editing, merchant_priority: v })} />
        </div><p style={styles.muted}>Commission applies to future transactions only; recorded transactions keep their stored values.</p></EditGroup>

        <EditGroup title="Verification & administration"><div style={styles.formGrid}><label style={styles.label}>Status<select style={styles.input} value={editing.merchants_status} onChange={(e) => setEditing({ ...editing, merchants_status: e.target.value })}><option value="">Unmapped / preserve null</option><option value="pending">{statusLabel('pending')}</option><option value="active">{statusLabel('active')}</option><option value="inactive">{statusLabel('inactive')}</option><option value="blocked">{statusLabel('blocked')}</option></select></label><label style={styles.checkbox}><input type="checkbox" checked={editing.merchant_verified} onChange={(e) => setEditing({ ...editing, merchant_verified: e.target.checked })} /> Verified</label><Field label="Admin action note" value={editing.merchant_action} onChange={(v) => setEditing({ ...editing, merchant_action: v })} /></div><p style={styles.muted}>Only the fields you change are sent when you press Save, so these are never overwritten by an unrelated edit.</p></EditGroup>
      </form>

      <Section title="Account Invitation">{invitation === undefined ? <p style={styles.sectionNote}>Loading…</p> : invitation && (invitation.status as string) === 'pending' ? (<><p style={styles.sectionNote}>A pending invitation exists for this merchant&apos;s owner email.</p><dl style={styles.detailsGrid}><Detail label="Invited email" value={invitation.owner_email as string} /><Detail label="Expires" value={formatDate(invitation.expires_at as string)} /><Detail label="Status" value={invitation.status as string} /></dl><div style={{ marginTop: 12, padding: 12, background: '#fef3c7', borderRadius: 8 }}><p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 13 }}>UAT mail-capture: one-time invite link</p><code style={{ fontSize: 11, wordBreak: 'break-all', color: '#92400e' }}>{invitation.invite_link ? String(invitation.invite_link) : invitation.delivery === 'email' ? 'Invitation e-mail handed to the mail service (delivery to the inbox is not confirmed). If the recipient does not receive it, revoke and re-invite.' : 'The one-time sign-in link is shown only at creation and is not stored. Revoke and re-invite to issue a new one.'}</code></div><div style={{ ...styles.actions, marginTop: 12 }}><button style={styles.dangerButton} disabled={inviteBusy} onClick={() => void revokeInvitation(String(invitation.id))}>Revoke invitation</button></div></>) : (<><p style={styles.sectionNote}>{invitation ? `Last invitation status: ${invitation.status as string}. Create a new one to re-invite.` : 'No invitation exists. Use Invite to generate a claim link for the owner.'}</p>{inviteError && <p style={{ color: '#991b1b', fontSize: 13, marginBottom: 8 }}>{inviteError}</p>}<button style={styles.primaryButton} disabled={inviteBusy} onClick={() => void createInvitation(detail.merchant.merchant_system_id)}>{inviteBusy ? 'Sending…' : 'Invite owner to claim account'}</button></>)}</Section>
      <Section title={`Legacy Data & Audit History (${detail.update_requests.length} update requests)`}><dl style={styles.detailsGrid}><Detail label="V2 system ID" value={detail.merchant.merchant_system_id} /><Detail label="Legacy restaurant ID" value={detail.merchant.legacy_restaurant_id} /><Detail label="Source status" value={value(detail.merchant.legacy_status)} /><Detail label="Source banned flag" value={detail.merchant.legacy_is_banned === null || detail.merchant.legacy_is_banned === undefined ? '—' : String(detail.merchant.legacy_is_banned)} /><Detail label="Historical tax code" value={detail.merchant.legacy_tax_code} /><Detail label="Source rating" value={value(detail.merchant.legacy_rating)} /><Detail label="Short name" value={detail.merchant.legacy_short_name} /><Detail label="Last source update request" value={formatDate(detail.merchant.legacy_last_update_request_at)} /></dl>{detail.update_requests.length ? <details style={styles.historyDisclosure}><summary>Open complete update-request history</summary>{detail.update_requests.map((request) => <div key={request.id} style={styles.historyItem}><strong>{formatDate(request.requested_at)}</strong><span>{request.request_source || 'legacy'} · {request.request_status || 'legacy preserved'} · source status {request.legacy_status ?? 'null'}</span><span>Requested name: {value(request.payload?.Name)}</span><span>Requested commission: {value(request.payload?.CommissionPerc)}</span><span>Requested discount: {value(request.payload?.DiscountPerc)}</span>{request.decision_reason && <span>Decision: {request.decision_reason}</span>}</div>)}</details> : <p style={styles.emptyState}>No update requests.</p>}</Section>
    </aside></div>}

    {showCreate && <div style={styles.overlay} onClick={() => setShowCreate(false)}><form style={{ ...styles.modal, width: 'min(700px,calc(100% - 32px))' }} onSubmit={createMerchant} onClick={(e) => e.stopPropagation()}><div style={styles.drawerHeader}><h3 style={styles.drawerTitle}>Create pending merchant</h3><button type="button" style={styles.close} onClick={() => setShowCreate(false)}>×</button></div>
      <fieldset style={styles.editGroup}><legend style={styles.editLegend}>Business Information</legend><div style={styles.formGrid}><Field label="Merchant name" required value={createForm.merchant_name} onChange={(v) => setCreateForm({ ...createForm, merchant_name: v })} /><Field label="Business email" type="email" value={createForm.merchant_email} onChange={(v) => setCreateForm({ ...createForm, merchant_email: v })} /><Field label="Business phone" value={createForm.merchant_phone} onChange={(v) => setCreateForm({ ...createForm, merchant_phone: v })} /><Field label="Contact phone" value={createForm.merchant_contact_phone} onChange={(v) => setCreateForm({ ...createForm, merchant_contact_phone: v })} /></div><label style={{ ...styles.label, marginTop: 8, display: 'block' }}>Description<textarea style={{ ...styles.input, minHeight: 72 }} value={createForm.merchant_description} onChange={(e) => setCreateForm({ ...createForm, merchant_description: e.target.value })} /></label></fieldset>
      <fieldset style={styles.editGroup}><legend style={styles.editLegend}>Owner Information</legend><div style={styles.formGrid}><Field label="Owner email" required type="email" value={createForm.owner_email} onChange={(v) => setCreateForm({ ...createForm, owner_email: v })} /><Field label="Owner name" value={createForm.owner_name} onChange={(v) => setCreateForm({ ...createForm, owner_name: v })} /><Field label="Owner phone" value={createForm.owner_phone} onChange={(v) => setCreateForm({ ...createForm, owner_phone: v })} /><Field label="Owner tax code" value={createForm.owner_tax_code} onChange={(v) => setCreateForm({ ...createForm, owner_tax_code: v })} /></div></fieldset>
      <fieldset style={styles.editGroup}><legend style={styles.editLegend}>Location</legend><div style={styles.formGrid}><Field label="Country" value={createForm.new_address_country} onChange={(v) => setCreateForm({ ...createForm, new_address_country: v })} /><Field label="Province" value={createForm.new_address_province} onChange={(v) => setCreateForm({ ...createForm, new_address_province: v })} /><Field label="District" value={createForm.new_address_district} onChange={(v) => setCreateForm({ ...createForm, new_address_district: v })} /><Field label="City" value={createForm.new_address_city} onChange={(v) => setCreateForm({ ...createForm, new_address_city: v })} /><Field label="Ward" value={createForm.new_address_ward} onChange={(v) => setCreateForm({ ...createForm, new_address_ward: v })} /><Field label="Street address" value={createForm.new_address_line} onChange={(v) => setCreateForm({ ...createForm, new_address_line: v })} /></div></fieldset>
      <fieldset style={styles.editGroup}><legend style={styles.editLegend}>Commercial Rates</legend><div style={styles.formGrid}><SelectField label="Commission type" value={createForm.merchant_commission_type} onChange={(v) => setCreateForm({ ...createForm, merchant_commission_type: v })} /><Field label={createForm.merchant_commission_type === 'percentage' ? 'Commission % points (0–100)' : 'Commission value'} inputMode="decimal" value={createForm.merchant_commission_value} onChange={(v) => setCreateForm({ ...createForm, merchant_commission_value: v })} /><SelectField label="Discount type" value={createForm.merchant_discount_type} onChange={(v) => setCreateForm({ ...createForm, merchant_discount_type: v })} /><Field label={createForm.merchant_discount_type === 'percentage' ? 'Discount % points (0–100)' : 'Discount value'} inputMode="decimal" value={createForm.merchant_discount_value} onChange={(v) => setCreateForm({ ...createForm, merchant_discount_value: v })} /></div><p style={styles.muted}>Rates remain null until explicitly set. Only Admin may set commercial rates.</p></fieldset>
      <fieldset style={{ ...styles.categoryFieldset, marginBottom: 16 }}><legend>Categories ({createForm.category_ids.length}/3)</legend>{categories.map((cat) => { const checked = createForm.category_ids.includes(cat.id); return <label key={cat.id} style={styles.categoryOption}><input type="checkbox" checked={checked} disabled={!checked && createForm.category_ids.length >= 3} onChange={(e) => setCreateForm({ ...createForm, category_ids: e.target.checked ? [...createForm.category_ids, cat.id] : createForm.category_ids.filter((id) => id !== cat.id) })} /> {cat.category_name_vi || cat.category_name || cat.id}</label>; })}</fieldset>
      <p style={styles.muted}>Account assignment and activation are separate governed actions after creation.</p>
      <button style={styles.primaryButton} type="submit">Create pending merchant</button></form></div>}
  </div>;
}

function toEdit(detail: OperationalDetail): EditForm { const m = detail.merchant; return { merchant_name: m.merchant_name || '', merchant_description: m.merchant_description || '', merchant_description_format: m.merchant_description_format || 'plain_text', merchant_phone: m.merchant_phone || '', merchant_email: m.merchant_email || '', merchant_contact_phone: m.merchant_contact_phone || '', owner_name: m.owner_name || '', owner_phone: m.owner_phone || '', owner_tax_code: m.owner_tax_code || '', new_address_country: m.new_address_country || '', new_address_province: m.new_address_province || '', new_address_district: m.new_address_district || '', new_address_city: m.new_address_city || '', new_address_ward: m.new_address_ward || '', new_address_line: m.new_address_line || '', category_ids: detail.categories.map((row) => row.category_id).filter((id): id is string => Boolean(id)), merchant_commission_type: m.merchant_commission_type || '', merchant_commission_value: commercialValueForForm(m.merchant_commission_type, m.merchant_commission_value), merchant_discount_type: m.merchant_discount_type || '', merchant_discount_value: commercialValueForForm(m.merchant_discount_type, m.merchant_discount_value), merchant_priority: m.merchant_priority === null || m.merchant_priority === undefined ? '' : String(m.merchant_priority), merchant_verified: Boolean(m.merchant_verified), merchants_status: m.merchants_status || '', merchant_action: m.merchant_action || '' }; }
function sameCategoryIds(left: string[], right: string[]) { const sortedRight = [...right].sort(); return left.length === sortedRight.length && [...left].sort().every((id, index) => id === sortedRight[index]); }
type FieldTag = 'public' | 'private';
function PublicTag() { return <span style={styles.publicTag}>Shown on VNO</span>; }
function PrivateTag() { return <span style={styles.privateTag}>Private</span>; }
const tagOf = (tag?: FieldTag) => tag === 'public' ? <PublicTag /> : tag === 'private' ? <PrivateTag /> : null;
function Field({ label, value: current, onChange, type = 'text', required = false, inputMode, tag, testId, hint }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; inputMode?: 'decimal'; tag?: FieldTag; testId?: string; hint?: string }) { return <label style={styles.label}>{label} {tagOf(tag)}<input data-testid={testId} style={styles.input} type={type} required={required} inputMode={inputMode} value={current} onChange={(e) => onChange(e.target.value)} />{hint && <span style={styles.muted}>{hint}</span>}</label>; }
function SelectField({ label, value: current, onChange, tag, testId }: { label: string; value: string; onChange: (value: string) => void; tag?: FieldTag; testId?: string }) { return <label style={styles.label}>{label} {tagOf(tag)}<select data-testid={testId} style={styles.input} value={current} onChange={(e) => onChange(e.target.value)}><option value="">Not set</option><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></label>; }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section style={styles.section}><h4 style={styles.sectionTitle}>{title}</h4>{children}</section>; }
function EditGroup({ title, children }: { title: string; children: React.ReactNode }) { return <fieldset style={styles.editGroup}><legend style={styles.editLegend}>{title}</legend>{children}</fieldset>; }
function Detail({ label, value: current }: { label: string; value?: string | null }) { return <div style={styles.detailRow}><dt style={styles.detailLabel}>{label}</dt><dd style={styles.detailValue}>{current || '—'}</dd></div>; }
function isPublic(m: Merchant) { return Boolean(m.merchant_verified) && m.legacy_is_banned !== true; }
function merchantStatus(m: Merchant) { return m.merchants_status?.toLowerCase() || 'unmapped'; }
function statusStyle(status: string): React.CSSProperties { if (status === 'active') return { background: '#d1fae5', color: '#065f46' }; if (status === 'pending') return { background: '#fef3c7', color: '#92400e' }; return { background: '#fee2e2', color: '#991b1b' }; }
function commercial(type?: string | null, amount?: string | number | null) { if (amount === null || amount === undefined || amount === '') return 'Not set'; return type === 'percentage' ? `${fractionToPercentagePoints(amount)}%` : type === 'fixed' ? `${amount} VND` : `${amount} (${type || 'type unknown'})`; }
function commercialValueForForm(type?: string | null, value?: string | number | null) { if (value === null || value === undefined || value === '') return ''; return type === 'percentage' ? fractionToPercentagePoints(value) : String(value); }
function commercialValueForApi(type: string, value: string) { if (!value.trim()) return null; return type === 'percentage' ? percentagePointsToFraction(value) : value.trim(); }
function formatDate(input?: string | null) { if (!input) return '—'; const parsed = new Date(input); return Number.isNaN(parsed.getTime()) ? input : parsed.toLocaleString('vi-VN'); }
function value(input: unknown) { return input === null || input === undefined || input === '' ? '—' : String(input); }
/** Mirrors backend publicOffer(): what customers will read on the merchant page for these draft values. */
function publicOfferPreview(type: string, raw: string) {
  const n = Number(raw.trim().replace(',', '.'));
  if (!raw.trim() || !Number.isFinite(n) || n <= 0) return null;
  if (type === 'percentage') { const pct = Math.round(n * 10) / 10; return pct > 0 && pct <= 100 ? `Giảm ${String(pct).replace('.', ',')}%` : null; }
  if (type === 'fixed') return `Giảm ${new Intl.NumberFormat('vi-VN').format(n)} đ`;
  return null;
}
/** Mirrors backend addressLine(): street, ward, city. */
function publicAddress(form: EditForm) { return [form.new_address_line, form.new_address_ward, form.new_address_city].map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean).join(', '); }
/** Only the fields the Admin actually changed are sent, so an unrelated edit can never overwrite status, verification, commission or owner data. */
function buildPayload(draft: EditForm, saved: EditForm) {
  const out: Record<string, unknown> = {};
  const changed = (key: keyof EditForm) => JSON.stringify(draft[key]) !== JSON.stringify(saved[key]);
  const nullable = (v: string) => v.trim() === '' ? null : v.trim();
  if (changed('merchant_name')) { if (!draft.merchant_name.trim()) throw new Error('Merchant name is required'); out.merchant_name = draft.merchant_name.trim(); }
  for (const key of ['merchant_description', 'merchant_phone', 'merchant_email', 'merchant_contact_phone', 'owner_name', 'owner_phone', 'owner_tax_code', 'new_address_country', 'new_address_province', 'new_address_district', 'new_address_city', 'new_address_ward', 'new_address_line', 'merchant_action'] as const) {
    if (changed(key)) out[key] = nullable(draft[key]);
  }
  if (changed('merchant_description_format')) out.merchant_description_format = draft.merchant_description_format;
  for (const prefix of ['merchant_commission', 'merchant_discount'] as const) {
    const type = `${prefix}_type` as const, amount = `${prefix}_value` as const;
    if (changed(type) || changed(amount)) { out[type] = nullable(draft[type]); out[amount] = commercialValueForApi(draft[type], draft[amount]); }
  }
  if (changed('merchant_priority')) out.merchant_priority = draft.merchant_priority.trim() === '' ? null : Number(draft.merchant_priority);
  if (changed('merchant_verified')) out.merchant_verified = draft.merchant_verified;
  if (changed('merchants_status') && draft.merchants_status) out.merchants_status = draft.merchants_status;
  if (!sameCategoryIds(draft.category_ids, saved.category_ids)) out.category_ids = draft.category_ids;
  return out;
}
function message(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }

const styles: Record<string, React.CSSProperties> = {
  stickyHeader: { position: 'sticky', top: -24, zIndex: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', margin: '-24px calc(-1 * clamp(18px,4vw,40px)) 12px', padding: '16px clamp(18px,4vw,40px) 12px', background: '#fff', borderBottom: '1px solid #e2e8f0' },
  unsaved: { marginLeft: 8, padding: '3px 8px', borderRadius: 999, background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 700 },
  savedNote: { margin: '0 0 12px', padding: '9px 12px', borderRadius: 8, background: '#d1fae5', color: '#065f46', fontSize: 13 },
  publicTag: { marginLeft: 6, padding: '1px 7px', borderRadius: 999, background: '#ccfbf1', color: '#115e59', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' },
  privateTag: { marginLeft: 6, padding: '1px 7px', borderRadius: 999, background: '#f1f5f9', color: '#64748b', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' },
  container: { maxWidth: 1500, display: 'grid', gap: 16 }, header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }, title: { margin: 0, color: '#0f172a', fontSize: 25 }, subtitle: { color: '#64748b', margin: '6px 0 0' }, error: { color: '#991b1b', background: '#fee2e2', borderRadius: 10, padding: 14 },
  filters: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', alignItems: 'end', gap: 10, padding: 16, border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }, label: { display: 'block', color: '#475569', fontSize: 12, fontWeight: 700 }, input: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '9px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }, inputInline: { padding: '8px 9px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }, checkbox: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 38, color: '#334155', fontSize: 13 },
  primaryButton: { border: 0, borderRadius: 8, padding: '9px 13px', cursor: 'pointer', color: '#fff', background: '#0f766e' }, secondaryButton: { border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 11px', cursor: 'pointer', color: '#334155', background: '#fff' }, approveButton: { border: 0, borderRadius: 8, padding: '8px 11px', cursor: 'pointer', color: '#fff', background: '#16a34a' }, dangerButton: { border: 0, borderRadius: 8, padding: '8px 11px', cursor: 'pointer', color: '#fff', background: '#dc2626' },
  listWrapper: { overflow: 'hidden', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }, muted: { color: '#64748b', fontSize: 12, marginTop: 4 }, badge: { display: 'inline-block', padding: '4px 9px', borderRadius: 999, fontSize: 11, fontWeight: 750 }, actions: { display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }, state: { padding: 36, textAlign: 'center', color: '#64748b' }, pagination: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, color: '#64748b', fontSize: 13 },
  overlay: { position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end', background: 'rgba(15,23,42,.48)' }, drawer: { width: 'min(680px,100%)', height: '100%', overflow: 'auto', boxSizing: 'border-box', padding: 24, background: '#fff', boxShadow: '-12px 0 32px rgba(15,23,42,.18)' }, drawerWide: { width: 'min(920px,100%)', height: '100%', overflow: 'auto', boxSizing: 'border-box', padding: '24px clamp(18px,4vw,40px)', background: '#fff', boxShadow: '-12px 0 32px rgba(15,23,42,.18)' }, modal: { width: 'min(560px,calc(100% - 32px))', maxHeight: '90vh', overflow: 'auto', alignSelf: 'center', margin: 'auto', borderRadius: 14, padding: 24, background: '#fff' }, drawerHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20 }, drawerTitle: { margin: '0 0 8px', fontSize: 22 }, eyebrow: { margin: '0 0 5px', color: '#0f766e', fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }, close: { border: 0, background: 'transparent', color: '#475569', fontSize: 28, lineHeight: 1, cursor: 'pointer' }, section: { marginTop: 18, padding: 18, border: '1px solid #e2e8f0', borderRadius: 14, background: '#fff' }, sectionTitle: { margin: '0 0 14px', color: '#0f172a', fontSize: 16 }, sectionNote: { color: '#64748b', fontSize: 12, margin: '-5px 0 14px' }, details: { margin: 0, display: 'grid', gap: 9 }, detailsGrid: { margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: '8px 28px' }, detailRow: { display: 'grid', gridTemplateColumns: 'minmax(100px,140px) minmax(0,1fr)', gap: 12, paddingBottom: 8 }, detailLabel: { color: '#64748b', fontWeight: 650 }, detailValue: { margin: 0, overflowWrap: 'anywhere' }, description: { marginTop: 12, borderRadius: 10, background: '#f8fafc', padding: 13, color: '#334155', whiteSpace: 'pre-wrap' }, historyItem: { display: 'grid', gap: 3, padding: 12, margin: '8px 0', border: '1px solid #e2e8f0', borderRadius: 9, color: '#334155', fontSize: 13 }, historyDisclosure: { marginTop: 12, color: '#334155', cursor: 'pointer' }, emptyState: { margin: 0, padding: 18, borderRadius: 10, background: '#f8fafc', color: '#64748b', textAlign: 'center' }, formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 12, marginBottom: 4 }, editGroup: { margin: '0 0 16px', padding: 16, border: '1px solid #e2e8f0', borderRadius: 12 }, editLegend: { padding: '0 8px', color: '#0f172a', fontWeight: 800 },
  categoryFieldset: { border: '1px solid #cbd5e1', borderRadius: 8, padding: 12 }, categoryOption: { display: 'inline-flex', alignItems: 'center', gap: 5, margin: '4px 14px 4px 0', fontSize: 13 },
};
