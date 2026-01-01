"use client";

export default function CollaboratorReportsPage() {
  return (
    <div>
      <h1 style={styles.title}>Báo Cáo</h1>
      <p style={styles.subtitle}>Báo cáo hoa hồng và hoạt động</p>
      
      <div style={styles.placeholder}>
        <p style={styles.placeholderText}>📊 Tính năng báo cáo sẽ được phát triển sau</p>
      </div>
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
  placeholder: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '80px 24px',
    textAlign: 'center',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  placeholderText: {
    fontSize: '18px',
    color: '#6b7280',
  },
};
