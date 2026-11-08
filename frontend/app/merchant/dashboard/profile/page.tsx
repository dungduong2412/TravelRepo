"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { describeApiError, fieldErrorsOf } from '../../../../lib/api-errors';
import { fractionToPercentagePoints } from '../../../../lib/rates';
import { buildPatch, FIELD_LABEL, FieldName, formFieldOf, legacyProblems, ProfileForm, savedMessage } from '../../../../lib/merchant-profile';
import MediaManager from '../../../../components/MediaManager';

const EMPTY: ProfileForm = {
  merchant_name: '', merchant_email: '', merchant_phone: '', merchant_contact_phone: '', merchant_description: '', merchant_description_format: 'plain_text',
  owner_name: '', owner_phone: '', owner_tax_code: '', new_address_country: '', new_address_province: '', new_address_district: '', new_address_city: '', new_address_ward: '', new_address_line: '',
  category_ids: [], discount_pct: '', commission_pct: '',
};

const formFrom = (data: any): ProfileForm => ({
  merchant_name: data.merchant_name || '', merchant_email: data.merchant_email || '', merchant_phone: data.merchant_phone || '', merchant_contact_phone: data.merchant_contact_phone || '',
  merchant_description: data.merchant_description || '', merchant_description_format: data.merchant_description_format || 'plain_text',
  owner_name: data.owner_name || '', owner_phone: data.owner_phone || '', owner_tax_code: data.owner_tax_code || '',
  new_address_country: data.new_address_country || '', new_address_province: data.new_address_province || '', new_address_district: data.new_address_district || '', new_address_city: data.new_address_city || '',
  new_address_ward: data.new_address_ward || '', new_address_line: data.new_address_line || '',
  category_ids: data.category_ids || [],
  discount_pct: data.merchant_discount_type === 'percentage' && data.merchant_discount_value != null ? fractionToPercentagePoints(data.merchant_discount_value) : '',
  commission_pct: data.merchant_commission_type === 'percentage' && data.merchant_commission_value != null ? fractionToPercentagePoints(data.merchant_commission_value) : '',
});

type Errors = Partial<Record<FieldName, string>>;

/**
 * Merchant profile. Saving sends ONLY what the Merchant changed (see lib/merchant-profile.ts): a legacy value that is already invalid, or a field left empty,
 * never blocks an unrelated change. Text, contact, address, categories and the Merchant-owned commercial rates save directly (audited). Photos are different:
 * they are proposals that an Admin approves, handled by the image section below — a pending proposal never affects this save.
 */
export default function MerchantProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'info'; text: string } | null>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [merchant, setMerchant] = useState<any>(null);
  const [formData, setFormData] = useState<ProfileForm>(EMPTY);
  const [loaded, setLoaded] = useState<ProfileForm>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [pendingProposals, setPendingProposals] = useState(0);
  const savingRef = useRef(false);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      const profile = await apiFetch('/user-profiles/me');
      if (!profile?.merchant_id) throw new Error('Tài khoản chưa được liên kết nhà cung cấp');
      const data = await apiFetch(`/merchants/${profile.merchant_id}`);
      setMerchant(data);
      const form = formFrom(data); setFormData(form); setLoaded(form);
    } catch (err) { setError(describeApiError(err, 'Không thể tải thông tin hồ sơ.')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void fetchProfile();
    apiFetch('/categories/active').then(setCategories).catch(() => undefined);
    apiFetch('/media/me').then((rows: any[]) => setPendingProposals((rows || []).filter((r) => r.publication_status === 'pending').length)).catch(() => undefined);
  }, [fetchProfile]);

  const warnings = legacyProblems(loaded);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
    setNotice(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;                      // double click / double tap
    setError(null); setNotice(null);
    if (!merchant?.merchant_system_id) { setError('Không tìm thấy hồ sơ nhà cung cấp.'); return; }
    const patch = buildPatch(loaded, formData);
    if (Object.keys(patch.errors).length) { showErrors(patch.errors); return; }
    if (patch.changed.length === 0) { setNotice({ kind: 'info', text: savedMessage([]) }); return; }
    savingRef.current = true; setSaving(true);
    try {
      await apiFetch(`/merchants/${merchant.merchant_system_id}`, { method: 'PATCH', body: JSON.stringify(patch.payload) });
      await fetchProfile();
      setErrors({}); setNotice({ kind: 'success', text: savedMessage(patch.changed) });
    } catch (err) {
      const fromApi: Errors = {};
      for (const f of fieldErrorsOf(err)) { const field = formFieldOf(f.field); if (field && !fromApi[field]) fromApi[field] = f.message; }
      if (Object.keys(fromApi).length) showErrors(fromApi);
      else setError(describeApiError(err, 'Không thể lưu thay đổi. Hồ sơ chưa bị thay đổi.'));
    } finally { savingRef.current = false; setSaving(false); }
  };

  function showErrors(next: Errors) {
    setErrors(next);
    const first = (Object.keys(next) as FieldName[])[0];
    setError(`Chưa lưu được. Hãy sửa ${(Object.keys(next) as FieldName[]).map((k) => `“${FIELD_LABEL[k]}”`).join(', ')} rồi bấm lưu lại. Các thay đổi khác của bạn vẫn được giữ trên màn hình.`);
    setTimeout(() => document.getElementById(`field-${first}`)?.focus(), 0);
  }

  if (loading && !merchant) return <div style={styles.loading}>Đang tải...</div>;

  /** One labelled input with its own error / legacy warning, wired for screen readers. */
  const field = (name: FieldName, label: string, opts: { required?: boolean; type?: string; hint?: string; placeholder?: string; inputMode?: 'decimal' } = {}) => {
    const err = errors[name]; const warn = !err ? warnings[name] : undefined;
    return (
      <div style={styles.formGroup}>
        <label style={styles.label} htmlFor={`field-${name}`}>{label}{opts.required ? ' *' : ''}</label>
        <input id={`field-${name}`} name={name} type={opts.type || 'text'} inputMode={opts.inputMode} placeholder={opts.placeholder} value={formData[name] as string} onChange={handleChange}
          aria-invalid={err ? true : undefined} aria-describedby={err || warn ? `field-${name}-msg` : undefined} data-testid={`input-${name}`} style={{ ...styles.input, ...(err ? { borderColor: '#dc2626' } : {}) }} />
        {opts.hint && !err && <small style={styles.hint}>{opts.hint}</small>}
        {err && <small id={`field-${name}-msg`} role="alert" data-testid={`error-${name}`} style={{ color: '#b91c1c', fontSize: 13 }}>{err}</small>}
        {warn && <small id={`field-${name}-msg`} data-testid={`warning-${name}`} style={{ color: '#92400e', fontSize: 13 }}>{warn}</small>}
      </div>
    );
  };

  return (
    <div>
      <h1 style={styles.title}>Hồ Sơ Doanh Nghiệp</h1>
      <p style={styles.subtitle}>Quản lý thông tin doanh nghiệp của bạn</p>

      {merchant && !merchant.merchant_verified && (
        <div style={styles.pendingCard}>
          <span style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</span>
          <p style={styles.pendingText}>Tài khoản của bạn đang chờ admin phê duyệt. Sau khi được phê duyệt, bạn có thể bắt đầu nhận đơn hàng.</p>
        </div>
      )}

      <div role="note" data-testid="edit-rules" style={{ ...styles.infoCard, marginBottom: 16, fontSize: 14, lineHeight: 1.6 }}>
        <strong>Thông tin nào lưu ngay, thông tin nào cần duyệt?</strong>
        <div>• <b>Lưu ngay</b> (có ghi nhật ký): thông tin liên hệ, địa chỉ, mô tả, danh mục và tỷ lệ thương mại (áp dụng cho giao dịch mới).</div>
        <div>• <b>Cần Admin duyệt</b>: hình ảnh (xem phần “Hình ảnh doanh nghiệp” bên dưới).</div>
        <div>• <b>Chỉ Admin thay đổi</b>: email chủ sở hữu, mã nhà cung cấp, trạng thái phê duyệt.</div>
        {pendingProposals > 0 && <div data-testid="pending-proposals" style={{ marginTop: 6, color: '#1e40af' }}>Bạn có {pendingProposals} ảnh đang chờ Admin duyệt. Việc này <b>không ảnh hưởng</b> đến việc lưu các thông tin ở trang này.</div>}
      </div>

      <form onSubmit={handleSubmit} style={styles.form} noValidate>
        {merchant && (
          <div style={styles.infoCard}>
            <div style={styles.infoRow}><span style={styles.infoLabel}>Mã Nhà Cung Cấp:</span><span style={styles.infoValue}>{merchant.merchant_code}</span></div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Trạng Thái:</span>
              <span style={{ ...styles.infoValue, color: merchant.merchant_verified ? '#16a34a' : '#f59e0b', fontWeight: 600 }}>{merchant.merchant_verified ? '✓ Đã Phê Duyệt' : '⏳ Chờ Phê Duyệt'}</span>
            </div>
          </div>
        )}

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Thông Tin Chủ Sở Hữu</h2>
          {field('owner_name', 'Họ và Tên Chủ Sở Hữu')}
          <div style={styles.formGroup}><label style={styles.label}>Email Chủ Sở Hữu</label><input value={merchant?.owner_email || ''} readOnly style={{ ...styles.input, background: '#f8fafc' }} /><small style={styles.hint}>Chỉ Admin thay đổi email chủ sở hữu.</small></div>
          {field('owner_phone', 'Số Điện Thoại Chủ Sở Hữu')}
          {field('owner_tax_code', 'Mã Số Thuế Chủ Sở Hữu', { hint: merchant?.legacy_tax_code ? `Mã lịch sử V1 (chỉ đọc): ${merchant.legacy_tax_code}` : undefined })}
        </div>

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Thông Tin Doanh Nghiệp</h2>
          {field('merchant_name', 'Tên Doanh Nghiệp', { required: true })}
          <fieldset style={styles.categoryFieldset} id="field-category_ids" tabIndex={-1}>
            <legend style={styles.label}>Danh Mục ({formData.category_ids.length}/3)</legend>
            <small style={styles.hint}>Chọn tối đa 3 danh mục. Hồ sơ lịch sử có nhiều hơn 3 danh mục được giữ nguyên cho đến khi bạn chủ động thay đổi lựa chọn.</small>
            {categories.map((cat) => {
              const checked = formData.category_ids.includes(cat.id);
              return (
                <label key={cat.id} style={styles.categoryOption}>
                  <input type="checkbox" checked={checked} disabled={!checked && formData.category_ids.length >= 3} onChange={(event) => {
                    setFormData((prev) => ({ ...prev, category_ids: event.target.checked ? [...prev.category_ids, cat.id] : prev.category_ids.filter((id) => id !== cat.id) }));
                    setErrors((p) => ({ ...p, category_ids: undefined })); setNotice(null);
                  }} /> {cat.category_name_vi || cat.category_name}
                </label>
              );
            })}
            {errors.category_ids && <small role="alert" data-testid="error-category_ids" style={{ color: '#b91c1c', fontSize: 13 }}>{errors.category_ids}</small>}
          </fieldset>
          {field('merchant_email', 'Email', { type: 'email', placeholder: 'ten@congty.vn' })}
          {field('merchant_phone', 'Số Điện Thoại', { placeholder: 'Ví dụ: 0901 234 567' })}
          {field('merchant_contact_phone', 'SĐT Liên Hệ')}
          <div style={styles.formGroup}>
            <label style={styles.label} htmlFor="field-merchant_description">Mô Tả</label>
            <select name="merchant_description_format" value={formData.merchant_description_format} onChange={handleChange} style={{ ...styles.input, marginBottom: 8 }} aria-label="Định dạng mô tả">
              <option value="plain_text">Văn bản thường</option><option value="markdown">Markdown</option>
            </select>
            <textarea id="field-merchant_description" name="merchant_description" value={formData.merchant_description} onChange={handleChange} style={{ ...styles.input, ...styles.textarea }} rows={4} />
            {errors.merchant_description && <small role="alert" data-testid="error-merchant_description" style={{ color: '#b91c1c', fontSize: 13 }}>{errors.merchant_description}</small>}
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Địa Chỉ</h2>
          {field('new_address_country', 'Quốc Gia')}
          {field('new_address_province', 'Tỉnh / Thành Phố')}
          {field('new_address_district', 'Quận / Huyện')}
          {field('new_address_city', 'Thành Phố (trường V2 hiện có)')}
          {field('new_address_ward', 'Phường / Xã')}
          {field('new_address_line', 'Địa Chỉ Chi Tiết')}
        </div>

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Điều Khoản Thương Mại</h2>
          <p style={{ color: '#64748b', marginBottom: 20, marginTop: 0 }}>
            Nhập tỷ lệ phần trăm (ví dụ: <strong>10</strong> cho 10%). Để trống nếu chưa muốn thay đổi. Các giao dịch cũ không bị ảnh hưởng khi bạn chỉnh sửa tỷ lệ này.
          </p>
          {field('discount_pct', 'Tỷ lệ Giảm giá cho Khách hàng (%)', { inputMode: 'decimal', placeholder: 'Ví dụ: 5 (tức 5%)', hint: `Phần trăm giảm giá khách được hưởng trên giá trị hoá đơn gốc.${merchant?.merchant_discount_type === 'percentage' && merchant?.merchant_discount_value != null ? ` Hiện tại: ${fractionToPercentagePoints(merchant.merchant_discount_value)}%` : ''}` })}
          {field('commission_pct', 'Tỷ lệ Hoa hồng cho Đối tác (%)', { inputMode: 'decimal', placeholder: 'Ví dụ: 10 (tức 10%)', hint: `Phần trăm hoa hồng Đối tác nhận được trên giá trị hoá đơn gốc.${merchant?.merchant_commission_type === 'percentage' && merchant?.merchant_commission_value != null ? ` Hiện tại: ${fractionToPercentagePoints(merchant.merchant_commission_value)}%` : ''}` })}
        </div>

        <MediaManager title="Hình ảnh doanh nghiệp" />

        {error && <div role="alert" data-testid="profile-error" style={styles.error}>{error}</div>}
        {notice?.kind === 'success' && <div role="status" data-testid="profile-saved" style={styles.success}>✓ {notice.text}</div>}
        {notice?.kind === 'info' && <div role="status" data-testid="profile-nochange" style={{ ...styles.success, background: '#eff6ff', color: '#1e40af' }}>{notice.text}</div>}

        <button type="submit" disabled={saving} data-testid="profile-save" style={styles.submitButton}>{saving ? 'Đang lưu...' : 'Lưu Thay Đổi'}</button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  loading: {
    textAlign: 'center',
    padding: '40px',
    color: '#6b7280',
  },
  title: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#111827',
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#6b7280',
    marginBottom: '32px',
  },
  pendingCard: {
    backgroundColor: '#fffbea',
    border: '2px solid #fcd34d',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '32px',
    textAlign: 'center',
  },
  pendingText: {
    fontSize: '16px',
    color: '#92400e',
  },
  infoCard: {
    backgroundColor: '#f3f4f6',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '24px',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  infoLabel: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#6b7280',
  },
  infoValue: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#111827',
    fontFamily: 'monospace',
  },
  form: {
    maxWidth: '800px',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  cardTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#111827',
    marginBottom: '20px',
  },
  avatarSection: {
    marginBottom: '24px',
  },
  avatarContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
    marginTop: '12px',
  },
  avatarCircle: {
    width: '120px',
    height: '120px',
    borderRadius: '50%',
    overflow: 'hidden',
    border: '3px solid #e5e7eb',
    backgroundColor: '#f9fafb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  avatarPlaceholder: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    backgroundColor: '#f3f4f6',
  },
  avatarUpload: {
    flex: 1,
  },
  uploadButton: {
    display: 'inline-block',
    padding: '10px 20px',
    backgroundColor: '#4f46e5',
    color: 'white',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  uploadHint: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '8px',
  },
  fileInput: {
    display: 'none',
  },
  formGroup: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 500,
    color: '#374151',
    marginBottom: '6px',
  },
  hint: { display: 'block', color: '#64748b', marginTop: '6px' },
  categoryFieldset: { border: '1px solid #d1d5db', borderRadius: '8px', padding: '12px', marginBottom: '16px' },
  categoryOption: { display: 'inline-flex', alignItems: 'center', gap: '6px', margin: '5px 16px 5px 0', fontSize: '14px', color: '#374151' },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  textarea: {
    minHeight: '100px',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  radioGroup: {
    display: 'flex',
    gap: '16px',
    marginTop: '8px',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: '#374151',
  },
  error: {
    padding: '12px',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    color: '#dc2626',
    fontSize: '14px',
    marginBottom: '16px',
  },
  success: {
    padding: '12px',
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '8px',
    color: '#16a34a',
    fontSize: '14px',
    marginBottom: '16px',
  },
  submitButton: {
    padding: '12px 24px',
    backgroundColor: '#FF385C',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
