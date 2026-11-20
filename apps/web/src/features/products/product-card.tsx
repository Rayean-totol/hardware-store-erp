'use client';

import type { Product } from '@erp/data';
import { Badge, Button, Card } from '@erp/ui';
import { useQuery } from '@tanstack/react-query';
import { Blocks, Box, Droplets, Hammer, HardHat, ImageOff, Nut, Package, Paintbrush, Pencil, Zap } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { type PlaceholderKind, placeholderKindFor, productStatusKey } from './catalog-view';

const PLACEHOLDER_ICON: Record<PlaceholderKind, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  safety: HardHat,
  tools: Hammer,
  electrical: Zap,
  plumbing: Droplets,
  paint: Paintbrush,
  fasteners: Nut,
  building: Blocks,
  general: Package,
};

export interface ProductCardProps {
  product: Product;
  /** Display name in the active language (already resolved by the caller). */
  displayName: string;
  categoryName: string | null;
  categoryNameEn: string | null;
  brandName: string | null;
  /** Formatted base-unit price, or null when the product has no sale price. */
  priceLabel: string | null;
}

export function ProductCard({ product, displayName, categoryName, categoryNameEn, brandName, priceLabel }: ProductCardProps) {
  const { t } = useI18n();
  const { productImages } = useServices();
  const baseBarcode = product.units.find((u) => u.isBase)?.barcode ?? null;
  const status = productStatusKey(product.archivedAt);

  const image = useQuery({
    queryKey: ['product-image', product.id, product.imagePath],
    enabled: Boolean(product.imagePath),
    queryFn: () => productImages.signedUrl(product.imagePath!),
    staleTime: 50 * 60 * 1000,
  });

  const Icon = PLACEHOLDER_ICON[placeholderKindFor(categoryNameEn)];
  const archived = Boolean(product.archivedAt);

  return (
    <Card className={`flex flex-col gap-3 p-3 ${archived ? 'opacity-60' : ''}`} data-testid="product-card">
      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted/40">
        {product.imagePath && image.data ? (
          <img src={image.data} alt={displayName} loading="lazy" className="size-full object-cover" />
        ) : product.imagePath && image.isError ? (
          <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
            <ImageOff className="size-8" aria-hidden="true" />
            <span>{t('product.image_unavailable')}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground" aria-label={t('product.no_image')} role="img">
            <Icon className="size-10" aria-hidden={true} />
            <span className="text-xs">{t('product.no_image')}</span>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-mono text-xs text-muted-foreground" dir="ltr">{product.sku}</div>
        <h3 className="line-clamp-2 break-words text-sm font-semibold leading-snug">{displayName}</h3>
        <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          {categoryName ? <span>{categoryName}</span> : null}
          {brandName ? <span>· {brandName}</span> : null}
        </div>
        {baseBarcode ? (
          <div className="flex items-center gap-1 text-xs text-muted-foreground" dir="ltr">
            <Box className="size-3" aria-hidden="true" />
            <span className="font-mono">{baseBarcode}</span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold tabular-nums">{priceLabel ?? '—'}</span>
        {archived ? <Badge variant="outline">{t(status)}</Badge> : <Badge variant="success">{t(status)}</Badge>}
      </div>

      <Button asChild variant="outline" size="sm" className="w-full">
        <Link href={`/products/edit/?id=${product.id}`} aria-label={`${t('common.edit')} ${product.sku}`}>
          <Pencil aria-hidden="true" />
          {t('common.edit')}
        </Link>
      </Button>
    </Card>
  );
}
