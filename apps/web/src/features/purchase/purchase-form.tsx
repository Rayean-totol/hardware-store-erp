'use client';

import type { Product, PurchaseOrder, PurchaseOrderLineInput, PurchaseOrderInput } from '@erp/data';
import { calculateSale, purchaseActions, validPurchaseQuantity, validUnitCost } from '@erp/domain';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, NativeSelect, Spinner } from '@erp/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { catalogKeys, useUnits } from '@/features/products/use-catalog-data';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';
import { useConnection } from '@/providers/connection-provider';

interface DraftLine {
  key: string;
  product: Product;
  taxCategory: 'S' | 'Z' | 'E' | 'O';
  unitId: string;
  quantity: string;
  unitCost: string;
  discountType: 'percent' | 'fixed' | '';
  discountValue: string;
}

const newKey = () => crypto.randomUUID();

/** Create a draft, or edit one. Totals are previewed with the same rules the server applies. */
export function PurchaseForm({ orderId }: { orderId: string | null }) {
  const { writable } = useConnection();
  const { t, fmt, name } = useI18n();
  const { catalog, purchaseOrders, suppliers, inventory } = useServices();
  const membership = useMembership();
  const { can, user } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgId = membership.orgId;

  const existing = useQuery({
    queryKey: ['purchase-order', orgId, orderId],
    queryFn: () => purchaseOrders.get(orgId, orderId!),
    enabled: Boolean(orderId),
  });
  const supplierList = useQuery({ queryKey: ['suppliers', orgId, { status: 'active' }], queryFn: () => suppliers.list({ orgId, status: 'active', limit: 200 }) });
  const warehouses = useQuery({ queryKey: ['warehouses', orgId], queryFn: () => inventory.listWarehouses(orgId) });
  const units = useUnits(orgId);

  const [supplierId, setSupplierId] = React.useState('');
  const [branchId, setBranchId] = React.useState(membership.branches[0]?.id ?? '');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [delivery, setDelivery] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<DraftLine[]>([]);
  const [search, setSearch] = React.useState('');
  const [message, setMessage] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<unknown>(null);
  const [busy, setBusy] = React.useState(false);
  const clientId = React.useRef(newKey());
  const loadedFor = React.useRef<string | null>(null);

  // Load an existing draft once, with each product's units so the unit can still be chosen.
  React.useEffect(() => {
    const po: PurchaseOrder | undefined = existing.data;
    if (!po || loadedFor.current === po.id) return;
    loadedFor.current = po.id;
    setSupplierId(po.supplierId);
    setBranchId(po.branchId);
    setWarehouseId(po.warehouseId);
    setDelivery(po.expectedDeliveryDate ?? '');
    setNotes(po.deliveryNotes ?? '');
    void Promise.all(po.lines.map((l) => catalog.getProduct(l.productId).catch(() => null))).then((products) => {
      setLines(po.lines.map((l, i) => {
        const full = products[i];
        const product = full ?? ({ id: l.productId, sku: l.sku, nameEn: l.nameEn, nameAr: l.nameAr ?? '', nameBn: l.nameBn, units: [] } as unknown as Product);
        return {
          key: newKey(), product, taxCategory: (l.taxCategory ?? 'S') as DraftLine['taxCategory'], unitId: l.unitId,
          quantity: l.enteredQuantity, unitCost: l.unitCost ?? '0', discountType: (l.discountType ?? '') as '' | 'percent' | 'fixed', discountValue: l.discountValue ?? '',
        };
      }));
    });
  }, [existing.data, catalog]);

  const warehouseOptions = React.useMemo(
    () => (warehouses.data ?? []).filter((w) => w.branchId === branchId && w.isActive),
    [warehouses.data, branchId],
  );
  React.useEffect(() => {
    if (!warehouseId && warehouseOptions[0]) setWarehouseId(warehouseOptions[0].id);
  }, [branchId, warehouseId, warehouseOptions]);

  const results = useQuery({
    queryKey: [...catalogKeys.products(orgId), 'po-search', search.trim()],
    queryFn: () => catalog.searchProducts({ orgId, search: search.trim(), includeArchived: false, limit: 12, offset: 0 }),
    enabled: search.trim().length >= 2,
  });

  const unitName = (id: string) => {
    const u = (units.data ?? []).find((x) => x.id === id);
    return u ? name(u) : '';
  };
  const pricesIncludeVat = membership.pricesIncludeVat;

  const addProduct = (p: Product) => {
    const unit = p.units.find((u) => u.isBase && u.isPurchaseUnit) ?? p.units.find((u) => u.isPurchaseUnit) ?? p.units[0];
    if (!unit) return;
    setLines((cur) => [...cur, { key: newKey(), product: p, taxCategory: p.taxCategory, unitId: unit.unitId, quantity: '1', unitCost: '0', discountType: '', discountValue: '' }]);
    setSearch('');
    setMessage(null);
  };

  const patch = (key: string, p: Partial<DraftLine>) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const totals = calculateSale(
    lines.map((l) => ({
      quantity: validPurchaseQuantity(l.quantity) ? l.quantity : '0',
      listPrice: validUnitCost(l.unitCost) ? l.unitCost : '0',
      discountType: l.discountType || null,
      discountValue: l.discountValue || null,
      taxCategory: l.taxCategory,
    })),
    pricesIncludeVat,
  );

  const invalid = lines.find((l) => !validPurchaseQuantity(l.quantity) || !validUnitCost(l.unitCost));
  const canSave = lines.length > 0 && supplierId && branchId && warehouseId && !invalid && !busy;
  const status = existing.data?.status ?? 'draft';
  const isCreator = !existing.data || (user !== null && existing.data.createdBy === user.id);
  const editable = !orderId || purchaseActions(status, { permissions: membership.permissions, isCreator }).includes('edit');

  async function save() {
    setBusy(true);
    setSaveError(null);
    setMessage(null);
    const payloadLines: PurchaseOrderLineInput[] = lines.map((l) => ({
      productId: l.product.id, unitId: l.unitId, quantity: l.quantity, unitCost: l.unitCost,
      discountType: l.discountType || null, discountValue: l.discountValue || null,
    }));
    try {
      if (orderId && existing.data) {
        await purchaseOrders.update(orgId, orderId, existing.data.rowVersion, { supplierId, warehouseId, expectedDeliveryDate: delivery || null, deliveryNotes: notes || null }, payloadLines);
        void queryClient.invalidateQueries({ queryKey: ['purchase-order', orgId, orderId] });
        router.push(`/purchase-orders/detail/?id=${orderId}`);
      } else {
        const input: PurchaseOrderInput = { supplierId, branchId, warehouseId, expectedDeliveryDate: delivery || null, deliveryNotes: notes || null, lines: payloadLines };
        const created = await purchaseOrders.create(orgId, clientId.current, input);
        clientId.current = newKey();
        void queryClient.invalidateQueries({ queryKey: ['purchase-orders', orgId] });
        router.push(`/purchase-orders/detail/?id=${created.id}`);
      }
    } catch (error) {
      setSaveError(error);
    } finally {
      setBusy(false);
    }
  }

  if (orderId && existing.isPending) return <Card className="p-6"><Spinner label={t('common.loading')} /></Card>;
  if (existing.error) return <ErrorAlert error={existing.error} onRetry={() => void existing.refetch()} />;
  if (!editable) return <Alert variant="warning">{t('purchase.not_editable')}</Alert>;

  return (
    <>
      <PageHeader title={orderId ? t('purchase.edit_title') : t('purchase.new_title')} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">{t('purchase.section_header')}</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-3">
              <Field label={t('purchase.field_supplier')} id="po-supplier" required>
                {(p) => (
                  <NativeSelect {...p} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">{t('purchase.choose')}</option>
                    {(supplierList.data?.items ?? []).map((s) => <option key={s.id} value={s.id}>{s.supplierNo} · {s.nameEn}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t('purchase.field_branch')} id="po-branch" required>
                  {(p) => (
                    <NativeSelect {...p} value={branchId} onChange={(e) => { setBranchId(e.target.value); setWarehouseId(''); }}>
                      {membership.branches.map((b) => <option key={b.id} value={b.id}>{b.nameEn} ({b.code})</option>)}
                    </NativeSelect>
                  )}
                </Field>
                <Field label={t('purchase.field_warehouse')} id="po-warehouse" required>
                  {(p) => (
                    <NativeSelect {...p} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                      {warehouseOptions.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.nameEn}</option>)}
                    </NativeSelect>
                  )}
                </Field>
              </div>
              <Field label={t('purchase.field_delivery')} id="po-delivery">
                {(p) => <Input {...p} type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} />}
              </Field>
              <Field label={t('purchase.field_notes')} id="po-notes">
                {(p) => <Input {...p} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />}
              </Field>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">{t('purchase.section_lines')}</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-3">
              <Field label={t('purchase.search')} id="po-search">
                {(p) => <Input {...p} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('purchase.search_hint')} />}
              </Field>
              <div className="grid grid-cols-1 gap-2">
                {(results.data?.items ?? []).map((p) => (
                  <button key={p.id} type="button" onClick={() => addProduct(p)}
                    className="flex items-center justify-between rounded-lg border border-border p-2 text-start hover:border-primary">
                    <span><span className="font-mono text-xs text-muted-foreground" dir="ltr">{p.sku}</span> {name(p)}</span>
                    <span className="text-xs">{t('purchase.add')}</span>
                  </button>
                ))}
              </div>
              {lines.length === 0 ? <p className="text-sm text-muted-foreground">{t('purchase.no_lines')}</p> : null}
              {lines.map((l) => (
                <div key={l.key} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium">{name(l.product)}<div className="font-mono text-xs text-muted-foreground" dir="ltr">{l.product.sku}</div></div>
                    <Button variant="ghost" size="sm" onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}>{t('common.remove')}</Button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Field label={t('purchase.col_unit')} id={`u-${l.key}`}>
                      {(p) => (
                        <NativeSelect {...p} value={l.unitId} onChange={(e) => patch(l.key, { unitId: e.target.value })}>
                          {(l.product.units ?? []).filter((u) => u.isPurchaseUnit).map((u) => <option key={u.unitId} value={u.unitId}>{unitName(u.unitId) || u.unitId}</option>)}
                          {(l.product.units ?? []).length === 0 ? <option value={l.unitId}>{unitName(l.unitId)}</option> : null}
                        </NativeSelect>
                      )}
                    </Field>
                    <Field label={t('purchase.col_qty')} id={`q-${l.key}`}>
                      {(p) => <Input {...p} inputMode="decimal" dir="ltr" value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} />}
                    </Field>
                    <Field label={t('purchase.col_cost')} id={`c-${l.key}`}>
                      {(p) => <Input {...p} inputMode="decimal" dir="ltr" value={l.unitCost} onChange={(e) => patch(l.key, { unitCost: e.target.value })} />}
                    </Field>
                    <Field label={t('purchase.col_discount')} id={`d-${l.key}`}>
                      {(p) => <Input {...p} inputMode="decimal" dir="ltr" value={l.discountValue} onChange={(e) => patch(l.key, { discountValue: e.target.value, discountType: e.target.value ? (l.discountType || 'percent') : '' })} />}
                    </Field>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid grid-cols-1 gap-1 p-4 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('purchase.subtotal')}</span><span className="tabular-nums">{fmt.money(totals?.net.toFixed(2) ?? 0)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('purchase.discount')}</span><span className="tabular-nums">{fmt.money(totals?.discount.toFixed(2) ?? 0)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('purchase.vat')}</span><span className="tabular-nums">{fmt.money(totals?.vat.toFixed(2) ?? 0)}</span></div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold"><span>{t('purchase.grand_total')}</span><span className="tabular-nums">{fmt.money(totals?.gross.toFixed(2) ?? 0)}</span></div>
            </CardContent>
          </Card>

          {invalid ? <Alert variant="warning">{t('purchase.invalid_line')}</Alert> : null}
          {message ? <Alert variant="success">{message}</Alert> : null}
          {saveError ? <ErrorAlert error={saveError} /> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.push(orderId ? `/purchase-orders/detail/?id=${orderId}` : '/purchase-orders/')}>{t('common.cancel')}</Button>
            <Button disabled={!canSave || !writable} onClick={() => void save()}>{busy ? t('common.saving') : t('purchase.save_draft')}</Button>
          </div>
          {!can('purchase.create') ? <p className="text-xs text-muted-foreground">{t('purchase.no_create')}</p> : null}
        </div>
      </div>
    </>
  );
}
