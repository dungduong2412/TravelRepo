import { redirect } from 'next/navigation';

// Legacy URL. The previous page read response.data, which the API client never returns, so it could not display a QR.
export default function LegacyPartnerQrRedirect() { redirect('/collaborator/dashboard/qr-code'); }
