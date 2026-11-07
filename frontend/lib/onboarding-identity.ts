"use client";

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { supabase } from './supabase';

export type OnboardingRole = 'merchant' | 'collaborator';
export type ExistingProfile = { role?: string; user_profiles_status?: string };

/**
 * What the browser's current Supabase session means for an onboarding page.
 *  - anonymous: no e-mail-confirmed session, so the sign-up form is shown.
 *  - ready:     confirmed e-mail, no business profile yet. This is NOT an approved login: it only lets the person submit the profile form.
 *  - existing:  the session already owns a profile (any role/status). It must never be reused to open a second application.
 *  - mismatch:  a session exists but is not the identity this sign-up was started for (other e-mail in the draft, or another requested role).
 */
export type OnboardingIdentity =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'ready'; email: string }
  | { kind: 'existing'; email: string; profile: ExistingProfile }
  | { kind: 'mismatch'; email: string; reason: 'email' | 'role'; expectedEmail?: string; sessionRole?: string };

const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

export const ROLE_LABEL: Record<string, string> = { merchant: 'Nhà cung cấp', collaborator: 'Đối tác', admin: 'Quản trị viên' };
export const dashboardFor = (role?: string) => (role === 'admin' ? '/admin/dashboard' : role === 'merchant' ? '/merchant/dashboard' : role === 'collaborator' ? '/collaborator/dashboard' : '/login');

/** `intendedEmail` returns the e-mail the person typed into this sign-up form (from the local draft), if any. */
export function useOnboardingIdentity(role: OnboardingRole, intendedEmail: () => string | undefined) {
  const [identity, setIdentity] = useState<OnboardingIdentity>({ kind: 'loading' });

  const resolve = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user?.email || !user.email_confirmed_at) { setIdentity({ kind: 'anonymous' }); return; }
    const email = user.email;

    let profile: ExistingProfile | null = null;
    try { profile = (await api.get('/user-profiles/me')) || null; } catch { profile = null; } // empty body = no profile; the API re-checks everything on submit
    if (profile?.role) { setIdentity({ kind: 'existing', email, profile }); return; }

    const expected = intendedEmail();
    if (expected && !same(expected, email)) { setIdentity({ kind: 'mismatch', email, reason: 'email', expectedEmail: expected }); return; }
    const requested = (user.user_metadata as { requested_role?: string } | undefined)?.requested_role;
    if (requested && requested !== role) { setIdentity({ kind: 'mismatch', email, reason: 'role', sessionRole: requested }); return; }
    setIdentity({ kind: 'ready', email });
  }, [role, intendedEmail]);

  useEffect(() => {
    resolve();
    const { data } = supabase.auth.onAuthStateChange(() => { setTimeout(resolve, 0); }); // never await Supabase calls inside this callback
    return () => data.subscription.unsubscribe();
  }, [resolve]);

  /** Leave the current session (this browser only) so a different identity can sign up. Drafts are kept. */
  const switchAccount = useCallback(async () => {
    await supabase.auth.signOut({ scope: 'local' });
    for (const key of ['user', 'userRole', 'merchant', 'collaborator']) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } }
    setIdentity({ kind: 'anonymous' });
  }, []);

  /** True only while the live session is still the identity the page is showing (another tab may have changed it). */
  const stillCurrent = useCallback(async (email: string) => {
    const { data } = await supabase.auth.getUser();
    return same(data.user?.email, email);
  }, []);

  return { identity, switchAccount, stillCurrent, refresh: resolve };
}
