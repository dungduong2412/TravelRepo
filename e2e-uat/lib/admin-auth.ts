import { config } from './env';

/**
 * Test-only Supabase Auth admin helper. It needs the UAT service-role key, which is injected by `railway run --service vno-api`
 * and is never written to disk or printed (it is registered under an E2E_*TOKEN* name so redact() masks it).
 * Links created here bypass the e-mail hook on purpose: they prove the APP behaviour (token handling, sessions, wrong-account safety)
 * without a mailbox. They do NOT prove mail delivery; that is verified separately from the hook's send log and the owner's mailbox.
 */
function serviceKey(): string {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing: run through `railway run --service vno-api -- npx playwright test ...`');
  process.env.E2E_ADMIN_SERVICE_TOKEN = k;
  return k;
}

async function admin(path: string, init: RequestInit = {}) {
  const k = serviceKey();
  const r = await fetch(`${config().supabase}/auth/v1${path}`, {
    ...init, headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text(); let body: any = text; try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: r.status, body };
}

export type IssuedLink = { userId: string; tokenHash: string };

/** Issues a recovery token without sending mail. Each call supersedes the previous token for that user (by design in Auth). */
export async function issueRecoveryToken(email: string): Promise<IssuedLink> {
  const r = await admin('/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'recovery', email }) });
  if (r.status >= 300) throw new Error(`generate_link recovery failed: HTTP ${r.status} ${r.body?.error_code ?? ''}`);
  const tokenHash = r.body.hashed_token ?? r.body.properties?.hashed_token;
  process.env[`E2E_TOKEN_RECOVERY_${Date.now()}`] = tokenHash;
  return { userId: r.body.id ?? r.body.user?.id, tokenHash };
}

/** Creates an unconfirmed user with a signup token (no mail). Returns the token hash to open /auth/confirm with. */
export async function issueSignupToken(email: string, password: string, data?: Record<string, unknown>): Promise<IssuedLink> {
  const r = await admin('/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'signup', email, password, ...(data ? { data } : {}) }) });
  if (r.status >= 300) throw new Error(`generate_link signup failed: HTTP ${r.status} ${r.body?.error_code ?? ''}`);
  const tokenHash = r.body.hashed_token ?? r.body.properties?.hashed_token;
  process.env[`E2E_TOKEN_SIGNUP_${Date.now()}`] = tokenHash;
  return { userId: r.body.id ?? r.body.user?.id, tokenHash };
}

export async function setPasswordAsAdmin(userId: string, password: string) {
  const r = await admin(`/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify({ password }) });
  if (r.status >= 300) throw new Error(`admin set password failed: HTTP ${r.status}`);
}

export async function getUserAsAdmin(userId: string) {
  return (await admin(`/admin/users/${userId}`)).body as { id: string; email: string; email_confirmed_at: string | null };
}

export async function deleteUserAsAdmin(userId: string) {
  return (await admin(`/admin/users/${userId}`, { method: 'DELETE' })).status;
}

/** Plain password grant, used to prove which password currently works. Returns HTTP status only. */
export async function passwordGrantStatus(email: string, password: string, anon: string): Promise<number> {
  const r = await fetch(`${config().supabase}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  return r.status;
}

/** Tries to spend a token_hash directly against Auth (no browser). Used to prove a consumed token is dead. */
export async function verifyTokenStatus(tokenHash: string, type: 'recovery' | 'signup', anon: string): Promise<{ status: number; code: string }> {
  const r = await fetch(`${config().supabase}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ token_hash: tokenHash, type }),
  });
  const b: any = await r.json().catch(() => ({}));
  return { status: r.status, code: String(b.error_code ?? b.code ?? '') };
}

/** A user the way the OLD two-step signup left it: Auth identity with a password, e-mail confirmed, no profile or Partner record. Test-only. */
export async function createConfirmedUserAsAdmin(email: string, password: string, userMetadata: Record<string, unknown> = {}): Promise<string> {
  const r = await admin('/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true, user_metadata: userMetadata }) });
  if (r.status >= 300) throw new Error(`admin create user failed: HTTP ${r.status} ${r.body?.error_code ?? ''}`);
  return r.body.id as string;
}

/** Full Auth record (metadata included) for assertions. */
export async function getAuthUser(userId: string) {
  return (await admin(`/admin/users/${userId}`)).body as { id: string; email: string; email_confirmed_at: string | null; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown>; last_sign_in_at: string | null; identities?: unknown[] };
}

/**
 * Stands in for "the activation e-mail arrived": records a nonce on the account (exactly what the API does when it sends the mail) so a link
 * signed with the same server secret is current. The mail itself is not sent (synthetic domain, delivery policy).
 */
export async function setActivationNonceAsAdmin(userId: string, nonce: string) {
  const user = await getAuthUser(userId);
  const r = await admin(`/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify({ app_metadata: { ...(user.app_metadata || {}), activation_nonce: nonce } }) });
  if (r.status >= 300) throw new Error(`admin set nonce failed: HTTP ${r.status}`);
}
