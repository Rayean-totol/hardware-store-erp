'use client';

import { Alert, Spinner } from '@erp/ui';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { SupplierForm } from '@/features/suppliers/supplier-form';
import { useI18n } from '@/providers/i18n-provider';

// Static export cannot pre-render unknown ids, so the id travels in the query string.
function EditSupplier() {
  const { t } = useI18n();
  const id = useSearchParams().get('id');
  if (!id) return <Alert variant="warning">{t('errors.supplier.not_found')}</Alert>;
  return <SupplierForm supplierId={id} />;
}

export default function EditSupplierPage() {
  return (
    <Suspense fallback={<Spinner label="…" />}>
      <EditSupplier />
    </Suspense>
  );
}
