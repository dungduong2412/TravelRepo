/**
 * Supabase client for frontend authentication
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase URL or Anon Key is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Get the current authenticated user's JWT token
 */
export async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

/**
 * Get the current authenticated user
 */
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Sign in with email and password
 */
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

/**
 * Sign out the current user
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Sign up a new user
 */
export async function signUp(email: string, password: string, role: 'merchant' | 'collaborator', emailRedirectTo: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo,
      data: { requested_role: role },
    },
  });

  if (error) throw error;
  // With e-mail confirmation on, Auth answers a signup for an already-registered address with an obfuscated user that has no identities.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    const duplicate = new Error('User already registered') as Error & { code: string };
    duplicate.code = 'user_already_exists';
    throw duplicate;
  }
  return data;
}

/**
 * Spend an emailed one-time token (token_hash) for the given purpose and return the user the resulting session belongs to.
 * Call only after an explicit user action: mail scanners and prefetchers must not be able to trigger it.
 */
export async function verifyEmailToken(tokenHash: string, type: 'recovery' | 'signup') {
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) throw error;
  if (!data.session || !data.user) {
    const missing = new Error('No session') as Error & { code: string };
    missing.code = 'session_not_found';
    throw missing;
  }
  // Confirm with the Auth server that the session we now hold is the user the token was issued for.
  const { data: current, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!current.user || current.user.id !== data.user.id) {
    await supabase.auth.signOut({ scope: 'local' });
    const mismatch = new Error('Session user mismatch') as Error & { code: string };
    mismatch.code = 'session_not_found';
    throw mismatch;
  }
  return data.user;
}

/**
 * Request a recovery email. Supabase deliberately does not disclose whether
 * an address exists, so callers should always show the same confirmation.
 */
export async function requestPasswordReset(email: string, redirectTo: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) throw error;
}

/**
 * Set a new password for the recovery session established by Supabase Auth.
 */
export async function updateRecoveredPassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}
