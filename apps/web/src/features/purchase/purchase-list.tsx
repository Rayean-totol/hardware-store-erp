'use client';

import type { PurchaseOrderStatus } from '@erp/data';
import { Badge, Button, Card, NativeSelect, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@erp/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';

const STATUSES: Array<PurchaseOrderStatus | 'all'> = ['all', 'draft', 'submitted', 'approved', 'partially_received', 'fully_received', 'cancelled'];

export function PurchaseList() {
  const { t, fmt } = useI18n();
  const { purchaseOrders, suppliers } = useServices();
  const { orgId, branches } = useMembership();
  const { can } = useSession();
  const [status, setStatus] = React.useState<PurchaseOrderStatus | 'all'>('all');
  const [supplierId, setSupplierId] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [page, setPage] = React.useState(0);
  const PAGE = 25;
  React.useEffect(() => setPage(0), [status, supplierId, branchId]);

  const list = useQuery({
    queryKey: ['purchase-orders', orgId, { status, supplierId, branchId, page }],
    queryFn: () => purchaseOrders.list({ orgId, status, supplierId: supplierId || null, branchId: branchId || null, limit: PAGE, offset: page * PAGE }),
    placeholderData: keepPreviousData,
  });
  const supplierList = useQuery({ queryKey: ['suppliers', orgId, { status: 'all' }], queryFn: () => suppliers.list({ orgId, status: 'all', limit: 200 }) });

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <>
      <PageHeader
        title={t('purchase.title')}
        actions={
          can('purchase.create') ? (
            <Button asChild><Link href="/purchase-orders/new/"><Plus aria-hidden="true" />{t('purchase.new')}</Link></Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as PurchaseOrderStatus | 'all')} aria-label={t('purchase.filter_status')} className="w-auto">
          {STATUSES.map((s) => <option key={s} value={s}>{t(`purchase.status_${s}`)}</option>)}
        </NativeSelect>
        <NativeSelect value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label={t('purchase.filter_supplier')} className="w-auto">
          <option value="">{t('purchase.all_suppliers')}</option>
          {(supplierList.data?.items ?? []).map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}
        </NativeSelect>
        <NativeSelect value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label={t('purchase.filter_branch')} className="w-auto">
          <option value="">{t('purchase.all_branches')}</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.nameEn} ({b.code})</option>)}
        </NativeSelect>
      </div>

      {list.error ? <ErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.isPending ? (
        <Card className="p-6"><Spinner label={t('common.loading')} /></Card>
      ) : list.data && list.data.items.length === 0 ? (
        <Card className="py-10 text-center text-muted-foreground">{t('purchase.empty')}</Card>
      ) : (
        <Card>
          <Table aria-busy={list.isFetching}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('purchase.col_number')}</TableHead>
                <TableHead>{t('purchase.col_supplier')}</TableHead>
                <TableHead>{t('purchase.col_date')}</TableHead>
                <TableHead>{t('purchase.col_status')}</TableHead>
                <TableHead className="text-end">{t('purchase.col_total')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.items.map((po) => (
                <TableRow key={po.id}>
                  <TableCell className="font-mono text-xs" dir="ltr">
                    <Link href={`/purchase-orders/detail/?id=${po.id}`} className="font-medium hover:underline">{po.poNumber}</Link>
                  </TableCell>
                  <TableCell>{po.supplierNameEn ?? '—'}</TableCell>
                  <TableCell>{fmt.date(po.createdAt)}</TableCell>
                  <TableCell><Badge variant={po.status === 'cancelled' ? 'outline' : 'secondary'}>{t(`purchase.status_${po.status}`)}</Badge></TableCell>
                  <TableCell className="text-end tabular-nums">{po.grandTotal ? fmt.money(po.grandTotal) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{t('purchase.count', { count: fmt.number(total) })}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('common.previous')}</Button>
          <span>{t('common.page', { page: fmt.number(page + 1), pages: fmt.number(pages) })}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('common.next')}</Button>
        </div>
      </div>
    </>
  );
}
