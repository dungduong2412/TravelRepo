"use client";

import FinancialHistory from '../../../../components/FinancialHistory';

export default function CollaboratorReportsPage() {
  return (
    <div>
      <h1 style={styles.title}>Báo Cáo</h1>
      <p style={styles.subtitle}>Báo cáo hoa hồng và hoạt động</p>
      
      <FinancialHistory />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  title: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#111827',
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#6b7280',
    marginBottom: '32px',
  },
};
