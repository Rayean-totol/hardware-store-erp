'use client';

import { Alert, Spinner } from '@erp/ui';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PurchaseDetail } from '@/features/purchase/purchase-detail';
import { useI18n } from '@/providers/i18n-provider';

function DetailContent() {
  const { t } = useI18n();
  const id = useSearchParams().get('id');
  if (!id) return <Alert variant="warning">{t('purchase.not_found')}</Alert>;
  return <PurchaseDetail orderId={id} />;
}

export default function PurchaseOrderDetailPage() {
  return (
    <Suspense fallback={<Spinner label="…" />}>
      <DetailContent />
    </Suspense>
  );
}
