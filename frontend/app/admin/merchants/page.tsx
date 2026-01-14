
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';

export default function AdminMerchantsPage() {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    apiFetch('/merchants?status=DRAFT')
      .then(setItems)
      .catch((e) => alert(e.message));
  }, []);

  return (
    <div>
      <h1>Merchants</h1>

      <div style={{ marginTop: 24 }}>
        {items.length === 0 && <p>No pending merchants.</p>}

        {items.map((m) => (
          <div key={m.id} style={styles.row}>
            <strong>{m.name}</strong>
            <span>{m.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  row: {
    background: '#fff',
    padding: 12,
    marginBottom: 8,
    borderRadius: 6,
    display: 'flex',
    justifyContent: 'space-between',
  },
};
