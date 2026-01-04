export default function MasterDataPage() {
  return (
    <div style={styles.container}>
      <p style={styles.text}>Your configuration is here</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '50vh',
  },
  text: {
    fontSize: '24px',
    color: '#6b7280',
  },
};
