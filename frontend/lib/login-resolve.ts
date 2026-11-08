"use client";

import { api } from './api';
import { errorCode } from './auth-diagnostics';
import { signIn, supabase } from './supabase';
import { adoptDraftEmail } from './onboarding-draft';
import { decideLoginFollowUp, LoginFollowUp, Profile } from './login-followup';

/**
 * The profile-gated /auth/login refused a login (it collapses "wrong password" and "e-mail not confirmed" and says "not active" for an account
 * that never submitted a business profile). This asks Supabase Auth itself what is going on, with the SAME e-mail and password the person just typed:
 *  - password rejected for another reason          -> none (keep the original message)
 *  - e-mail not confirmed                          -> tell them to confirm
 *  - confirmed, no business profile                -> keep the Auth session and send them to complete the profile (nothing is created)
 *  - pending / blocked profile                     -> no session is kept; the matching message is shown
 * Nothing here signs anyone up, sends mail, creates a record or grants operational access (the API still requires an approved profile).
 */
export async function resolveFailedLogin(email: string, password: string): Promise<LoginFollowUp> {
  let data: Awaited<ReturnType<typeof signIn>>;
  try { data = await signIn(email.trim(), password); }
  catch (err) { return errorCode(err) === 'email_not_confirmed' ? { kind: 'email_not_confirmed' } : { kind: 'none' }; }

  let profile: Profile = null;
  try { profile = (await api.get('/user-profiles/me')) || null; } catch { profile = null; }
  const requestedRole = (data.user?.user_metadata as { requested_role?: string } | undefined)?.requested_role;
  const next = decideLoginFollowUp({ confirmed: Boolean(data.user?.email_confirmed_at), profile, requestedRole });

  if (next.kind === 'onboarding') adoptDraftEmail(next.role, data.user!.email || email.trim());
  // Only the Merchant form still submits with the confirmed session. The single-step Partner registration needs no session at all: it
  // starts from the remembered e-mail and signs nothing in (approval + the activation e-mail do that).
  if (next.kind !== 'onboarding' || next.role === 'collaborator') await supabase.auth.signOut({ scope: 'local' });
  return next;
}
