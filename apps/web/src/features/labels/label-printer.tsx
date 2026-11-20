'use client';

import type { Product } from '@erp/data';
import { localName, type Locale } from '@erp/i18n';
import { Alert, Button, Card, CardContent, Field, Input, NativeSelect, Spinner } from '@erp/ui';
import { useQuery } from '@tanstack/react-query';
import { Printer, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership } from '@/providers/session-provider';
import { renderBarcodeSvg, symbologyFor } from './barcode-svg';

interface Item { product: Product; unitId: string; barcode: string; copies: number }

const SIZES = {
  small: { w: '38mm', h: '25mm' },
  large: { w: '62mm', h: '29mm' },
} as const;
type SizeKey = keyof typeof SIZES;

export function LabelPrinter() {
  const { t, locale, fmt } = useI18n();
  const { catalog } = useServices();
  const { orgId } = useMembership();
  const [search, setSearch] = React.useState('');
  const [size, setSize] = React.useState<SizeKey>('small');
  const [items, setItems] = React.useState<Item[]>([]);

  const results = useQuery({
    queryKey: ['label-search', orgId, search],
    enabled: search.trim().length >= 2,
    queryFn: async () => (await catalog.searchProducts({ orgId, search, limit: 10, offset: 0 })).items,
  });
  const units = useQuery({ queryKey: ['units', orgId], queryFn: () => catalog.listUnits(orgId), staleTime: 5 * 60_000 });
  const unitName = (id: string) => {
    const u = units.data?.find((x) => x.id === id);
    return u ? (locale === 'ar' ? u.nameAr : locale === 'bn' ? (u.nameBn ?? u.nameEn) : u.nameEn) : '';
  };

  function add(p: Product) {
    const base = p.units.find((u) => u.isBase) ?? p.units[0];
    if (!base) return;
    setItems((prev) => [...prev, { product: p, unitId: base.unitId, barcode: base.barcode ?? p.sku, copies: 1 }]);
    setSearch('');
  }

  function update(index: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  const labels = items.flatMap((it) => {
    const price = it.product.units.find((u) => u.unitId === it.unitId)?.salePrice ?? null;
    const copies = Math.max(1, Math.min(200, Number.isFinite(it.copies) ? it.copies : 1));
    return Array.from({ length: copies }, () => ({ it, price }));
  });

  return (
    <>
      <div className="print:hidden">
        <PageHeader title={t('labels.title')} actions={
          <Button onClick={() => window.print()} disabled={labels.length === 0}><Printer aria-hidden="true" />{t('labels.print')}</Button>
        } />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="flex flex-col gap-4 pt-5">
              <Field label={t('products.search_placeholder')}>
                {(p) => (
                  <Input {...p} type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && results.data?.length === 1) {
                        e.preventDefault();
                        add(results.data[0]!);
                      }
                    }} />
                )}
              </Field>
              {results.error ? <ErrorAlert error={results.error} /> : null}
              {results.isFetching ? <Spinner label={t('common.loading')} /> : null}
              <ul className="flex flex-col gap-1">
                {(results.data ?? []).map((p) => (
                  <li key={p.id}>
                    <Button variant="ghost" className="w-full justify-start" onClick={() => add(p)}>
                      <Plus aria-hidden="true" />
                      <span dir="ltr" className="font-mono text-xs">{p.sku}</span>
                      <span className="ms-2">{localName({ nameEn: p.nameEn, nameAr: p.nameAr, nameBn: p.nameBn }, locale as Locale)}</span>
                    </Button>
                  </li>
                ))}
              </ul>
              <Field label={t('labels.size')}>
                {(p) => (
                  <NativeSelect {...p} value={size} onChange={(e) => setSize(e.target.value as SizeKey)}>
                    <option value="small">{t('labels.size_small')}</option>
                    <option value="large">{t('labels.size_large')}</option>
                  </NativeSelect>
                )}
              </Field>
              <ul className="flex flex-col gap-2">
                {items.map((it, i) => (
                  <li key={`${it.product.id}-${i}`} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                    <span className="min-w-40 flex-1 font-mono text-sm" dir="ltr">{it.product.sku}</span>
                    <Field label={t('labels.unit')}>
                      {(p) => (
                        <NativeSelect {...p} value={it.unitId} className="w-auto" onChange={(e) => {
                          const u = it.product.units.find((x) => x.unitId === e.target.value);
                          update(i, { unitId: e.target.value, barcode: u?.barcode ?? it.product.sku });
                        }}>
                          {it.product.units.map((u) => <option key={u.unitId} value={u.unitId}>{unitName(u.unitId)}</option>)}
                        </NativeSelect>
                      )}
                    </Field>
                    <Field label={t('labels.copies')}>
                      {(p) => <Input {...p} type="number" min={1} max={200} className="w-20" value={it.copies}
                        onChange={(e) => update(i, { copies: Number(e.target.value) })} />}
                    </Field>
                    <Button variant="ghost" size="icon" aria-label={t('common.remove')} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="mb-2 text-sm text-muted-foreground">{t('labels.count', { count: fmt.number(labels.length) })}</p>
              {labels.length === 0 ? <Alert variant="info">{t('labels.empty')}</Alert> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <div id="label-sheet" className="mt-6 flex flex-wrap gap-2 print:mt-0 print:gap-0" dir="ltr">
        {labels.map((l, i) => (
          <LabelCell key={i} size={size} sku={l.it.product.sku}
            name={localName({ nameEn: l.it.product.nameEn, nameAr: l.it.product.nameAr, nameBn: l.it.product.nameBn }, locale as Locale)}
            barcode={l.it.barcode} price={l.price} currency={t('labels.currency')} />
        ))}
      </div>
    </>
  );
}

function LabelCell({ size, sku, name, barcode, price, currency }: {
  size: SizeKey; sku: string; name: string; barcode: string; price: string | null; currency: string;
}) {
  const dims = SIZES[size];
  let svg: string | null = null;
  let error: string | null = null;
  try {
    svg = renderBarcodeSvg(barcode, symbologyFor(barcode));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return (
    <div className="flex flex-col items-center justify-center overflow-hidden border border-dashed p-1 text-center print:border-0"
      style={{ width: dims.w, height: dims.h }}>
      <span className="line-clamp-1 w-full text-[9px] leading-tight">{name}</span>
      {error ? <span className="text-[8px] text-destructive">{error}</span> : null}
      {svg ? <div className="h-[55%] w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} /> : null}
      <span className="font-mono text-[8px]">{barcode}</span>
      <span className="text-[9px] font-medium tabular-nums">{price ? `${currency} ${Number(price).toFixed(2)}` : sku}</span>
    </div>
  );
}
