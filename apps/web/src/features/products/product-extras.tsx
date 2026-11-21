'use client';

import type { Product, PriceTierRow } from '@erp/data';
import { DataError } from '@erp/data';
import { PRICE_LEVELS, validatePriceTiers, type PriceLevel } from '@erp/domain';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, NativeSelect, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@erp/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { ErrorAlert, useErrorText } from '@/components/error-message';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';
import { catalogKeys, useUnits } from './use-catalog-data';
import { useConnection } from '@/providers/connection-provider';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const EXT: Record<(typeof IMAGE_TYPES)[number], string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Image and price tiers of an existing product. Both are saved here, independently of the main form. */
export function ProductExtras({ product }: { product: Product }) {
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-2">
      <ProductImage product={product} />
      <PriceTiers product={product} />
    </div>
  );
}

function ProductImage({ product }: { product: Product }) {
  const { writable } = useConnection();
  const { t } = useI18n();
  const { catalog, productImages } = useServices();
  const { orgId } = useMembership();
  const { can } = useSession();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [localError, setLocalError] = React.useState<string | null>(null);

  const url = useQuery({
    queryKey: ['product-image', product.id, product.imagePath],
    enabled: Boolean(product.imagePath),
    queryFn: () => productImages.signedUrl(product.imagePath!),
    staleTime: 30 * 60_000,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) throw new DataError('image.type', file.type);
      if (file.size > MAX_IMAGE_BYTES) throw new DataError('image.too_large', String(file.size));
      const path = await productImages.upload(orgId, product.id, file, EXT[file.type as keyof typeof EXT]);
      await catalog.setProductImagePath(product.id, path);
      return path;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: catalogKeys.product(product.id) }),
  });

  const remove = useMutation({
    mutationFn: () => catalog.setProductImagePath(product.id, null),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: catalogKeys.product(product.id) }),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('product.image')}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        {localError ? <Alert variant="destructive">{localError}</Alert> : null}
        {upload.error ? <ErrorAlert error={upload.error} /> : null}
        {remove.error ? <ErrorAlert error={remove.error} /> : null}
        {product.imagePath ? (
          url.isPending ? <Spinner label={t('common.loading')} /> : url.error ? <ErrorAlert error={url.error} /> : (
            <img src={url.data} alt={product.nameEn} className="h-40 w-40 rounded-md border object-contain" />
          )
        ) : (
          <div className="flex h-40 w-40 items-center justify-center rounded-md border border-dashed text-muted-foreground">
            <ImageIcon aria-hidden="true" />
          </div>
        )}
        {can('catalog.write') ? (
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm hover:bg-accent">
              {upload.isPending ? t('common.saving') : t('product.image_choose')}
              <input type="file" accept={IMAGE_TYPES.join(',')} className="sr-only" disabled={upload.isPending}
                onChange={(e) => {
                  setLocalError(null);
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) upload.mutate(f, { onError: (err) => setLocalError(errorText(err)) });
                }} />
            </label>
            {product.imagePath ? <Button variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending || !writable}>{t('common.remove')}</Button> : null}
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{t('product.image_hint')}</p>
      </CardContent>
    </Card>
  );
}

function PriceTiers({ product }: { product: Product }) {
  const { writable } = useConnection();
  const { t, fmt } = useI18n();
  const { inventory } = useServices();
  const { orgId } = useMembership();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const units = useUnits(orgId);
  const tiers = useQuery({
    queryKey: ['price-tiers', product.id],
    queryFn: () => inventory.listPriceTiers(product.id),
  });
  const [rows, setRows] = React.useState<Array<PriceTierRow & { key: string }> | null>(null);
  const [issues, setIssues] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (tiers.data) setRows(tiers.data.map((r) => ({ ...r, key: r.id })));
  }, [tiers.data]);

  const save = useMutation({
    mutationFn: async () => {
      const current = rows ?? [];
      const unitIds = new Set(product.units.map((u) => u.unitId));
      const problems = validatePriceTiers(
        current.map((r) => ({ unitId: r.unitId, level: r.priceLevel, minQuantity: r.minQuantity, price: r.price })),
        unitIds,
      );
      if (problems.length > 0) {
        setIssues(problems.map((p) => `${t('product.tier_row', { row: p.index + 1 })}: ${t(`issues.${p.code}` as 'issues.price.unit')}`));
        throw new DataError('validation', 'price tiers');
      }
      setIssues([]);
      return inventory.savePriceTiers(orgId, product.id, current.map((r) => ({
        ...(tiers.data?.some((x) => x.id === r.id) ? { id: r.id } : {}),
        unitId: r.unitId, priceLevel: r.priceLevel, minQuantity: r.minQuantity, price: r.price,
      })));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['price-tiers', product.id] }),
  });

  const canPrice = can('catalog.price_write');
  const unitName = (id: string) => {
    const u = units.data?.find((x) => x.id === id);
    return u?.nameEn ?? id;
  };
  const update = (key: string, patch: Partial<PriceTierRow>) =>
    setRows((prev) => (prev ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('tiers.title')}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t('tiers.help')}</p>
        {!canPrice ? <Alert variant="info">{t('product.price_readonly')}</Alert> : null}
        {tiers.error ? <ErrorAlert error={tiers.error} /> : null}
        {save.error ? <ErrorAlert error={save.error} /> : null}
        {issues.length > 0 ? <Alert variant="destructive"><ul className="list-disc ps-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul></Alert> : null}
        {tiers.isPending || rows === null ? <Spinner label={t('common.loading')} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('product.unit')}</TableHead>
                <TableHead>{t('tiers.level')}</TableHead>
                <TableHead className="text-end">{t('tiers.min_qty')}</TableHead>
                <TableHead className="text-end">{t('tiers.price')}</TableHead>
                <TableHead><span className="sr-only">{t('common.actions')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? <TableRow><TableCell colSpan={5} className="text-muted-foreground">{t('tiers.empty')}</TableCell></TableRow> : null}
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>
                    <NativeSelect value={r.unitId} disabled={!canPrice} onChange={(e) => update(r.key, { unitId: e.target.value })} className="h-8 w-auto text-xs">
                      {product.units.map((u) => <option key={u.unitId} value={u.unitId}>{unitName(u.unitId)}</option>)}
                    </NativeSelect>
                  </TableCell>
                  <TableCell>
                    <NativeSelect value={r.priceLevel} disabled={!canPrice} onChange={(e) => update(r.key, { priceLevel: e.target.value as PriceLevel })} className="h-8 w-auto text-xs">
                      {PRICE_LEVELS.map((l) => <option key={l} value={l}>{t(`tiers.level_${l}` as 'tiers.level_retail')}</option>)}
                    </NativeSelect>
                  </TableCell>
                  <TableCell className="text-end">
                    <Input dir="ltr" inputMode="decimal" className="h-8 w-24 text-end" disabled={!canPrice} value={r.minQuantity}
                      onChange={(e) => update(r.key, { minQuantity: e.target.value })} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Input dir="ltr" inputMode="decimal" className="h-8 w-28 text-end" disabled={!canPrice} value={r.price}
                      onChange={(e) => update(r.key, { price: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    {canPrice ? (
                      <Button variant="ghost" size="icon" aria-label={t('common.remove')} onClick={() => setRows((prev) => (prev ?? []).filter((x) => x.key !== r.key))}>
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {canPrice && rows !== null ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setRows((prev) => [...(prev ?? []), {
              key: `new-${Date.now()}`, id: '', unitId: product.units[0]?.unitId ?? '', priceLevel: 'wholesale', minQuantity: '1', price: '0',
            }])}>
              <Plus aria-hidden="true" />{t('tiers.add')}
            </Button>
            <Button size="sm" disabled={save.isPending || !writable} onClick={() => save.mutate()}>{save.isPending ? t('common.saving') : t('common.save')}</Button>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{t('tiers.count', { count: fmt.number(rows?.length ?? 0) })}</p>
      </CardContent>
    </Card>
  );
}

