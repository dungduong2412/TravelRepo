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
