'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { publicApiFetch } from '../../lib/api';
import { supabase } from '../../lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await publicApiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
        }),
      });

      // Set Supabase session with the tokens received
      if (response.access_token) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: response.access_token,
          refresh_token: response.refresh_token,
        });
        
        if (sessionError) {
          console.error('Failed to set session:', sessionError);
        }
      }

      // Store user info
      localStorage.setItem('user', JSON.stringify(response.user));
      localStorage.setItem('userRole', response.user.role);
      
      if (response.user.role === 'merchant') {
        localStorage.setItem('merchant', JSON.stringify(response.merchant));
        router.push('/merchant/dashboard');
      } else if (response.user.role === 'collaborator') {
        localStorage.setItem('collaborator', JSON.stringify(response.collaborator));
        router.push('/collaborator/dashboard');
      } else if (response.user.role === 'admin') {
        router.push('/admin/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Đăng Nhập</h1>
        <p style={styles.subtitle}>Đăng nhập vào tài khoản của bạn</p>

        <form onSubmit={handleLogin} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={styles.input}
              placeholder="email@example.com"
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Mật khẩu</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={styles.input}
              placeholder="Nhập mật khẩu"
            />
          </div>

          {error && (
            <div style={styles.error}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.button,
              ...(loading ? styles.buttonDisabled : {}),
            }}
          >
            {loading ? 'Đang đăng nhập...' : 'Đăng Nhập'}
          </button>
        </form>

        <div style={styles.divider}>
          <span style={styles.dividerText}>Chưa có tài khoản?</span>
        </div>

        <div style={styles.signupButtons}>
          <button
            onClick={() => router.push('/merchant/onboard')}
            style={styles.signupButton}
          >
            Đăng Ký Merchant
          </button>
          <button
            onClick={() => router.push('/collaborator/onboard')}
            style={styles.signupButtonSecondary}
          >
            Đăng Ký Collaborator
          </button>
        </div>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: '#f3f4f6',
    padding: '20px',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
    padding: '40px',
    width: '100%',
    maxWidth: '450px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    marginBottom: '8px',
    textAlign: 'center' as const,
    color: '#1f2937',
  },
  subtitle: {
    fontSize: '14px',
    color: '#6b7280',
    marginBottom: '32px',
    textAlign: 'center' as const,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '20px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  label: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
  },
  input: {
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  error: {
    padding: '12px',
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    borderRadius: '6px',
    fontSize: '14px',
  },
  button: {
    padding: '12px',
    backgroundColor: '#FF385C',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  buttonDisabled: {
    backgroundColor: '#9ca3af',
    cursor: 'not-allowed',
  },
  divider: {
    marginTop: '32px',
    marginBottom: '24px',
    textAlign: 'center' as const,
    position: 'relative' as const,
  },
  dividerText: {
    backgroundColor: 'white',
    padding: '0 16px',
    color: '#6b7280',
    fontSize: '14px',
    position: 'relative' as const,
    zIndex: 1,
  },
  signupButtons: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
  },
  signupButton: {
    padding: '12px',
    backgroundColor: '#1f2937',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  signupButtonSecondary: {
    padding: '12px',
    backgroundColor: 'white',
    color: '#1f2937',
    border: '2px solid #1f2937',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};
