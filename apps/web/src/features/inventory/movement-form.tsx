'use client';

import {
  ADJUSTMENT_REASONS,
  applyStockChange,
  dec,
  RECEIPT_REASONS,
  validateStockMovementInput,
  type MovementType,
  type StockReason,
} from '@erp/domain';
import type { CachedProduct, Product } from '@erp/data';
import { localName, type Locale } from '@erp/i18n';
import { Alert, Button, Card, CardContent, Field, Input, NativeSelect, Textarea } from '@erp/ui';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useSession } from '@/providers/session-provider';
import { useSync } from '@/providers/sync-provider';
import { useUnits } from '../products/use-catalog-data';
import { useWarehouses } from './use-warehouses';

const isType = (v: string | null): v is MovementType => v === 'stock_in' || v === 'stock_out' || v === 'adjustment';

export function MovementForm({ initialType }: { initialType: string | null }) {
  const { t, fmt, locale, tMaybe } = useI18n();
  const { membership, can } = useSession();
  const { catalog } = useServices();
  const sync = useSync();
  const scanRef = React.useRef<HTMLInputElement>(null);

  const allowedTypes = (['stock_in', 'stock_out', 'adjustment'] as const).filter((tp) =>
    tp === 'adjustment' ? can('inventory.adjust') : can('inventory.move'));
  const [type, setType] = React.useState<MovementType>(() => {
    const requested = isType(initialType) ? initialType : 'stock_in';
    return allowedTypes.includes(requested as MovementType) ? (requested as MovementType) : (allowedTypes[0] ?? 'stock_in');
  });
  const warehouses = useWarehouses(membership?.orgId ?? '');
  const units = useUnits(membership?.orgId ?? '');
  const unitName = (id: string) => {
    const u = units.data?.find((x) => x.id === id);
    return u ? (locale === 'ar' ? u.nameAr : locale === 'bn' ? (u.nameBn ?? u.nameEn) : u.nameEn) : id;
  };
  const [warehouseId, setWarehouseId] = React.useState('');
  const wh = warehouseId || warehouses.data?.[0]?.id || '';

  const [scan, setScan] = React.useState('');
  const [product, setProduct] = React.useState<CachedProduct | null>(null);
  const [candidates, setCandidates] = React.useState<Product[]>([]);
  const [lookupMessage, setLookupMessage] = React.useState<string | null>(null);
  const [unitId, setUnitId] = React.useState('');
  const [quantity, setQuantity] = React.useState('');
  const [unitCost, setUnitCost] = React.useState('');
  const [reason, setReason] = React.useState<StockReason | ''>('');
  const [note, setNote] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [issues, setIssues] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const [result, setResult] = React.useState<{ text: string; warn: boolean } | null>(null);

  React.useEffect(() => {
    scanRef.current?.focus();
  }, []);

  async function lookup(code: string) {
    const value = code.trim();
    if (!value || !sync.engine) return;
    setLookupMessage(null);
    setCandidates([]);
    const local = await sync.engine.findProduct(value);
    if (local) {
      choose(local);
      return;
    }
    if (sync.online) {
      try {
        const page = await catalog.searchProducts({ orgId: membership!.orgId, search: value, limit: 8, offset: 0 });
        if (page.items.length === 1) {
          const cached = await sync.engine.getProduct(page.items[0]!.id);
          if (cached) return choose(cached);
        }
        setCandidates(page.items);
        setLookupMessage(page.items.length === 0 ? t('movement.not_found') : t('movement.pick_one'));
        return;
      } catch (err) {
        setError(err);
        return;
      }
    }
    setLookupMessage(t('movement.not_found_offline'));
  }

  function choose(p: CachedProduct) {
    setProduct(p);
    setCandidates([]);
    setScan('');
    setLookupMessage(null);
    const base = p.units.find((u) => u.factor === '1') ?? p.units[0];
    setUnitId(base?.unitId ?? '');
    setQuantity('');
    setResult(null);
    setError(null);
  }

  // Projection of the chosen product for the preview; uses the same rules as the server.
  const projection = useQuery({
    queryKey: ['preview', wh, product?.id, sync.status?.pending ?? 0],
    enabled: Boolean(sync.engine && wh && product),
    queryFn: async () => {
      const levels = await sync.engine!.projectedLevels(wh);
      const level = levels.find((l) => l.productId === product!.id);
      return { quantity: level?.quantity.toString() ?? '0', averageCost: level?.averageCost.toString() ?? '0' };
    },
  });

  const unit = product?.units.find((u) => u.unitId === unitId);
  const baseUnitLabel = product ? unitName(product.baseUnitId) : '';
  const previewBalance = React.useMemo(() => {
    if (!product || !unit || !projection.data || !quantity.trim()) return null;
    try {
      const qty = dec(quantity).abs();
      const change = type === 'stock_out' ? qty.times(unit.factor).negated()
        : type === 'stock_in' ? qty.times(unit.factor)
          : dec(quantity).times(unit.factor);
      const cost = type === 'stock_in' && unitCost.trim() ? dec(unitCost).dividedBy(dec(unit.factor)) : null;
      const r = applyStockChange(
        { quantity: dec(projection.data.quantity), averageCost: dec(projection.data.averageCost) },
        change, cost, { allowNegative: true },
      );
      return { balance: r.state.quantity.toString(), negative: r.state.quantity.isNegative() };
    } catch {
      return null;
    }
  }, [product, unit, projection.data, quantity, unitCost, type]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!product || !sync.engine) {
      setIssues([t('movement.choose_product')]);
      return;
    }
    const found = validateStockMovementInput({
      movementType: type,
      quantity,
      reasonCode: reason || null,
      unitCost: type === 'stock_in' ? unitCost : null,
    });
    setIssues(found.map((code) => tMaybe(`issues.${code}`) ?? code));
    if (found.length > 0) return;

    setBusy(true);
    try {
      const entry = await sync.engine.enqueue({
        warehouseId: wh,
        productId: product.id,
        unitId,
        movementType: type,
        quantity,
        unitCost: type === 'stock_in' ? unitCost : null,
        reasonCode: reason || null,
        note: note.trim() || null,
        reference: reference.trim() || null,
      });
      const report = await sync.flush();
      const after = (await sync.engine.queued()).find((q) => q.id === entry.id);
      if (after?.status === 'failed') {
        setError(new Error(after.lastError?.message ?? after.lastError?.code ?? 'rejected'));
        setResult({ text: t('movement.rejected_kept'), warn: true });
      } else if (report?.networkError || !sync.online) {
        setResult({ text: t('movement.queued'), warn: false });
      } else {
        setResult({ text: t('movement.saved'), warn: false });
      }
      setQuantity('');
      setUnitCost('');
      setNote('');
      setReference('');
      setIssues([]);
      scanRef.current?.focus();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const reasons: readonly StockReason[] = type === 'stock_in' ? RECEIPT_REASONS : type === 'adjustment' ? ADJUSTMENT_REASONS : [];
  const needsCost = type === 'stock_in';
  const needsReason = type === 'adjustment';

  if (allowedTypes.length === 0) {
    return (
      <>
        <PageHeader title={t('movement.title')} />
        <Alert variant="warning">{t('errors.forbidden')}</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t(`movement.type_${type}` as 'movement.type_stock_in')} />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={t('movement.title')}>
        {allowedTypes.map((tp) => (
          <Button key={tp} role="tab" aria-selected={type === tp} variant={type === tp ? 'default' : 'outline'} size="sm"
            onClick={() => { setType(tp); setIssues([]); setError(null); setResult(null); }}>
            {t(`movement.type_${tp}` as 'movement.type_stock_in')}
          </Button>
        ))}
      </div>

      {!sync.ready ? <Alert variant="info">{t('common.loading')}</Alert> : null}
      {error ? <ErrorAlert error={error} /> : null}
      {result ? <Alert variant={result.warn ? 'warning' : 'success'}>{result.text}</Alert> : null}
      {issues.length > 0 ? <Alert variant="destructive"><ul className="list-disc ps-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul></Alert> : null}

      <form onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardContent className="grid gap-4 pt-5 md:grid-cols-2">
            <Field label={t('inventory.warehouse')} required>
              {(p) => (
                <NativeSelect {...p} value={wh} onChange={(e) => setWarehouseId(e.target.value)}>
                  {(warehouses.data ?? []).map((w) => (
                    <option key={w.id} value={w.id}>{localName({ nameEn: w.nameEn, nameAr: w.nameAr, nameBn: w.nameBn }, locale as Locale)}</option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label={t('movement.scan_label')} hint={t('movement.scan_hint')}>
              {(p) => (
                <div className="flex gap-2">
                  <Input {...p} ref={scanRef} dir="ltr" className="font-mono" value={scan} autoComplete="off"
                    onChange={(e) => setScan(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void lookup(scan);
                      }
                    }} />
                  <Button type="button" variant="outline" size="icon" aria-label={t('movement.lookup')} onClick={() => void lookup(scan)}>
                    <Search aria-hidden="true" />
                  </Button>
                </div>
              )}
            </Field>
          </CardContent>
          {lookupMessage ? <CardContent className="pt-0 text-sm text-muted-foreground">{lookupMessage}</CardContent> : null}
          {candidates.length > 0 ? (
            <CardContent className="pt-0">
              <ul className="flex flex-col gap-1">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => {
                      void (async () => {
                        const cached = await sync.engine?.getProduct(c.id);
                        if (cached) choose(cached);
                        else setLookupMessage(t('movement.not_found_offline'));
                      })();
                    }}>
                      <span dir="ltr" className="font-mono text-xs">{c.sku}</span>
                      <span className="ms-2">{localName({ nameEn: c.nameEn, nameAr: c.nameAr, nameBn: c.nameBn }, locale as Locale)}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          ) : null}
        </Card>

        {product ? (
          <Card className="lg:col-span-2">
            <CardContent className="grid gap-4 pt-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <p className="font-medium">{localName({ nameEn: product.nameEn, nameAr: product.nameAr, nameBn: product.nameBn }, locale as Locale)}</p>
                <p dir="ltr" className="font-mono text-xs text-muted-foreground">{product.sku}</p>
                {projection.data ? (
                  <p className="mt-1 text-sm">
                    {t('movement.on_hand_now', { qty: fmt.number(projection.data.quantity), unit: baseUnitLabel })}
                  </p>
                ) : null}
              </div>
              <Field label={t('product.unit')} required>
                {(p) => (
                  <NativeSelect {...p} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                    {product.units.map((u) => (
                      <option key={u.unitId} value={u.unitId}>{unitName(u.unitId)} ({fmt.number(u.factor)})</option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={type === 'adjustment' ? t('movement.signed_quantity') : t('movement.quantity')} required hint={t('movement.quantity_hint')}>
                {(p) => <Input {...p} dir="ltr" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}
              </Field>
              {needsCost ? (
                <Field label={t('movement.unit_cost')} required hint={t('movement.unit_cost_hint')}>
                  {(p) => <Input {...p} dir="ltr" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />}
                </Field>
              ) : null}
              {reasons.length > 0 ? (
                <Field label={t('movement.reason')} required={needsReason}>
                  {(p) => (
                    <NativeSelect {...p} value={reason} onChange={(e) => setReason(e.target.value as StockReason | '')}>
                      <option value="">{needsReason ? t('common.none') : t('common.optional')}</option>
                      {reasons.map((r) => <option key={r} value={r}>{t(`reason.${r}` as 'reason.other')}</option>)}
                    </NativeSelect>
                  )}
                </Field>
              ) : null}
              <Field label={t('movement.reference')} optionalLabel={t('common.optional')}>
                {(p) => <Input {...p} dir="ltr" maxLength={64} value={reference} onChange={(e) => setReference(e.target.value)} />}
              </Field>
              <Field label={t('movement.note')} optionalLabel={t('common.optional')} className="md:col-span-2">
                {(p) => <Textarea {...p} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
              </Field>
              {previewBalance ? (
                <p className={`md:col-span-2 text-sm ${previewBalance.negative ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {t('movement.preview', { balance: fmt.number(previewBalance.balance), unit: baseUnitLabel })}
                  {previewBalance.negative ? ` ${t('movement.preview_negative')}` : ''}
                </p>
              ) : null}
              <div className="md:col-span-2 flex gap-2">
                <Button type="submit" disabled={busy || !sync.ready}>{busy ? t('common.saving') : t('movement.record')}</Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </form>
    </>
  );
}
