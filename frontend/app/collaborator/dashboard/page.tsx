"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CollaboratorDashboardPage() {
  const router = useRouter();

  useEffect(() => {
    // Automatically redirect to profile page
    router.replace('/collaborator/dashboard/profile');
  }, [router]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: '48px',
          height: '48px',
          border: '4px solid #ea580c',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 16px'
        }}></div>
        <p style={{ color: '#64748b' }}>Đang chuyển đến hồ sơ...</p>
      </div>
    </div>
  );
}
