'use client';

import { Alert, Spinner } from '@erp/ui';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PurchaseForm } from '@/features/purchase/purchase-form';
import { useI18n } from '@/providers/i18n-provider';

// Static export cannot pre-render unknown ids, so the id travels in the query string.
function EditPurchaseOrder() {
  const { t } = useI18n();
  const id = useSearchParams().get('id');
  if (!id) return <Alert variant="warning">{t('purchase.not_found')}</Alert>;
  return <PurchaseForm orderId={id} />;
}

export default function EditPurchaseOrderPage() {
  return (
    <Suspense fallback={<Spinner label="…" />}>
      <EditPurchaseOrder />
    </Suspense>
  );
}
