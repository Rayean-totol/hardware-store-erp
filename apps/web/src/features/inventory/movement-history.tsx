'use client';

import type { Movement } from '@erp/data';
import { localName, type Locale } from '@erp/i18n';
import { Alert, Button, Card, NativeSelect, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@erp/ui';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useSession } from '@/providers/session-provider';
import { useSync } from '@/providers/sync-provider';
import { useWarehouses } from './use-warehouses';

const PAGE = 50;

export function MovementHistory() {
  const { t, fmt, locale } = useI18n();
  const { inventory } = useServices();
  const { membership } = useSession();
  const sync = useSync();
  const warehouses = useWarehouses(membership?.orgId ?? '');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [type, setType] = React.useState<'' | 'stock_in' | 'stock_out' | 'adjustment'>('');
  const [page, setPage] = React.useState(0);
  const wh = warehouseId || warehouses.data?.[0]?.id || '';

  const history = useQuery({
    queryKey: ['movements', wh, type, page],
    enabled: Boolean(wh) && sync.online,
    queryFn: () => inventory.listMovements({ warehouseId: wh, movementType: type || null, limit: PAGE, offset: page * PAGE }),
  });

  return (
    <>
      <PageHeader title={t('inventory.history')} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <NativeSelect aria-label={t('inventory.warehouse')} className="w-auto" value={wh} onChange={(e) => { setWarehouseId(e.target.value); setPage(0); }}>
          {(warehouses.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>{localName({ nameEn: w.nameEn, nameAr: w.nameAr, nameBn: w.nameBn }, locale as Locale)}</option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t('movement.type')} className="w-auto" value={type} onChange={(e) => { setType(e.target.value as typeof type); setPage(0); }}>
          <option value="">{t('common.all')}</option>
          <option value="stock_in">{t('movement.type_stock_in')}</option>
          <option value="stock_out">{t('movement.type_stock_out')}</option>
          <option value="adjustment">{t('movement.type_adjustment')}</option>
        </NativeSelect>
      </div>

      {!sync.online ? <Alert variant="info">{t('history.offline')}</Alert> : null}
      {history.error ? <ErrorAlert error={history.error} onRetry={() => void history.refetch()} /> : null}

      <Card>
        {history.isPending && sync.online ? <div className="p-6"><Spinner label={t('common.loading')} /></div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('history.when')}</TableHead>
                <TableHead>{t('movement.type')}</TableHead>
                <TableHead className="text-end">{t('movement.change')}</TableHead>
                <TableHead className="text-end">{t('inventory.on_hand')}</TableHead>
                <TableHead>{t('movement.reason')}</TableHead>
                <TableHead>{t('movement.reference')}</TableHead>
                <TableHead>{t('history.device')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history.data ?? []).length === 0 && sync.online ? (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{t('history.empty')}</TableCell></TableRow>
              ) : null}
              {(history.data ?? []).map((m: Movement) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap text-xs">{fmt.dateTime(m.recordedAt)}</TableCell>
                  <TableCell>{t(`movement.type_${m.movementType}` as 'movement.type_stock_in')}</TableCell>
                  <TableCell className={`text-end tabular-nums ${m.quantityChange.startsWith('-') ? 'text-destructive' : ''}`}>
                    {m.quantityChange.startsWith('-') ? '−' : '+'}{fmt.number(m.quantityChange.replace('-', ''))}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{fmt.number(m.balanceAfter)}</TableCell>
                  <TableCell>{m.reasonCode ? t(`reason.${m.reasonCode}` as 'reason.other') : '—'}</TableCell>
                  <TableCell dir="ltr" className="font-mono text-xs">{m.reference ?? '—'}</TableCell>
                  <TableCell dir="ltr" className="font-mono text-xs">{m.deviceId ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {sync.online ? (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('common.previous')}</Button>
          <span>{t('common.page', { page: fmt.number(page + 1), pages: fmt.number(page + 1) })}</span>
          <Button variant="outline" size="sm" disabled={(history.data ?? []).length < PAGE} onClick={() => setPage(page + 1)}>{t('common.next')}</Button>
        </div>
      ) : null}
    </>
  );
}
