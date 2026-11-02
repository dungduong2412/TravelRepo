"use client";
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { PartnerQrCard } from '../../../../components/PartnerQrCard';
import { PageHeader } from '../../../../components/ui/Brand';
import { Alert, Spinner } from '../../../../components/ui/Feedback';

export default function CollaboratorQRCodePage() {
  const [verified, setVerified] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get('/collaborators/me').then((c) => setVerified(c.collaborators_verified === true)).catch((e) => setError(e.message || 'Không thể tải hồ sơ')); }, []);
  if (error) return <Alert tone="danger" title="Không thể tải mã QR">{error}</Alert>;
  if (verified === null) return <Spinner />;
  return <div className="mx-auto max-w-3xl"><PageHeader title="Mã QR giới thiệu" subtitle="Mã QR chỉ chứa mã đối tác, không chứa email, số điện thoại hay thông tin ngân hàng." /><PartnerQrCard verified={verified} /></div>;
}
