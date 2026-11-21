'use client';

import type { Supplier, SupplierStatusFilter } from '@erp/data';
import { Badge, Button, Card, Input, NativeSelect, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@erp/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, Pencil, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';
import { fetchAllSuppliers, suppliersToCsv } from './supplier-csv';

const PAGE_SIZE = 25;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function SupplierList() {
  const { t, fmt, locale } = useI18n();
  const { suppliers } = useServices();
  const { orgId } = useMembership();
  const { can } = useSession();
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<SupplierStatusFilter>('active');
  const [page, setPage] = React.useState(0);
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<unknown>(null);
  const debounced = useDebounced(search.trim(), 250);

  React.useEffect(() => setPage(0), [debounced, status]);

  const list = useQuery({
    queryKey: ['suppliers', orgId, { debounced, status, page }],
    queryFn: () => suppliers.list({ orgId, search: debounced, status, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const all = await fetchAllSuppliers(suppliers, orgId, status, debounced);
      const blob = new Blob(['﻿', suppliersToCsv(all)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `suppliers-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  }

  const name = (s: Supplier) => (locale === 'ar' ? s.nameAr : locale === 'bn' ? s.nameBn ?? s.nameEn : s.nameEn);
  const updated = (s: Supplier) => fmt.date(s.updatedAt);

  return (
    <>
      <PageHeader
        title={t('suppliers.title')}
        actions={
          <>
            <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting}>
              <Download aria-hidden="true" />{exporting ? t('common.saving') : t('suppliers.export_csv')}
            </Button>
            {can('suppliers.manage') ? (
              <Button asChild>
                <Link href="/suppliers/new/"><Plus aria-hidden="true" />{t('suppliers.new')}</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('suppliers.search_placeholder')}
            aria-label={t('suppliers.search_placeholder')}
            className="ps-9"
          />
        </div>
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as SupplierStatusFilter)} aria-label={t('suppliers.status_filter')} className="w-auto">
          <option value="active">{t('suppliers.status_active')}</option>
          <option value="inactive">{t('suppliers.status_inactive')}</option>
          <option value="all">{t('suppliers.status_all')}</option>
        </NativeSelect>
      </div>

      {list.error ? <ErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : null}
      {exportError ? <ErrorAlert error={exportError} /> : null}

      {list.isPending ? (
        <Card className="p-6"><Spinner label={t('common.loading')} /></Card>
      ) : list.data && list.data.items.length === 0 ? (
        <Card className="py-10 text-center text-muted-foreground">{debounced ? t('suppliers.empty_search') : t('suppliers.empty')}</Card>
      ) : (
        <>
          {/* Wide screens: table */}
          <Card className="hidden md:block">
            <Table aria-busy={list.isFetching}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('suppliers.col_no')}</TableHead>
                  <TableHead>{t('suppliers.col_name')}</TableHead>
                  <TableHead>{t('suppliers.col_contact')}</TableHead>
                  <TableHead>{t('suppliers.col_city')}</TableHead>
                  <TableHead>{t('suppliers.col_status')}</TableHead>
                  <TableHead><span className="sr-only">{t('common.actions')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data?.items.map((s) => (
                  <TableRow key={s.id} className={s.isActive ? undefined : 'opacity-60'}>
                    <TableCell className="font-mono text-xs" dir="ltr">
                      {s.supplierNo}
                      <div className="text-muted-foreground">{s.supplierCode !== s.supplierNo ? s.supplierCode : null}</div>
                    </TableCell>
                    <TableCell>
                      <Link href={`/suppliers/profile/?id=${s.id}`} className="font-medium hover:underline">{name(s)}</Link>
                      {s.vatNumber ? <div className="text-xs text-muted-foreground" dir="ltr">{s.vatNumber}</div> : null}
                    </TableCell>
                    <TableCell>
                      {s.contactPerson ?? '—'}
                      {s.mobile ? <div className="text-xs text-muted-foreground" dir="ltr">{s.mobile}</div> : null}
                    </TableCell>
                    <TableCell>{s.city ?? '—'}</TableCell>
                    <TableCell>{s.isActive ? <Badge variant="success">{t('common.active')}</Badge> : <Badge variant="outline">{t('common.inactive')}</Badge>}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {can('suppliers.manage') ? (
                          <Button asChild variant="ghost" size="icon" aria-label={`${t('common.edit')} ${s.supplierNo}`}>
                            <Link href={`/suppliers/edit/?id=${s.id}`}><Pencil aria-hidden="true" /></Link>
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Small screens: cards */}
          <ul className="grid gap-3 md:hidden">
            {list.data?.items.map((s) => (
              <li key={s.id}>
                <Card className={`p-4 ${s.isActive ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-muted-foreground" dir="ltr">{s.supplierNo}</div>
                      <Link href={`/suppliers/profile/?id=${s.id}`} className="font-semibold">{name(s)}</Link>
                      <div className="text-sm text-muted-foreground">{[s.contactPerson, s.city].filter(Boolean).join(' · ') || '—'}</div>
                      {s.mobile ? <div className="text-sm" dir="ltr">{s.mobile}</div> : null}
                      <div className="text-xs text-muted-foreground">{t('suppliers.updated')}: {updated(s)}</div>
                    </div>
                    {s.isActive ? <Badge variant="success">{t('common.active')}</Badge> : <Badge variant="outline">{t('common.inactive')}</Badge>}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <Link href={`/suppliers/profile/?id=${s.id}`}>{t('suppliers.view')}</Link>
                    </Button>
                    {can('suppliers.manage') ? (
                      <Button asChild variant="outline" size="sm" className="flex-1">
                        <Link href={`/suppliers/edit/?id=${s.id}`}><Pencil aria-hidden="true" />{t('common.edit')}</Link>
                      </Button>
                    ) : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{t('suppliers.count', { count: fmt.number(total) })}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('common.previous')}</Button>
          <span>{t('common.page', { page: fmt.number(page + 1), pages: fmt.number(pages) })}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('common.next')}</Button>
        </div>
      </div>
    </>
  );
}
