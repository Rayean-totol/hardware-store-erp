'use client';

import { Alert, Spinner } from '@erp/ui';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ProductEditor } from '@/features/products/product-editor';
import { useI18n } from '@/providers/i18n-provider';

// Static export cannot pre-render unknown ids, so the id travels in the query string.
function EditProduct() {
  const { t } = useI18n();
  const id = useSearchParams().get('id');
  if (!id) return <Alert variant="warning">{t('product.not_found')}</Alert>;
  return <ProductEditor productId={id} />;
}

export default function EditProductPage() {
  return (
    <Suspense fallback={<Spinner label="…" />}>
      <EditProduct />
    </Suspense>
  );
}
