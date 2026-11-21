'use client';

import { isValidCrNumberFormat, isValidVatNumberFormat } from '@erp/domain';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Spinner } from '@erp/ui';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useSession } from '@/providers/session-provider';
import { useConnection } from '@/providers/connection-provider';

export function OnboardingForm() {
  const { writable } = useConnection();
  const { t, locale } = useI18n();
  const { org } = useServices();
  const session = useSession();
  const router = useRouter();
  const [form, setForm] = React.useState({
    legalNameEn: '',
    legalNameAr: '',
    vatNumber: '',
    crNumber: '',
    branchCode: 'MAIN',
    branchNameEn: 'Main branch',
    branchNameAr: 'الفرع الرئيسي',
  });
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (session.status === 'signed_out') router.replace('/login/');
    if (session.status === 'signed_in' && session.membership) router.replace('/products/');
  }, [session.status, session.membership, router]);

  const create = useMutation({
    mutationFn: () =>
      org.createOrganization({
        ...form,
        vatNumber: form.vatNumber.trim() || null,
        crNumber: form.crNumber.trim() || null,
        defaultLocale: locale,
      }),
    onSuccess: async (orgId) => {
      session.setActiveOrg(orgId);
      await session.refresh();
    },
  });

  const vatError = form.vatNumber && !isValidVatNumberFormat(form.vatNumber.trim()) ? t('issues.invalid') : undefined;
  const crError = form.crNumber && !isValidCrNumberFormat(form.crNumber.trim()) ? t('issues.invalid') : undefined;
  const required = (v: string) => (touched && !v.trim() ? t('issues.required') : undefined);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  if (session.status !== 'signed_in') return <Spinner label={t('common.loading')} className="m-8" />;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!form.legalNameEn.trim() || !form.legalNameAr.trim() || vatError || crError) return;
    create.mutate();
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-4 p-4">
      <div className="flex justify-end"><LanguageSwitcher /></div>
      <Card>
        <CardHeader>
          <CardTitle>{t('onboarding.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Alert variant="info" className="sm:col-span-2">{t('onboarding.no_membership')}</Alert>
            {create.error ? <div className="sm:col-span-2"><ErrorAlert error={create.error} /></div> : null}
            <Field label={t('onboarding.legal_name_en')} required error={required(form.legalNameEn)}>
              {(p) => <Input {...p} dir="ltr" value={form.legalNameEn} onChange={set('legalNameEn')} />}
            </Field>
            <Field label={t('onboarding.legal_name_ar')} required error={required(form.legalNameAr)}>
              {(p) => <Input {...p} dir="rtl" lang="ar" value={form.legalNameAr} onChange={set('legalNameAr')} />}
            </Field>
            <Field label={t('onboarding.vat_number')} hint={t('onboarding.vat_hint')} error={vatError} optionalLabel={t('common.optional')}>
              {(p) => <Input {...p} dir="ltr" inputMode="numeric" value={form.vatNumber} onChange={set('vatNumber')} />}
            </Field>
            <Field label={t('onboarding.cr_number')} error={crError} optionalLabel={t('common.optional')}>
              {(p) => <Input {...p} dir="ltr" inputMode="numeric" value={form.crNumber} onChange={set('crNumber')} />}
            </Field>
            <Field label={t('onboarding.branch_code')} required error={required(form.branchCode)}>
              {(p) => <Input {...p} dir="ltr" value={form.branchCode} onChange={(e) => setForm({ ...form, branchCode: e.target.value.toUpperCase() })} />}
            </Field>
            <div />
            <Field label={t('onboarding.branch_name_en')} required error={required(form.branchNameEn)}>
              {(p) => <Input {...p} dir="ltr" value={form.branchNameEn} onChange={set('branchNameEn')} />}
            </Field>
            <Field label={t('onboarding.branch_name_ar')} required error={required(form.branchNameAr)}>
              {(p) => <Input {...p} dir="rtl" lang="ar" value={form.branchNameAr} onChange={set('branchNameAr')} />}
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={create.isPending || !writable}>
                {create.isPending ? t('common.saving') : t('onboarding.submit')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
