'use client';

import { localName, type Locale } from '@erp/i18n';
import { Alert, Badge, Button, Card, CardContent, Checkbox, NativeSelect, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@erp/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, History, SlidersHorizontal, Warehouse as WarehouseIcon } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useSession } from '@/providers/session-provider';
import { useSync } from '@/providers/sync-provider';
import { SyncPanel } from './sync-panel';
import { useWarehouses } from './use-warehouses';

export interface StockRow {
  productId: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  nameBn: string | null;
  quantity: string;
  averageCost: string;
  reorderLevel: string | null;
  isLow: boolean;
  queued: number;
}

export function InventoryOverview() {
  const { t, fmt, locale } = useI18n();
  const { can, membership } = useSession();
  const sync = useSync();
  const warehouses = useWarehouses(membership?.orgId ?? '');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [lowOnly, setLowOnly] = React.useState(false);
  const selected = warehouseId || warehouses.data?.[0]?.id || '';

  const stock = useQuery({
    queryKey: ['stock', membership?.orgId, selected, sync.online],
    enabled: sync.ready && Boolean(sync.engine) && Boolean(selected),
    queryFn: async (): Promise<{ rows: StockRow[]; serverError: string | null; syncedAt: string | null }> => {
      const engine = sync.engine!;
      let serverError: string | null = null;
      try {
        if (!(await engine.hasCatalog())) await engine.refreshCatalog();
        await engine.flush();
        await engine.refreshWarehouse(selected);
      } catch (error) {
        // Offline or server trouble: keep showing what the device knows, and say so.
        serverError = error instanceof Error ? error.message : String(error);
      }
      const projected = new Map((await engine.projectedLevels(selected)).map((l) => [l.productId, l]));
      const products = await engine.catalogProducts();
      const snapshotInfo = await engine.status();
      const rows = products.map((p): StockRow => {
        const level = projected.get(p.id);
        const quantity = level?.quantity.toString() ?? '0';
        const reorder = p.reorderLevel;
        return {
          productId: p.id, sku: p.sku, nameEn: p.nameEn, nameAr: p.nameAr, nameBn: p.nameBn,
          quantity, averageCost: level?.averageCost.toString() ?? '0', reorderLevel: reorder,
          isLow: reorder !== null && Number(quantity) <= Number(reorder), queued: level?.pendingCount ?? 0,
        };
      });
      return { rows, serverError, syncedAt: snapshotInfo.lastSyncedAt };
    },
  });

  const visible = (stock.data?.rows ?? []).filter((r) => !lowOnly || r.isLow);
  const lowCount = (stock.data?.rows ?? []).filter((r) => r.isLow).length;

  return (
    <>
      <PageHeader
        title={t('inventory.title')}
        actions={
          <>
            {can('inventory.move') ? (
              <Button asChild variant="outline"><Link href="/inventory/move/?type=stock_in"><ArrowDownToLine aria-hidden="true" />{t('inventory.stock_in')}</Link></Button>
            ) : null}
            {can('inventory.move') ? (
              <Button asChild variant="outline"><Link href="/inventory/move/?type=stock_out"><ArrowUpFromLine aria-hidden="true" />{t('inventory.stock_out')}</Link></Button>
            ) : null}
            {can('inventory.adjust') ? (
              <Button asChild variant="outline"><Link href="/inventory/move/?type=adjustment"><SlidersHorizontal aria-hidden="true" />{t('inventory.adjust')}</Link></Button>
            ) : null}
            <Button asChild variant="ghost"><Link href="/inventory/history/"><History aria-hidden="true" />{t('inventory.history')}</Link></Button>
          </>
        }
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <SyncPanel />
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
            <div className="flex flex-wrap items-center gap-3">
              <WarehouseIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <NativeSelect aria-label={t('inventory.warehouse')} className="w-auto min-w-48" value={selected}
                onChange={(e) => setWarehouseId(e.target.value)}>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>{localName({ nameEn: w.nameEn, nameAr: w.nameAr, nameBn: w.nameBn }, locale as Locale)}</option>
                ))}
              </NativeSelect>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
                {t('inventory.low_only')}
              </label>
              <Badge variant={lowCount > 0 ? 'warning' : 'success'}>{t('inventory.low_count', { count: fmt.number(lowCount) })}</Badge>
            </div>
            {stock.data?.serverError ? (
              <Alert variant="warning">
                <p>{t('inventory.showing_device_data')}</p>
                <p className="text-xs">{stock.data.serverError}</p>
              </Alert>
            ) : null}
            {stock.error ? <ErrorAlert error={stock.error} onRetry={() => void stock.refetch()} /> : null}
          </CardContent>
        </Card>
      </div>

      {warehouses.error ? <ErrorAlert error={warehouses.error} /> : null}
      <Card>
        {stock.isPending || !sync.ready ? <div className="p-6"><Spinner label={t('common.loading')} /></div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('products.col_sku')}</TableHead>
                <TableHead>{t('products.col_name')}</TableHead>
                <TableHead className="text-end">{t('inventory.on_hand')}</TableHead>
                <TableHead className="hidden text-end md:table-cell">{t('inventory.reorder_level')}</TableHead>
                <TableHead className="hidden text-end md:table-cell">{t('inventory.avg_cost')}</TableHead>
                <TableHead>{t('products.col_status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">{t('inventory.empty')}</TableCell></TableRow>
              ) : null}
              {visible.map((r) => (
                <TableRow key={r.productId}>
                  <TableCell dir="ltr" className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell>{localName({ nameEn: r.nameEn, nameAr: r.nameAr, nameBn: r.nameBn }, locale as Locale)}</TableCell>
                  <TableCell className={`text-end tabular-nums ${Number(r.quantity) < 0 ? 'text-destructive' : ''}`}>
                    {fmt.number(r.quantity)}
                    {r.queued > 0 ? <span className="ms-1 text-xs text-muted-foreground">({t('inventory.queued_marker', { count: r.queued })})</span> : null}
                  </TableCell>
                  <TableCell className="hidden text-end tabular-nums md:table-cell">{r.reorderLevel ? fmt.number(r.reorderLevel) : '—'}</TableCell>
                  <TableCell className="hidden text-end tabular-nums md:table-cell">{fmt.money(r.averageCost)}</TableCell>
                  <TableCell>
                    {r.isLow ? <Badge variant="warning">{t('inventory.low')}</Badge> : <Badge variant="success">{t('inventory.ok')}</Badge>}
                    {Number(r.quantity) < 0 ? <Badge variant="destructive" className="ms-1">{t('inventory.negative')}</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
