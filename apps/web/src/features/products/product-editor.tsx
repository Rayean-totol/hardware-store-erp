'use client';

import type { ProductDraft } from '@erp/domain';
import { Alert, Spinner } from '@erp/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';
import { ProductExtras } from './product-extras';
import { ProductForm } from './product-form';
import { catalogKeys, useBrands, useCategories, useUnits } from './use-catalog-data';

/** Loads reference data (and the product when editing) and wires ProductForm to the repository. */
export function ProductEditor({ productId }: { productId: string | null }) {
  const { t } = useI18n();
  const { catalog } = useServices();
  const membership = useMembership();
  const { can } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const units = useUnits(membership.orgId);
  const categories = useCategories(membership.orgId);
  const brands = useBrands(membership.orgId);
  const product = useQuery({
    queryKey: catalogKeys.product(productId ?? 'new'),
    queryFn: () => (productId ? catalog.getProduct(productId) : Promise.resolve(null)),
    enabled: Boolean(productId),
  });

  const title = productId ? t('product.edit_title') : t('product.new_title');
  const queries = [units, categories, brands, ...(productId ? [product] : [])];
  const failed = queries.find((q) => q.error);
  if (failed) {
    return (
      <>
        <PageHeader title={title} />
        <ErrorAlert error={failed.error} onRetry={() => queries.forEach((q) => void q.refetch())} />
      </>
    );
  }
  if (queries.some((q) => q.isPending)) {
    return (
      <>
        <PageHeader title={title} />
        <Spinner label={t('common.loading')} />
      </>
    );
  }
  if (productId && !product.data) {
    return (
      <>
        <PageHeader title={title} />
        <Alert variant="warning">{t('product.not_found')}</Alert>
      </>
    );
  }
  if (!can('catalog.write')) {
    return (
      <>
        <PageHeader title={title} />
        <Alert variant="warning">{t('errors.forbidden')}</Alert>
      </>
    );
  }

  async function save(draft: ProductDraft, expectedVersion: number | null) {
    const result = await catalog.saveProduct(draft, expectedVersion);
    await queryClient.invalidateQueries({ queryKey: catalogKeys.products(membership.orgId) });
    await queryClient.invalidateQueries({ queryKey: catalogKeys.product(result.id) });
    router.push('/products/');
  }

  return (
    <>
      <PageHeader title={title} />
      <ProductForm
        // Remount when a newer version is loaded (after a conflict reload).
        key={product.data ? `${product.data.id}:${product.data.rowVersion}` : 'new'}
        orgId={membership.orgId}
        product={product.data ?? null}
        units={units.data ?? []}
        categories={categories.data ?? []}
        brands={brands.data ?? []}
        pricesIncludeVat={membership.pricesIncludeVat}
        canEditPrices={can('catalog.price_write')}
        onSave={save}
        onCancel={() => router.push('/products/')}
        onReload={() => void product.refetch()}
      />
      {product.data ? <ProductExtras product={product.data} /> : null}
    </>
  );
}
