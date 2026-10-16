"use client";

import FinancialHistory from '../../../components/FinancialHistory';

export default function AdminFinancialsPage() {
  return (
    <div>
      <h2 style={{ margin: '0 0 8px', fontSize: 24 }}>Transactions and Commissions</h2>
      <p style={{ color: '#64748b', margin: '0 0 24px' }}>Full VNO transaction history, including records without a merchant relationship.</p>
      <FinancialHistory admin />
    </div>
  );
}
