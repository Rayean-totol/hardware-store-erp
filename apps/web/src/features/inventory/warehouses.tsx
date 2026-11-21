'use client';

import { localName, type Locale } from '@erp/i18n';
import { Alert, Badge, Button, Card, CardContent, Checkbox, Field, Input, NativeSelect, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@erp/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';
import { useWarehouses } from './use-warehouses';
import { useConnection } from '@/providers/connection-provider';

const blank = { id: undefined as string | undefined, branchId: '', code: '', nameEn: '', nameAr: '', nameBn: '', isActive: true };

export function WarehousesPage() {
  const { writable } = useConnection();
  const { t, locale } = useI18n();
  const { inventory } = useServices();
  const { can } = useSession();
  const { orgId, branches } = useMembership();
  const queryClient = useQueryClient();
  const warehouses = useWarehouses(orgId);
  const [form, setForm] = React.useState({ ...blank, branchId: branches[0]?.id ?? '' });
  const [submitted, setSubmitted] = React.useState(false);
  const canManage = can('warehouse.manage');

  const save = useMutation({
    mutationFn: () => inventory.saveWarehouse({
      ...(form.id ? { id: form.id } : {}),
      orgId, branchId: form.branchId, code: form.code, nameEn: form.nameEn, nameAr: form.nameAr,
      nameBn: form.nameBn || null, isActive: form.isActive,
    }),
    onSuccess: () => {
      setForm({ ...blank, branchId: branches[0]?.id ?? '' });
      setSubmitted(false);
      void queryClient.invalidateQueries({ queryKey: ['warehouses', orgId] });
    },
  });

  const branchName = (id: string) => {
    const b = branches.find((x) => x.id === id);
    return b ? (locale === 'ar' ? b.nameAr : b.nameEn) : '—';
  };
  const req = (v: string) => (submitted && !v.trim() ? t('issues.required') : undefined);

  return (
    <>
      <PageHeader title={t('warehouses.title')} />
      {warehouses.error ? <ErrorAlert error={warehouses.error} /> : null}
      <Card className="mb-6">
        {warehouses.isPending ? <div className="p-6"><Spinner label={t('common.loading')} /></div> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('warehouses.code')}</TableHead>
                <TableHead>{t('warehouses.name')}</TableHead>
                <TableHead>{t('warehouses.branch')}</TableHead>
                <TableHead>{t('products.col_status')}</TableHead>
                <TableHead><span className="sr-only">{t('common.actions')}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {warehouses.data?.map((w) => (
                <TableRow key={w.id}>
                  <TableCell dir="ltr" className="font-mono text-xs">{w.code}</TableCell>
                  <TableCell>{localName({ nameEn: w.nameEn, nameAr: w.nameAr, nameBn: w.nameBn }, locale as Locale)}</TableCell>
                  <TableCell>{branchName(w.branchId)}</TableCell>
                  <TableCell>{w.isActive ? <Badge variant="success">{t('common.active')}</Badge> : <Badge variant="outline">{t('common.inactive')}</Badge>}</TableCell>
                  <TableCell>
                    {canManage ? (
                      <Button variant="ghost" size="sm" onClick={() => setForm({
                        id: w.id, branchId: w.branchId, code: w.code, nameEn: w.nameEn, nameAr: w.nameAr, nameBn: w.nameBn ?? '', isActive: w.isActive,
                      })}>{t('common.edit')}</Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {canManage ? (
        <Card>
          <CardContent className="pt-5">
            <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
              if (form.code.trim() && form.nameEn.trim() && form.nameAr.trim() && form.branchId) save.mutate();
            }}>
              {save.error ? <div className="md:col-span-2"><ErrorAlert error={save.error} /></div> : null}
              {!form.id ? <Alert variant="info" className="md:col-span-2">{t('warehouses.new_hint')}</Alert> : null}
              <Field label={t('warehouses.branch')} required>
                {(p) => (
                  <NativeSelect {...p} value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                    {branches.map((b) => <option key={b.id} value={b.id}>{locale === 'ar' ? b.nameAr : b.nameEn}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('warehouses.code')} required error={req(form.code)}>
                {(p) => <Input {...p} dir="ltr" className="uppercase" maxLength={16} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />}
              </Field>
              <Field label={t('warehouses.name_en')} required error={req(form.nameEn)}>
                {(p) => <Input {...p} dir="ltr" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />}
              </Field>
              <Field label={t('warehouses.name_ar')} required error={req(form.nameAr)}>
                {(p) => <Input {...p} dir="rtl" lang="ar" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />}
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                {t('common.active')}
              </label>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit" disabled={save.isPending || !writable}>{form.id ? t('common.save') : t('warehouses.add')}</Button>
                {form.id ? <Button variant="outline" onClick={() => setForm({ ...blank, branchId: branches[0]?.id ?? '' })}>{t('common.cancel')}</Button> : null}
              </div>
            </form>
          </CardContent>
        </Card>
      ) : <Alert variant="warning">{t('warehouses.no_permission')}</Alert>}
    </>
  );
}
