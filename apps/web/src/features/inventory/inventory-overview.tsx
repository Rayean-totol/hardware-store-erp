'use client';

import { localName, type Locale } from '@erp/i18n';
import { Alert, Badge, Button, Card, CardContent, Checkbox, NativeSelect, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@erp/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, History, SlidersHorizontal, Warehouse as WarehouseIcon } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useConnection } from '@/providers/connection-provider';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';
import { LegacyPendingPanel } from './legacy-pending-panel';
import { useWarehouses } from './use-warehouses';

export function InventoryOverview() {
  const { t, fmt, locale } = useI18n();
  const { can } = useSession();
  const { inventory } = useServices();
  const { state } = useConnection();
  const membership = useMembership();
  const warehouses = useWarehouses(membership.orgId);
  const [warehouseId, setWarehouseId] = React.useState('');
  const [lowOnly, setLowOnly] = React.useState(false);
  const selected = warehouseId || warehouses.data?.[0]?.id || '';

  // Read straight from the server. Figures are kept in memory only, never on the device.
  const stock = useQuery({
    queryKey: ['stock-levels', selected],
    enabled: Boolean(selected),
    queryFn: () => inventory.listStockLevels(selected),
  });

  const rows = stock.data ?? [];
  const visible = rows.filter((r) => !lowOnly || r.isLow);
  const lowCount = rows.filter((r) => r.isLow).length;

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

      {state !== 'online' ? <Alert variant="warning">{t('connection.offline_banner')}</Alert> : null}
      <div className="mb-4 flex flex-col gap-4">
        <LegacyPendingPanel />
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
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
                {t('inventory.low_only')}
              </label>
              <Badge variant={lowCount > 0 ? 'warning' : 'success'}>{t('inventory.low_count', { count: fmt.number(lowCount) })}</Badge>
            </div>
            {warehouses.error ? <ErrorAlert error={warehouses.error} /> : null}
            {stock.error ? <ErrorAlert error={stock.error} onRetry={() => void stock.refetch()} /> : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        {stock.isPending && Boolean(selected) ? <div className="p-6"><Spinner label={t('common.loading')} /></div> : (
          <div className="overflow-x-auto">
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
                    <TableCell className={`text-end tabular-nums ${Number(r.quantity) < 0 ? 'text-destructive' : ''}`}>{fmt.number(r.quantity)}</TableCell>
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
          </div>
        )}
      </Card>
    </>
  );
}
