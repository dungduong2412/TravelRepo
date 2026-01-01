'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { publicApiFetch } from '../../lib/api';
import { supabase } from '../../lib/supabase';

export default function UserLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userType = searchParams.get('type') || 'collaborator'; // default to collaborator
  
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
          userType,
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
      
      if (userType === 'merchant') {
        localStorage.setItem('merchant', JSON.stringify(response.merchant));
      } else {
        localStorage.setItem('collaborator', JSON.stringify(response.collaborator));
      }

      // Redirect based on user type
      if (userType === 'merchant') {
        router.push('/merchant/dashboard');
      } else {
        router.push('/collaborator/dashboard');
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
        <h1 style={styles.title}>
          {userType === 'merchant' ? 'Đăng Nhập Merchant' : 'Đăng Nhập Collaborator'}
        </h1>
        <p style={styles.subtitle}>
          {userType === 'merchant' 
            ? 'Đăng nhập vào tài khoản merchant của bạn' 
            : 'Đăng nhập vào tài khoản collaborator của bạn'}
        </p>

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
              placeholder="••••••••"
              minLength={6}
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button
            type="submit"
            disabled={loading}
            style={styles.submitButton}
          >
            {loading ? 'Đang xử lý...' : 'Đăng Nhập'}
          </button>
        </form>

        <div style={styles.footer}>
          <button
            onClick={() => {
              if (userType === 'merchant') {
                router.push('/merchant/onboard');
              } else {
                router.push('/collaborator/onboard');
              }
            }}
            style={styles.switchButton}
          >
            Chưa có tài khoản? Đăng ký ngay
          </button>

          <button
            onClick={() => {
              // Toggle between merchant and collaborator
              const newType = userType === 'merchant' ? 'collaborator' : 'merchant';
              router.push(`/user-login?type=${newType}`);
            }}
            style={styles.switchButton}
          >
            {userType === 'merchant' 
              ? 'Đăng nhập với tư cách Collaborator' 
              : 'Đăng nhập với tư cách Merchant'}
          </button>
          
          <button
            onClick={() => router.push('/')}
            style={styles.backButton}
          >
            ← Quay lại trang chủ
          </button>
        </div>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: '20px',
  },
  card: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    maxWidth: '400px',
    width: '100%',
  },
  title: {
    fontSize: '28px',
    fontWeight: 600,
    marginBottom: '8px',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: '14px',
    color: '#666',
    textAlign: 'center',
    marginBottom: '32px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
  },
  input: {
    padding: '12px',
    fontSize: '16px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    outline: 'none',
  },
  error: {
    color: '#dc2626',
    fontSize: '14px',
    textAlign: 'center',
    padding: '8px',
    backgroundColor: '#fee2e2',
    borderRadius: '4px',
  },
  submitButton: {
    padding: '12px',
    fontSize: '16px',
    fontWeight: 600,
    backgroundColor: '#ea580c',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  footer: {
    marginTop: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  switchButton: {
    background: 'none',
    border: 'none',
    color: '#2563eb',
    fontSize: '14px',
    cursor: 'pointer',
    textAlign: 'center',
  },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#666',
    fontSize: '14px',
    cursor: 'pointer',
    textAlign: 'center',
  },
};
