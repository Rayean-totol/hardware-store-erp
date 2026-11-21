'use client';

import type { Supplier, SupplierInput } from '@erp/data';
import { supplierIssue, type SupplierIssue } from '@erp/domain';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Field, Input, NativeSelect, Spinner } from '@erp/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';

type Form = Record<keyof Omit<SupplierInput, 'id' | 'isActive'>, string> & { isActive: boolean };

const EMPTY: Form = {
  supplierCode: '', nameEn: '', nameAr: '', nameBn: '', contactPerson: '', mobile: '', whatsapp: '', email: '',
  address: '', city: '', countryCode: 'SA', vatNumber: '', crNumber: '', openingBalance: '0', creditLimit: '',
  paymentTermsDays: '', bankName: '', bankAccountName: '', iban: '', notes: '', isActive: true,
};

function toForm(s: Supplier): Form {
  return {
    supplierCode: s.supplierCode, nameEn: s.nameEn, nameAr: s.nameAr, nameBn: s.nameBn ?? '', contactPerson: s.contactPerson ?? '',
    mobile: s.mobile ?? '', whatsapp: s.whatsapp ?? '', email: s.email ?? '', address: s.address ?? '', city: s.city ?? '',
    countryCode: s.countryCode, vatNumber: s.vatNumber ?? '', crNumber: s.crNumber ?? '', openingBalance: s.openingBalance ?? '0',
    creditLimit: s.creditLimit ?? '', paymentTermsDays: s.paymentTermsDays?.toString() ?? '', bankName: s.bankName ?? '',
    bankAccountName: s.bankAccountName ?? '', iban: s.iban ?? '', notes: s.notes ?? '', isActive: s.isActive,
  };
}

/** Create or edit a supplier. An edit sends the version it loaded, so a stale copy is refused. */
export function SupplierForm({ supplierId }: { supplierId: string | null }) {
  const { t } = useI18n();
  const { suppliers } = useServices();
  const { orgId } = useMembership();
  const { can } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canFinance = can('suppliers.manage');

  const existing = useQuery({
    queryKey: ['supplier', orgId, supplierId],
    queryFn: () => suppliers.get(orgId, supplierId!),
    enabled: Boolean(supplierId),
  });

  const [form, setForm] = React.useState<Form>(EMPTY);
  const [issue, setIssue] = React.useState<SupplierIssue | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<unknown>(null);
  const [saved, setSaved] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (existing.data) setForm(toForm(existing.data));
  }, [existing.data]);

  const set = (key: keyof Form) => (value: string | boolean) => {
    setForm((f) => ({ ...f, [key]: value }));
    setIssue(null);
  };

  if (supplierId && existing.isPending) return <Card className="p-6"><Spinner label={t('common.loading')} /></Card>;
  if (existing.error) return <ErrorAlert error={existing.error} onRetry={() => void existing.refetch()} />;

  const title = supplierId ? t('supplier.title_edit') : t('supplier.title_new');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaved(null);
    const problem = supplierIssue({
      supplierCode: form.supplierCode, nameEn: form.nameEn, nameAr: form.nameAr, mobile: form.mobile, whatsapp: form.whatsapp,
      email: form.email, vatNumber: form.vatNumber, crNumber: form.crNumber, iban: form.iban, openingBalance: form.openingBalance,
      creditLimit: form.creditLimit, paymentTermsDays: form.paymentTermsDays, defaultCurrency: 'SAR', countryCode: form.countryCode,
    });
    if (problem) {
      setIssue(problem);
      return;
    }
    setSaving(true);
    try {
      const input: SupplierInput = {
        id: supplierId, supplierCode: form.supplierCode, nameEn: form.nameEn, nameAr: form.nameAr, nameBn: form.nameBn,
        contactPerson: form.contactPerson, mobile: form.mobile, whatsapp: form.whatsapp, email: form.email, address: form.address,
        city: form.city, countryCode: form.countryCode, vatNumber: form.vatNumber, crNumber: form.crNumber,
        notes: form.notes, isActive: form.isActive,
        ...(canFinance ? {
          openingBalance: form.openingBalance, creditLimit: form.creditLimit, paymentTermsDays: form.paymentTermsDays,
          bankName: form.bankName, bankAccountName: form.bankAccountName, iban: form.iban,
        } : {}),
      };
      const result = await suppliers.save(orgId, input, existing.data?.rowVersion ?? null);
      void queryClient.invalidateQueries({ queryKey: ['suppliers', orgId] });
      setSaved(result.supplierNo);
      if (!supplierId) router.push(`/suppliers/profile/?id=${result.id}`);
      else void queryClient.invalidateQueries({ queryKey: ['supplier', orgId, supplierId] });
    } catch (error) {
      setSaveError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title={title} />
      <form onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-2">
        {saved ? <Alert variant="success" className="lg:col-span-2">{t('supplier.saved', { no: saved })}</Alert> : null}
        {issue ? <Alert variant="warning" className="lg:col-span-2">{t(`errors.${issue}`)}</Alert> : null}
        {saveError ? <div className="lg:col-span-2"><ErrorAlert error={saveError} /></div> : null}

        <Card>
          <CardHeader><CardTitle className="text-base">{t('supplier.section_identity')}</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <Field label={t('supplier.field_code')} id="s-code" hint={supplierId ? undefined : t('supplier.hint_code')}>{(p) => (<Input {...p} value={form.supplierCode} onChange={(e) => set('supplierCode')(e.target.value)} dir="ltr" maxLength={40} />)}</Field>
            <Field label={t('supplier.field_name_en')} id="s-name-en" required>{(p) => (<Input {...p} value={form.nameEn} onChange={(e) => set('nameEn')(e.target.value)} maxLength={200} />)}</Field>
            <Field label={t('supplier.field_name_ar')} id="s-name-ar" required>{(p) => (<Input {...p} value={form.nameAr} onChange={(e) => set('nameAr')(e.target.value)} maxLength={200} dir="rtl" />)}</Field>
            <Field label={t('supplier.field_name_bn')} id="s-name-bn" optionalLabel={t('common.optional')}>{(p) => (<Input {...p} value={form.nameBn} onChange={(e) => set('nameBn')(e.target.value)} maxLength={200} />)}</Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.isActive} onChange={(e) => set('isActive')(e.target.checked)} />
              {t('supplier.field_active')}
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{t('supplier.section_contact')}</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <Field label={t('supplier.field_contact_person')} id="s-contact">{(p) => (<Input {...p} value={form.contactPerson} onChange={(e) => set('contactPerson')(e.target.value)} maxLength={120} />)}</Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('supplier.field_mobile')} id="s-mobile">{(p) => (<Input {...p} value={form.mobile} onChange={(e) => set('mobile')(e.target.value)} inputMode="tel" dir="ltr" />)}</Field>
              <Field label={t('supplier.field_whatsapp')} id="s-whatsapp">{(p) => (<Input {...p} value={form.whatsapp} onChange={(e) => set('whatsapp')(e.target.value)} inputMode="tel" dir="ltr" />)}</Field>
            </div>
            <Field label={t('supplier.field_email')} id="s-email">{(p) => (<Input {...p} type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} dir="ltr" autoComplete="email" />)}</Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{t('supplier.section_address')}</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <Field label={t('supplier.field_address')} id="s-address">{(p) => (<Input {...p} value={form.address} onChange={(e) => set('address')(e.target.value)} maxLength={300} />)}</Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('supplier.field_city')} id="s-city">{(p) => (<Input {...p} value={form.city} onChange={(e) => set('city')(e.target.value)} maxLength={100} />)}</Field>
              <Field label={t('supplier.field_country')} id="s-country">{(p) => (<NativeSelect {...p} value={form.countryCode} onChange={(e) => set('countryCode')(e.target.value)}>
                  <option value="SA">{t('supplier.country_sa')}</option>
                </NativeSelect>)}</Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{t('supplier.section_tax')}</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <Field label={t('supplier.field_vat')} id="s-vat" hint={t('supplier.hint_vat')}>{(p) => (<Input {...p} value={form.vatNumber} onChange={(e) => set('vatNumber')(e.target.value)} inputMode="numeric" dir="ltr" maxLength={15} />)}</Field>
            <Field label={t('supplier.field_cr')} id="s-cr">{(p) => (<Input {...p} value={form.crNumber} onChange={(e) => set('crNumber')(e.target.value)} inputMode="numeric" dir="ltr" maxLength={10} />)}</Field>
          </CardContent>
        </Card>

        {canFinance ? (
          <Card>
            <CardHeader><CardTitle className="text-base">{t('supplier.section_financial')}</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('supplier.field_opening_balance')} id="s-opening" hint={t('supplier.hint_opening')}>{(p) => (<Input {...p} value={form.openingBalance} onChange={(e) => set('openingBalance')(e.target.value)} inputMode="decimal" dir="ltr" />)}</Field>
                <Field label={t('supplier.field_credit_limit')} id="s-credit" optionalLabel={t('common.optional')}>{(p) => (<Input {...p} value={form.creditLimit} onChange={(e) => set('creditLimit')(e.target.value)} inputMode="decimal" dir="ltr" />)}</Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('supplier.field_payment_terms')} id="s-terms" hint={t('supplier.hint_terms')}>{(p) => (<Input {...p} value={form.paymentTermsDays} onChange={(e) => set('paymentTermsDays')(e.target.value)} inputMode="numeric" dir="ltr" />)}</Field>
                <Field label={t('supplier.field_currency')} id="s-currency">{(p) => (<Input {...p} value="SAR" readOnly dir="ltr" />)}</Field>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {canFinance ? (
          <Card>
            <CardHeader><CardTitle className="text-base">{t('supplier.section_bank')}</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <Field label={t('supplier.field_bank_name')} id="s-bank">{(p) => (<Input {...p} value={form.bankName} onChange={(e) => set('bankName')(e.target.value)} maxLength={120} />)}</Field>
              <Field label={t('supplier.field_bank_account_name')} id="s-bank-acc">{(p) => (<Input {...p} value={form.bankAccountName} onChange={(e) => set('bankAccountName')(e.target.value)} maxLength={120} />)}</Field>
              <Field label={t('supplier.field_iban')} id="s-iban" hint={t('supplier.hint_iban')}>{(p) => (<Input {...p} value={form.iban} onChange={(e) => set('iban')(e.target.value)} dir="ltr" maxLength={34} />)}</Field>
            </CardContent>
          </Card>
        ) : null}

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">{t('supplier.section_notes')}</CardTitle></CardHeader>
          <CardContent>
            <Field label={t('supplier.field_notes')} id="s-notes">{(p) => (<textarea
                {...p}
                value={form.notes}
                onChange={(e) => set('notes')(e.target.value)}
                maxLength={2000}
                rows={3}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />)}</Field>
          </CardContent>
        </Card>

        {!canFinance ? <p className="text-xs text-muted-foreground lg:col-span-2">{t('supplier.financial_hidden')}</p> : null}

        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-border bg-background/95 p-4 backdrop-blur lg:col-span-2 lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
          <Button type="button" variant="outline" onClick={() => router.push(supplierId ? `/suppliers/profile/?id=${supplierId}` : '/suppliers/')}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={saving}>{saving ? t('common.saving') : t('supplier.save')}</Button>
        </div>
      </form>
    </>
  );
}
