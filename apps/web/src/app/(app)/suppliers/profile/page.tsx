'use client';

import { Alert, Spinner } from '@erp/ui';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { SupplierProfile } from '@/features/suppliers/supplier-profile';
import { useI18n } from '@/providers/i18n-provider';

function ProfileContent() {
  const { t } = useI18n();
  const id = useSearchParams().get('id');
  if (!id) return <Alert variant="warning">{t('errors.supplier.not_found')}</Alert>;
  return <SupplierProfile supplierId={id} />;
}

export default function SupplierProfilePage() {
  return (
    <Suspense fallback={<Spinner label="…" />}>
      <ProfileContent />
    </Suspense>
  );
}
