"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <main style={styles.container}>
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main style={styles.container}>
      <h1 style={styles.title}>TravelRepo</h1>
      <p style={styles.subtitle}>
        Travel Management Platform
      </p>

      {user ? (
        <div style={styles.userSection}>
          <p>Welcome, {user.email}</p>
          <div style={styles.buttonGroup}>
            <button
              style={styles.primaryButton}
              onClick={() => router.push('/admin')}
            >
              Admin Dashboard
            </button>
            <button
              style={styles.secondaryButton}
              onClick={() => router.push('/merchant/onboard')}
            >
              Register Merchant
            </button>
            <button
              style={styles.secondaryButton}
              onClick={() => router.push('/collaborator/onboard')}
            >
              Register Collaborator
            </button>
            <button
              style={styles.logoutButton}
              onClick={async () => {
                await supabase.auth.signOut();
                router.refresh();
              }}
            >
              Logout
            </button>
          </div>
        </div>
      ) : (
        <div style={styles.buttonGroup}>
          <button
            style={styles.primaryButton}
            onClick={() => router.push('/login')}
          >
            Login
          </button>
          <button
            style={styles.secondaryButton}
            onClick={() => router.push('/merchant/onboard')}
          >
            Register as Merchant
          </button>
          <button
            style={styles.secondaryButton}
            onClick={() => router.push('/collaborator/onboard')}
          >
            Register as Collaborator
          </button>
        </div>
      )}
    </main>
  );
}

/* --- Minimal inline styles (no dependencies) --- */

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '24px',
    fontFamily: 'system-ui, sans-serif',
    padding: '20px',
  },
  title: {
    fontSize: '32px',
    fontWeight: 600,
  },
  subtitle: {
    fontSize: '16px',
    color: '#555',
  },
  userSection: {
    textAlign: 'center',
  },
  buttonGroup: {
    display: 'flex',
    gap: '16px',
    marginTop: '24px',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  primaryButton: {
    padding: '12px 24px',
    fontSize: '16px',
    cursor: 'pointer',
    backgroundColor: '#000',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
  },
  secondaryButton: {
    padding: '12px 24px',
    fontSize: '16px',
    cursor: 'pointer',
    backgroundColor: '#fff',
    color: '#000',
    border: '1px solid #000',
    borderRadius: '6px',
  },
  logoutButton: {
    padding: '12px 24px',
    fontSize: '16px',
    cursor: 'pointer',
    backgroundColor: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
  },
};
