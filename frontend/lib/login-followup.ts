/** Pure (no I/O) so it can be self-tested without the Supabase client. */
export type Profile = { role?: string; user_profiles_status?: string } | null;

export type LoginFollowUp =
  | { kind: 'onboarding'; role: 'merchant' | 'collaborator'; path: '/merchant/onboard' | '/collaborator/onboard' }
  | { kind: 'pending' }
  | { kind: 'email_not_confirmed' }
  | { kind: 'inactive' }
  | { kind: 'none' };

/** Pure decision, no I/O. Called only after Supabase accepted the password. */
export function decideLoginFollowUp(i: { confirmed: boolean; profile: Profile; requestedRole?: string }): LoginFollowUp {
  if (!i.confirmed) return { kind: 'email_not_confirmed' };
  if (i.profile?.role) {
    if (i.profile.user_profiles_status === 'pending') return { kind: 'pending' };
    return i.profile.user_profiles_status === 'active' ? { kind: 'none' } : { kind: 'inactive' };
  }
  if (i.requestedRole === 'collaborator') return { kind: 'onboarding', role: 'collaborator', path: '/collaborator/onboard' };
  if (i.requestedRole === 'merchant') return { kind: 'onboarding', role: 'merchant', path: '/merchant/onboard' };
  return { kind: 'none' };
}
