'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../../../lib/supabase';
import { api } from '../../../../lib/api';

type Stage = 'loading' | 'no-session' | 'claiming' | 'success' | 'error';

export default function ClaimPage() {
  const params = useParams<{ entityType: string; entityId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('loading');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ role: string; entity_id: string } | null>(null);

  const invitationId = searchParams.get('invitation');
  const entityType = params.entityType;
  const entityId = params.entityId;

  async function doClaim(token: string) {
    setStage('claiming');
    try {
      const endpoint = `/invitations/claim/${entityType}/${entityId}${invitationId ? `?invitation=${invitationId}` : ''}`;
      const data = await api.post(endpoint, undefined, token);
      setResult(data);
      setStage('success');
    } catch (err: any) {
      setMessage(err.message || 'Unable to claim this record');
      setStage('error');
    }
  }

  useEffect(() => {
    let handled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !handled) {
        handled = true;
        void doClaim(session.access_token);
      }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !handled) {
        handled = true;
        void doClaim(session.access_token);
      } else if (!session && !handled) {
        setStage('no-session');
      }
    });
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, invitationId]);

  const dashboardPath = result?.role === 'merchant' ? '/merchant/dashboard' : '/collaborator/dashboard';
  const entityLabel = entityType === 'merchant' ? 'merchant' : 'partner';

  return (
    <main style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Account Claim</h1>

        {stage === 'loading' && (
          <p style={styles.muted}>Verifying your identity…</p>
        )}

        {stage === 'no-session' && (
          <>
            <p style={styles.text}>You need to be signed in to claim this {entityLabel} account.</p>
            <p style={styles.muted}>Click the invitation link from your email, or sign in and return to this page.</p>
            <button style={styles.button} onClick={() => router.push('/user-login')}>Sign in</button>
          </>
        )}

        {stage === 'claiming' && (
          <p style={styles.muted}>Binding your identity to the {entityLabel} record…</p>
        )}

        {stage === 'success' && result && (
          <>
            <div style={styles.successBox}>
              <p style={styles.successText}>Your identity has been bound to this {entityLabel} record.</p>
              <p style={styles.muted}>An admin will review and approve your account before you can access the full dashboard. You will receive a notification once approved.</p>
            </div>
            <button style={styles.button} onClick={() => router.push(dashboardPath)}>Go to dashboard</button>
          </>
        )}

        {stage === 'error' && (
          <>
            <div style={styles.errorBox}>
              <p style={styles.errorText}>{message}</p>
            </div>
            <p style={styles.muted}>If you believe this is a mistake, contact your administrator.</p>
            <button style={styles.secondaryButton} onClick={() => router.push('/')}>Return home</button>
          </>
        )}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f9fafb', padding: 24, fontFamily: 'system-ui, sans-serif' },
  card: { width: '100%', maxWidth: 480, background: '#fff', borderRadius: 14, padding: 36, boxShadow: '0 1px 6px rgba(0,0,0,.1)', display: 'flex', flexDirection: 'column', gap: 16 },
  title: { margin: 0, fontSize: 24, fontWeight: 700, color: '#0f172a' },
  text: { margin: 0, color: '#334155' },
  muted: { margin: 0, color: '#64748b', fontSize: 14 },
  successBox: { background: '#f0fdf4', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 },
  successText: { margin: 0, color: '#166534', fontWeight: 600 },
  errorBox: { background: '#fef2f2', borderRadius: 10, padding: 16 },
  errorText: { margin: 0, color: '#991b1b' },
  button: { padding: '11px 18px', background: '#0f766e', color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 15 },
  secondaryButton: { padding: '11px 18px', background: '#fff', color: '#334155', border: '1px solid #cbd5e1', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 15 },
};
