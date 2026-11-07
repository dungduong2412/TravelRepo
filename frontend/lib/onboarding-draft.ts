/**
 * Onboarding drafts survive the e-mail confirmation round trip, which usually opens a NEW tab (fresh sessionStorage) or another
 * in-app browser. localStorage is shared across tabs; entries expire after 24h. Callers must never store passwords here.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

export function saveDraft(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value })); } catch { /* storage unavailable */ }
}

export function loadDraft<T = unknown>(key: string): T | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (raw && typeof raw.savedAt === 'number' && Date.now() - raw.savedAt <= TTL_MS) return raw.value as T;
    if (raw) localStorage.removeItem(key);
  } catch { /* corrupt draft is ignored */ }
  return null;
}

export function clearDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

export const DRAFT_KEYS = { collaborator: 'vno-collaborator-onboarding-draft', merchant: 'vno-merchant-onboarding-draft' } as const;

/**
 * Normal login of a verified, profile-less account lands on the onboarding page. The person just proved they are this e-mail, so the e-mail
 * remembered in an older local draft must not make that page treat the session as a stranger's. Only the e-mail field changes; no password is stored.
 */
export function adoptDraftEmail(role: keyof typeof DRAFT_KEYS, email: string) {
  const key = DRAFT_KEYS[role];
  if (role === 'collaborator') {
    saveDraft(key, { ...(loadDraft<Record<string, unknown>>(key) || {}), email });
  } else {
    const d = loadDraft<{ formData?: Record<string, unknown> }>(key);
    saveDraft(key, { ...(d || {}), formData: { ...(d?.formData || {}), ownerEmail: email } });
  }
}
