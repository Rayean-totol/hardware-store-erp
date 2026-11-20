'use client';

import type { Product, Unit } from '@erp/data';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  NativeSelect,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@erp/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Pencil, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';
import { catalogKeys, useCategories, useUnits } from './use-catalog-data';

const PAGE_SIZE = 25;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function ProductList() {
  const { t, fmt, name } = useI18n();
  const { catalog } = useServices();
  const { orgId } = useMembership();
  const { can } = useSession();
  const queryClient = useQueryClient();

  const [search, setSearch] = React.useState('');
  const [categoryId, setCategoryId] = React.useState('');
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [confirm, setConfirm] = React.useState<Product | null>(null);
  const debouncedSearch = useDebounced(search, 250);

  React.useEffect(() => setPage(0), [debouncedSearch, categoryId, includeArchived]);

  const units = useUnits(orgId);
  const categories = useCategories(orgId);
  const products = useQuery({
    queryKey: [...catalogKeys.products(orgId), { debouncedSearch, categoryId, includeArchived, page }],
    queryFn: () =>
      catalog.searchProducts({
        orgId,
        search: debouncedSearch,
        categoryId: categoryId || null,
        includeArchived,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const archive = useMutation({
    mutationFn: (p: Product) => catalog.setProductArchived(p.id, !p.archivedAt),
    onSuccess: () => {
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: catalogKeys.products(orgId) });
    },
  });

  const unitById = React.useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u])), [units.data]);
  const categoryById = React.useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);
  const total = products.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const unitLabel = (u: Unit | undefined) => (u ? name(u) : '?');

  return (
    <>
      <PageHeader
        title={t('products.title')}
        actions={
          can('catalog.write') ? (
            <Button asChild>
              <Link href="/products/new/">
                <Plus aria-hidden="true" />
                {t('products.new')}
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('products.search_placeholder')}
            aria-label={t('products.search_placeholder')}
            className="ps-9"
            autoFocus
          />
        </div>
        <NativeSelect
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label={t('products.col_category')}
          className="w-auto"
        >
          <option value="">{t('products.all_categories')}</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.parentId ? '— ' : ''}
              {name(c)}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          {t('products.include_archived')}
        </label>
      </div>

      {products.error ? <ErrorAlert error={products.error} onRetry={() => void products.refetch()} /> : null}
      {archive.error ? <ErrorAlert error={archive.error} /> : null}

      <Card>
        {products.isPending ? (
          <div className="p-6"><Spinner label={t('common.loading')} /></div>
        ) : (
          <Table aria-busy={products.isFetching}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('products.col_sku')}</TableHead>
                <TableHead>{t('products.col_name')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('products.col_category')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('products.col_units')}</TableHead>
                <TableHead className="text-end">{t('products.col_price')}</TableHead>
                <TableHead>{t('products.col_status')}</TableHead>
                <TableHead><span className="sr-only">{t('common.actions')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.data?.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    {t('products.empty')}
                  </TableCell>
                </TableRow>
              ) : null}
              {products.data?.items.map((p) => {
                const priced = p.units.find((u) => u.isBase && u.salePrice) ?? p.units.find((u) => u.salePrice);
                const category = p.categoryId ? categoryById.get(p.categoryId) : undefined;
                return (
                  <TableRow key={p.id} className={p.archivedAt ? 'opacity-60' : undefined}>
                    <TableCell className="font-mono text-xs" dir="ltr">{p.sku}</TableCell>
                    <TableCell>
                      <div className="font-medium">{name(p)}</div>
                      {name(p) !== p.nameEn ? <div className="text-xs text-muted-foreground" dir="ltr">{p.nameEn}</div> : null}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{category ? name(category) : '—'}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {p.units.map((u) => (
                          <Badge key={u.id} variant={u.isBase ? 'default' : 'secondary'}>
                            {unitLabel(unitById.get(u.unitId))}
                            {u.isBase ? '' : ` × ${fmt.number(u.factor)}`}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {priced?.salePrice ? (
                        <>
                          {fmt.money(priced.salePrice)}
                          <span className="block text-xs text-muted-foreground">/ {unitLabel(unitById.get(priced.unitId))}</span>
                        </>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      {p.archivedAt ? <Badge variant="outline">{t('common.archived')}</Badge> : <Badge variant="success">{t('common.active')}</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="icon" aria-label={`${t('common.edit')} ${p.sku}`}>
                          <Link href={`/products/edit/?id=${p.id}`}><Pencil aria-hidden="true" /></Link>
                        </Button>
                        {can('catalog.archive') ? (
                          p.archivedAt ? (
                            <Button variant="ghost" size="icon" aria-label={`${t('common.restore')} ${p.sku}`} onClick={() => archive.mutate(p)}>
                              <ArchiveRestore aria-hidden="true" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" aria-label={`${t('common.archive')} ${p.sku}`} onClick={() => setConfirm(p)}>
                              <Archive aria-hidden="true" />
                            </Button>
                          )
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{t('products.count', { count: fmt.number(total) })}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t('common.previous')}
          </Button>
          <span>{t('common.page', { page: fmt.number(page + 1), pages: fmt.number(pages) })}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            {t('common.next')}
          </Button>
        </div>
      </div>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogTitle>{t('common.archive')}</DialogTitle>
          <DialogDescription>{confirm ? t('products.archive_confirm', { name: name(confirm) }) : null}</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" disabled={archive.isPending} onClick={() => confirm && archive.mutate(confirm)}>
              {t('common.archive')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
