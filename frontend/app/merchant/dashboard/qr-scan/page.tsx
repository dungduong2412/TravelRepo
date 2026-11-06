import { redirect } from 'next/navigation';

// This page has been consolidated into the main new-transaction flow.
export default function MerchantQrScanPage() {
  redirect('/merchant/dashboard/new-transaction');
}
