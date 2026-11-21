'use client';

import { DataError, type Product, type SaleReceipt } from '@erp/data';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, NativeSelect, Spinner } from '@erp/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Pause, Play, Plus, Printer, Receipt, Search, ShoppingCart, Trash2 } from 'lucide-react';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { WriteHint } from '@/components/write-hint';
import { readPref, writePref } from '@/lib/storage';
import { useConnection } from '@/providers/connection-provider';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';
import { catalogKeys, useUnits } from '@/features/products/use-catalog-data';
import { addProduct, cartTotals, type CartLine, type HeldCart, parseHolds, patchLine, removeLine, settle } from './pos-cart';

const HOLDS_PREF = 'erp.pos.holds';
const SALE_TZ = 'Asia/Riyadh';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const newId = () => crypto.randomUUID();

export function PosScreen() {
  const { t, fmt, name, locale } = useI18n();
  const { catalog, inventory, sales } = useServices();
  const membership = useMembership();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const orgId = membership.orgId;
  const { state, revalidate } = useConnection();
  const online = state === 'online';
  const searchRef = React.useRef<HTMLInputElement>(null);

  const [branchId, setBranchId] = React.useState<string>(membership.branches[0]?.id ?? '');
  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebounced(search.trim(), 200);
  const [lines, setLines] = React.useState<CartLine[]>([]);
  const [customerId, setCustomerId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [cashTendered, setCashTendered] = React.useState('');
  const [card, setCard] = React.useState('');
  const [transfer, setTransfer] = React.useState('');
  const [holds, setHolds] = React.useState<HeldCart[]>([]);
  const [receipt, setReceipt] = React.useState<SaleReceipt | null>(null);
  const [printed, setPrinted] = React.useState(false);
  // One key per checkout attempt: a retry after a failure reuses it, so the server cannot record two sales.
  const clientIdRef = React.useRef<string>(newId());

  React.useEffect(() => setHolds(parseHolds(readPref(HOLDS_PREF))), []);
  const saveHolds = (next: HeldCart[]) => {
    setHolds(next);
    writePref(HOLDS_PREF, JSON.stringify(next));
  };

  const warehouses = useQuery({
    queryKey: ['pos-warehouses', orgId],
    queryFn: () => inventory.listWarehouses(orgId),
  });
  const branchWarehouses = (warehouses.data ?? []).filter((w) => w.branchId === branchId && w.isActive);
  const warehouseId = branchWarehouses[0]?.id ?? '';

  const products = useQuery({
    queryKey: [...catalogKeys.products(orgId), 'pos', debouncedSearch],
    queryFn: () => catalog.searchProducts({ orgId, search: debouncedSearch, includeArchived: false, limit: 24, offset: 0 }),
    placeholderData: keepPreviousData,
  });

  const customers = useQuery({ queryKey: ['pos-customers', orgId], queryFn: () => sales.listCustomers(orgId) });
  const customer = (customers.data ?? []).find((c) => c.id === customerId) ?? null;

  const recent = useQuery({
    queryKey: ['pos-recent', orgId, branchId],
    queryFn: () => sales.listRecentSales(orgId, branchId, 10),
    enabled: Boolean(branchId),
  });

  const units = useUnits(orgId);
  const unitLabel = (unitId: string) => {
    const u = (units.data ?? []).find((x) => x.id === unitId);
    return u ? name(u) : '';
  };

  const pricesIncludeVat = membership.pricesIncludeVat;
  const totals = cartTotals(lines, pricesIncludeVat);
  const gross = totals?.gross ?? '0.00';
  const settlement = settle(gross, { cashTendered, card, transfer });
  const balance = Number(settlement.balance);
  const canCredit = can('sales.credit') && Boolean(customer?.creditAllowed);
  const creditBlocked = balance > 0 && !canCredit;
  const lineInvalid = lines.length > 0 && totals === null;
  const checkoutBlockers: string[] = [];
  if (lines.length === 0) checkoutBlockers.push('pos.blocker_empty');
  if (lineInvalid) checkoutBlockers.push('pos.blocker_invalid_line');
  if (settlement.issues.length > 0) checkoutBlockers.push(`errors.${settlement.issues[0]}`);
  if (creditBlocked) checkoutBlockers.push(balance > 0 && !customer ? 'pos.blocker_customer' : 'pos.blocker_credit');
  if (!warehouseId) checkoutBlockers.push('pos.blocker_warehouse');
  if (!online) checkoutBlockers.push('pos.blocker_offline');

  const checkout = useMutation({
    mutationFn: async () => {
      // Ask the server again right before the sale: a stale "online" state must never submit.
      if (!(await revalidate())) throw new DataError('offline.writes_disabled', 'offline');
      return sales.finalizeSale({
        clientId: clientIdRef.current,
        orgId,
        branchId,
        warehouseId,
        deviceId: null,
        customerId: customer?.id ?? null,
        note,
        lines: lines.map((l) => ({
          productId: l.productId,
          unitId: l.unitId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountType: l.discountType,
          discountValue: l.discountType ? l.discountValue : null,
        })),
        payments: settlement.payments.map((p) => ({
          method: p.method as 'cash' | 'card' | 'transfer',
          amount: String(p.amount),
          tendered: p.tendered ? String(p.tendered) : null,
          reference: null,
        })),
      });
    },
    onSuccess: (result) => {
      setReceipt(result);
      setPrinted(false);
      clientIdRef.current = newId();
      setLines([]);
      setCashTendered('');
      setCard('');
      setTransfer('');
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['pos-recent', orgId, branchId] });
      void queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
    },
  });

  const add = (product: Product) => {
    setReceipt(null);
    setLines((current) => addProduct(current, product, newId));
    // Keep the scanner focused so the next item can be scanned straight away.
    searchRef.current?.focus();
  };

  const onSearchKey = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    // USB and Bluetooth scanners type the code and press Enter. Ask the server directly, so a fast scan
    // does not depend on the debounced list. An exact SKU or barcode adds one unit.
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = search.trim();
    if (!code) return;
    const page = await catalog.searchProducts({ orgId, search: code, includeArchived: false, limit: 5, offset: 0 });
    const exact = page.items.find((p) => p.sku.toLowerCase() === code.toLowerCase() || p.units.some((u) => u.barcode === code));
    const pick = exact ?? (page.items.length === 1 ? page.items[0] : undefined);
    if (pick) {
      add(pick);
      setSearch('');
    }
  };

  const setQuantity = (key: string, value: string) => setLines((c) => patchLine(c, key, { quantity: value }));

  const hold = () => {
    if (lines.length === 0) return;
    saveHolds([
      ...holds,
      { id: newId(), savedAt: new Date().toISOString(), customerId: customerId || null, note, lines },
    ]);
    setLines([]);
    setNote('');
    setCustomerId('');
    setCashTendered('');
    setCard('');
    setTransfer('');
  };

  const resume = (held: HeldCart) => {
    setLines(held.lines);
    setCustomerId(held.customerId ?? '');
    setNote(held.note);
    saveHolds(holds.filter((h) => h.id !== held.id));
  };

  const clear = () => {
    if (lines.length > 0 && !window.confirm(t('pos.clear_confirm'))) return;
    setLines([]);
    setCashTendered('');
    setCard('');
    setTransfer('');
  };

  const newSale = () => {
    setReceipt(null);
  };

  const timeFmt = React.useMemo(
    () => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : locale === 'bn' ? 'bn-BD' : 'en-GB', {
      timeZone: SALE_TZ, dateStyle: 'short', timeStyle: 'short',
    }),
    [locale],
  );

  const branchName = membership.branches.find((b) => b.id === branchId);

  return (
    <>
      <PageHeader
        title={t('pos.title')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label={t('pos.branch')} className="w-auto">
              {membership.branches.map((b) => (
                <option key={b.id} value={b.id}>{locale === 'ar' ? b.nameAr : b.nameEn} ({b.code})</option>
              ))}
            </NativeSelect>
          </div>
        }
      />

      {receipt ? (
        <Card className="mx-auto max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Receipt aria-hidden="true" />{t('pos.invoice_created')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="font-mono text-lg" dir="ltr">{receipt.invoiceNumber}</div>
            <div className="text-sm text-muted-foreground">{branchName ? `${branchName.nameEn} · ${branchName.code}` : ''}</div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt>{t('pos.subtotal')}</dt><dd className="text-end tabular-nums">{fmt.money(receipt.netTotal)}</dd>
              <dt>{t('pos.total_discount')}</dt><dd className="text-end tabular-nums">{fmt.money(receipt.discountTotal)}</dd>
              <dt>{t('pos.vat')}</dt><dd className="text-end tabular-nums">{fmt.money(receipt.vatTotal)}</dd>
              <dt className="font-semibold">{t('pos.total')}</dt><dd className="text-end font-semibold tabular-nums">{fmt.money(receipt.grossTotal)}</dd>
              <dt>{t('pos.paid')}</dt><dd className="text-end tabular-nums">{fmt.money(receipt.paidTotal)}</dd>
              <dt>{t('pos.change')}</dt><dd className="text-end tabular-nums">{fmt.money(receipt.changeGiven)}</dd>
              <dt>{t('pos.balance')}</dt><dd className="text-end tabular-nums">{fmt.money(receipt.balanceDue)}</dd>
            </dl>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" onClick={() => { window.print(); setPrinted(true); }}>
                <Printer aria-hidden="true" />{t('pos.print')}{printed ? ' ✓' : ''}
              </Button>
              <Button onClick={newSale}><Plus aria-hidden="true" />{t('pos.new_sale')}</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 pb-28 md:pb-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)]">
          {/* Product search */}
          <section aria-label={t('pos.search')} className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKey}
                ref={searchRef}
                placeholder={t('pos.search_placeholder')}
                aria-label={t('pos.search')}
                className="ps-9"
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('pos.scan_hint')}</p>
            {products.error ? <ErrorAlert error={products.error} onRetry={() => void products.refetch()} /> : null}
            {products.isPending ? <Spinner label={t('common.loading')} /> : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
              {(products.data?.items ?? []).map((p) => {
                const unit = p.units.find((u) => u.isSaleUnit && u.salePrice !== null) ?? p.units.find((u) => u.isBase);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => add(p)}
                    className="flex min-h-24 flex-col items-start gap-1 rounded-lg border border-border bg-card p-3 text-start transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={`${t('pos.add')} ${p.sku} ${name(p)}`}
                  >
                    <span className="font-mono text-xs text-muted-foreground" dir="ltr">{p.sku}</span>
                    <span className="line-clamp-2 text-sm font-medium">{name(p)}</span>
                    <span className="mt-auto text-sm tabular-nums">
                      {unit?.salePrice ? `${fmt.money(unit.salePrice)} / ${unitLabel(unit.unitId)}` : t('pos.no_price')}
                    </span>
                  </button>
                );
              })}
            </div>
            {products.data && products.data.items.length === 0 ? <p className="text-sm text-muted-foreground">{t('pos.no_results')}</p> : null}
          </section>

          {/* Cart */}
          <section aria-label={t('pos.cart')} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold"><ShoppingCart className="size-4" aria-hidden="true" />{t('pos.cart')}</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={hold} disabled={lines.length === 0}>
                  <Pause aria-hidden="true" />{t('pos.hold')}
                </Button>
                <Button variant="ghost" size="sm" onClick={clear} disabled={lines.length === 0}>{t('pos.clear')}</Button>
              </div>
            </div>
            {lines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('pos.cart_empty')}</p>
            ) : (
              <ul className="space-y-2">
                {lines.map((l) => {
                  const lineName = name({ nameEn: l.nameEn, nameAr: l.nameAr, nameBn: l.nameBn });
                  return (
                    <li key={l.key} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-mono text-xs text-muted-foreground" dir="ltr">{l.sku}</div>
                          <div className="text-sm font-medium">{lineName}</div>
                          <div className="text-xs text-muted-foreground">{unitLabel(l.unitId)} · {fmt.money(l.unitPrice ?? l.listPrice)}</div>
                        </div>
                        <Button variant="ghost" size="icon" aria-label={`${t('pos.remove')} ${l.sku}`} onClick={() => setLines((c) => removeLine(c, l.key))}>
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="icon" aria-label={`${t('pos.qty_less')} ${l.sku}`}
                          onClick={() => setLines((c) => patchLine(c, l.key, { quantity: String(Math.max(0, Number(l.quantity) - 1)) }))}>
                          <Minus aria-hidden="true" />
                        </Button>
                        <Input
                          inputMode="decimal"
                          value={l.quantity}
                          onChange={(e) => setQuantity(l.key, e.target.value)}
                          aria-label={`${t('pos.col_qty')} ${l.sku}`}
                          className="h-9 w-20 text-center"
                        />
                        <Button variant="outline" size="icon" aria-label={`${t('pos.qty_more')} ${l.sku}`}
                          onClick={() => setLines((c) => patchLine(c, l.key, { quantity: String(Number(l.quantity || 0) + 1) }))}>
                          <Plus aria-hidden="true" />
                        </Button>
                        <span className="ms-auto font-semibold tabular-nums">
                          {(() => {
                            const one = cartTotals([l], pricesIncludeVat);
                            return one ? fmt.money(one.gross) : '—';
                          })()}
                        </span>
                      </div>
                      {can('sales.discount') || can('sales.price_override') ? (
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {can('sales.discount') ? (
                            <>
                              <NativeSelect
                                value={l.discountType ?? ''}
                                onChange={(e) => setLines((c) => patchLine(c, l.key, { discountType: (e.target.value || null) as CartLine['discountType'] }))}
                                aria-label={`${t('pos.discount_type')} ${l.sku}`}
                              >
                                <option value="">{t('pos.no_discount')}</option>
                                <option value="percent">{t('pos.discount_percent')}</option>
                                <option value="fixed">{t('pos.discount_fixed')}</option>
                              </NativeSelect>
                              <Input
                                inputMode="decimal"
                                value={l.discountValue}
                                onChange={(e) => setLines((c) => patchLine(c, l.key, { discountValue: e.target.value }))}
                                aria-label={`${t('pos.discount_value')} ${l.sku}`}
                                placeholder={t('pos.discount_value')}
                                disabled={!l.discountType}
                              />
                            </>
                          ) : null}
                          {can('sales.price_override') ? (
                            <Input
                              inputMode="decimal"
                              value={l.unitPrice ?? ''}
                              onChange={(e) => setLines((c) => patchLine(c, l.key, { unitPrice: e.target.value === '' ? null : e.target.value }))}
                              aria-label={`${t('pos.override_price')} ${l.sku}`}
                              placeholder={t('pos.override_price')}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {holds.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="text-sm font-medium">{t('pos.holds')} ({holds.length})</div>
                {holds.map((h) => (
                  <div key={h.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">{timeFmt.format(new Date(h.savedAt))} · {h.lines.length}</span>
                    <Button size="sm" variant="outline" onClick={() => resume(h)}><Play aria-hidden="true" />{t('pos.resume')}</Button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {/* Totals and payment */}
          <section id="pos-payment" aria-label={t('pos.payment')} className="space-y-3">
            <Card>
              <CardContent className="space-y-2 p-4 text-sm">
                <Row label={t('pos.subtotal')} value={fmt.money(totals?.net ?? 0)} />
                <Row label={t('pos.total_discount')} value={fmt.money(totals?.discount ?? 0)} />
                <Row label={t('pos.vat')} value={fmt.money(totals?.vat ?? 0)} />
                <div className="border-t border-border pt-2">
                  <Row label={t('pos.total')} value={fmt.money(gross)} strong />
                </div>
                <p className="text-xs text-muted-foreground">{t('pos.vat_note', { rate: '15%' })}</p>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">{t('pos.customer')}</span>
                <NativeSelect value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full" aria-label={t('pos.customer')}>
                  <option value="">{t('pos.customer_none')}</option>
                  {(customers.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.creditAllowed ? ' · ' + t('pos.credit_ok') : ''}</option>
                  ))}
                </NativeSelect>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">{t('pos.note')}</span>
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">{t('pos.cash_tendered')}</span>
                <Input inputMode="decimal" value={cashTendered} onChange={(e) => setCashTendered(e.target.value)} aria-label={t('pos.cash_tendered')} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">{t('pos.card')}</span>
                <Input inputMode="decimal" value={card} onChange={(e) => setCard(e.target.value)} aria-label={t('pos.card')} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">{t('pos.transfer')}</span>
                <Input inputMode="decimal" value={transfer} onChange={(e) => setTransfer(e.target.value)} aria-label={t('pos.transfer')} />
              </label>
            </div>

            <Card>
              <CardContent className="space-y-2 p-4 text-sm">
                <Row label={t('pos.paid')} value={fmt.money(settlement.paid)} />
                <Row label={t('pos.change')} value={fmt.money(settlement.change)} />
                <Row label={t('pos.balance')} value={fmt.money(settlement.balance)} strong={balance > 0} />
                {balance > 0 ? <p className="text-xs text-muted-foreground">{t('pos.balance_credit_hint')}</p> : null}
              </CardContent>
            </Card>

            {checkout.error ? <ErrorAlert error={checkout.error} /> : null}
            {checkoutBlockers.length > 0 ? (
              <ul className="list-inside list-disc text-xs text-muted-foreground" aria-live="polite">
                {[...new Set(checkoutBlockers)].map((b) => (
                  <li key={b}>{t(b as never)}</li>
                ))}
              </ul>
            ) : null}

            <div className="pt-2">
              <WriteHint />
              <Button
                className="w-full"
                size="lg"
                disabled={checkoutBlockers.length > 0 || checkout.isPending}
                onClick={() => checkout.mutate()}
              >
                {checkout.isPending ? t('pos.checking') : `${t('pos.checkout')} · ${fmt.money(gross)}`}
              </Button>
            </div>
          </section>
        </div>
      )}

      {/* Phones: the total and the way to payment stay above the navigation bar while the cart is open. */}
      {!receipt && lines.length > 0 ? (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-2 backdrop-blur md:hidden">
          <div className="min-w-0 text-sm">
            <div className="text-muted-foreground">{t('pos.items_count', { count: fmt.number(lines.length) })}</div>
            <div className="font-semibold tabular-nums">{fmt.money(gross)}</div>
          </div>
          <Button onClick={() => document.getElementById('pos-payment')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            {t('pos.review_pay')}
          </Button>
        </div>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">{t('pos.recent_sales')}</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.error ? <ErrorAlert error={recent.error} onRetry={() => void recent.refetch()} /> : null}
          {recent.data && recent.data.length === 0 ? <p className="text-sm text-muted-foreground">{t('pos.no_sales')}</p> : null}
          <ul className="divide-y divide-border">
            {(recent.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-mono" dir="ltr">{s.invoiceNumber}</span>
                <span className="text-muted-foreground">{timeFmt.format(new Date(s.createdAt))}</span>
                <span className="tabular-nums">{fmt.money(s.grossTotal)}</span>
                <Badge variant={s.status === 'voided' ? 'outline' : 'success'}>{t(s.status === 'voided' ? 'pos.status_voided' : 'pos.status_final')}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? 'text-base font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
