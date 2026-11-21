'use client';

import type { Brand, Category } from '@erp/data';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';
import { catalogKeys, useBrands, useCategories } from '../products/use-catalog-data';
import { useConnection } from '@/providers/connection-provider';

const blankCategory = { id: undefined as string | undefined, parentId: '', nameEn: '', nameAr: '', nameBn: '', sortOrder: '0', isActive: true };
const blankBrand = { id: undefined as string | undefined, name: '', isActive: true };

function CategoriesCard({ canWrite }: { canWrite: boolean }) {
  const { writable } = useConnection();
  const { t, name } = useI18n();
  const { orgId } = useMembership();
  const { catalog } = useServices();
  const queryClient = useQueryClient();
  const categories = useCategories(orgId);
  const [form, setForm] = React.useState(blankCategory);
  const [submitted, setSubmitted] = React.useState(false);

  const save = useMutation({
    mutationFn: () =>
      catalog.saveCategory({
        ...(form.id ? { id: form.id } : {}),
        orgId,
        parentId: form.parentId || null,
        nameEn: form.nameEn,
        nameAr: form.nameAr,
        nameBn: form.nameBn || null,
        sortOrder: Number.parseInt(form.sortOrder, 10) || 0,
        isActive: form.isActive,
      }),
    onSuccess: () => {
      setForm(blankCategory);
      setSubmitted(false);
      void queryClient.invalidateQueries({ queryKey: catalogKeys.categories(orgId) });
    },
  });

  const edit = (c: Category) =>
    setForm({ id: c.id, parentId: c.parentId ?? '', nameEn: c.nameEn, nameAr: c.nameAr, nameBn: c.nameBn ?? '', sortOrder: String(c.sortOrder), isActive: c.isActive });

  const required = (v: string) => (submitted && !v.trim() ? t('issues.required') : undefined);
  const byId = new Map((categories.data ?? []).map((c) => [c.id, c]));

  return (
    <Card>
      <CardHeader><CardTitle>{t('catalog.categories')}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {categories.error ? <ErrorAlert error={categories.error} onRetry={() => void categories.refetch()} /> : null}
        {categories.isPending ? <Spinner label={t('common.loading')} /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('catalog.name_en')}</TableHead>
                <TableHead>{t('catalog.name_ar')}</TableHead>
                <TableHead>{t('catalog.parent')}</TableHead>
                <TableHead><span className="sr-only">{t('common.actions')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.data?.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-muted-foreground">{t('catalog.empty')}</TableCell></TableRow>
              ) : null}
              {categories.data?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell dir="ltr" className="text-start">{c.nameEn} {!c.isActive ? <Badge variant="outline">{t('common.inactive')}</Badge> : null}</TableCell>
                  <TableCell dir="rtl" lang="ar" className="text-start">{c.nameAr}</TableCell>
                  <TableCell>{c.parentId ? name(byId.get(c.parentId) ?? { nameEn: '?', nameAr: '?' }) : '—'}</TableCell>
                  <TableCell>
                    {canWrite ? (
                      <Button variant="ghost" size="icon" aria-label={`${t('common.edit')} ${c.nameEn}`} onClick={() => edit(c)}>
                        <Pencil aria-hidden="true" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {canWrite ? (
          <form
            className="grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
              if (form.nameEn.trim() && form.nameAr.trim()) save.mutate();
            }}
          >
            {save.error ? <div className="sm:col-span-2"><ErrorAlert error={save.error} /></div> : null}
            <Field label={t('catalog.name_en')} required error={required(form.nameEn)}>
              {(p) => <Input {...p} dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />}
            </Field>
            <Field label={t('catalog.name_ar')} required error={required(form.nameAr)}>
              {(p) => <Input {...p} dir="rtl" lang="ar" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />}
            </Field>
            <Field label={t('catalog.name_bn')} optionalLabel={t('common.optional')}>
              {(p) => <Input {...p} lang="bn" value={form.nameBn} onChange={(e) => setForm({ ...form, nameBn: e.target.value })} />}
            </Field>
            <Field label={t('catalog.parent')} optionalLabel={t('common.optional')}>
              {(p) => (
                <NativeSelect {...p} value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
                  <option value="">{t('common.none')}</option>
                  {(categories.data ?? []).filter((c) => c.id !== form.id).map((c) => (
                    <option key={c.id} value={c.id}>{name(c)}</option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label={t('catalog.sort_order')}>
              {(p) => <Input {...p} dir="ltr" inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />}
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Checkbox checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              {t('common.active')}
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={save.isPending || !writable}>{form.id ? t('common.save') : t('catalog.add_category')}</Button>
              {form.id ? <Button variant="outline" onClick={() => setForm(blankCategory)}>{t('common.cancel')}</Button> : null}
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BrandsCard({ canWrite }: { canWrite: boolean }) {
  const { writable } = useConnection();
  const { t } = useI18n();
  const { orgId } = useMembership();
  const { catalog } = useServices();
  const queryClient = useQueryClient();
  const brands = useBrands(orgId);
  const [form, setForm] = React.useState(blankBrand);
  const [submitted, setSubmitted] = React.useState(false);

  const save = useMutation({
    mutationFn: () => catalog.saveBrand({ ...(form.id ? { id: form.id } : {}), orgId, name: form.name, isActive: form.isActive }),
    onSuccess: () => {
      setForm(blankBrand);
      setSubmitted(false);
      void queryClient.invalidateQueries({ queryKey: catalogKeys.brands(orgId) });
    },
  });

  return (
    <Card>
      <CardHeader><CardTitle>{t('catalog.brands')}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {brands.error ? <ErrorAlert error={brands.error} onRetry={() => void brands.refetch()} /> : null}
        {brands.isPending ? <Spinner label={t('common.loading')} /> : (
          <ul className="flex flex-wrap gap-2">
            {brands.data?.length === 0 ? <li className="text-sm text-muted-foreground">{t('catalog.empty')}</li> : null}
            {brands.data?.map((b: Brand) => (
              <li key={b.id}>
                <Button variant="outline" size="sm" disabled={!canWrite} onClick={() => setForm({ id: b.id, name: b.name, isActive: b.isActive })}>
                  {b.name}
                  {!b.isActive ? <Badge variant="outline">{t('common.inactive')}</Badge> : null}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <form
            className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
              if (form.name.trim()) save.mutate();
            }}
          >
            {save.error ? <div className="w-full"><ErrorAlert error={save.error} /></div> : null}
            <Field label={t('catalog.brand_name')} required error={submitted && !form.name.trim() ? t('issues.required') : undefined} className="min-w-56 flex-1">
              {(p) => <Input {...p} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <Checkbox checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              {t('common.active')}
            </label>
            <Button type="submit" disabled={save.isPending || !writable}>{form.id ? t('common.save') : t('catalog.add_brand')}</Button>
            {form.id ? <Button variant="outline" onClick={() => setForm(blankBrand)}>{t('common.cancel')}</Button> : null}
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CatalogSetup() {
  const { t } = useI18n();
  const { can } = useSession();
  return (
    <>
      <PageHeader title={t('nav.catalog_setup')} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <CategoriesCard canWrite={can('catalog.write')} />
        <BrandsCard canWrite={can('catalog.write')} />
      </div>
    </>
  );
}
