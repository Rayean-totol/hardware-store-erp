'use client';

import type { Supplier } from '@erp/data';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Spinner } from '@erp/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">{value || '—'}</dd>
    </div>
  );
}

/** Posts an audited balance adjustment. The idempotency key lives until a success, so a retry cannot post twice. */
function AdjustBalance({ supplierId, onDone }: { supplierId: string; onDone: () => void }) {
  const { t, fmt } = useI18n();
  const { suppliers } = useServices();
  const { orgId } = useMembership();
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [busy, setBusy] = React.useState(false);
  const clientId = React.useRef(crypto.randomUUID());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await suppliers.adjustBalance(orgId, supplierId, clientId.current, amount, reason);
      clientId.current = crypto.randomUUID();
      setMessage(t('supplier.adjusted', { balance: fmt.money(result.balance) }));
      setAmount('');
      setReason('');
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('supplier.adjust_title')}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          <p className="text-xs text-muted-foreground">{t('supplier.adjust_hint')}</p>
          <Field label={t('supplier.adjust_amount')} id="adj-amount" required>
            {(p) => <Input {...p} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" dir="ltr" />}
          </Field>
          <Field label={t('supplier.adjust_reason')} id="adj-reason" required>
            {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
          </Field>
          {message ? <Alert variant="success">{message}</Alert> : null}
          {error ? <ErrorAlert error={error} /> : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>{busy ? t('common.saving') : t('supplier.adjust_submit')}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** One supplier: details, financial terms (managers only) and the purchase and payment history. */
export function SupplierProfile({ supplierId }: { supplierId: string }) {
  const { t, fmt, locale } = useI18n();
  const { suppliers } = useServices();
  const { orgId } = useMembership();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: ['supplier', orgId, supplierId],
    queryFn: () => suppliers.get(orgId, supplierId),
  });

  if (profile.isPending) return <Card className="p-6"><Spinner label={t('common.loading')} /></Card>;
  if (profile.error) return <ErrorAlert error={profile.error} onRetry={() => void profile.refetch()} />;
  const s: Supplier = profile.data;
  const name = locale === 'ar' ? s.nameAr : locale === 'bn' ? s.nameBn ?? s.nameEn : s.nameEn;

  return (
    <>
      <PageHeader
        title={name}
        actions={
          <>
            <Badge variant={s.isActive ? 'success' : 'outline'}>{s.isActive ? t('common.active') : t('common.inactive')}</Badge>
            {can('suppliers.manage') ? (
              <Button asChild variant="outline">
                <Link href={`/suppliers/edit/?id=${s.id}`}><Pencil aria-hidden="true" />{t('common.edit')}</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">{t('supplier.profile_details')}</CardTitle></CardHeader>
          <CardContent>
            <dl>
              <Row label={t('suppliers.col_no')} value={<span dir="ltr" className="font-mono">{s.supplierNo}</span>} />
              <Row label={t('supplier.field_code')} value={<span dir="ltr" className="font-mono">{s.supplierCode}</span>} />
              <Row label={t('supplier.field_name_en')} value={s.nameEn} />
              <Row label={t('supplier.field_name_ar')} value={s.nameAr} />
              <Row label={t('supplier.field_name_bn')} value={s.nameBn} />
              <Row label={t('supplier.field_contact_person')} value={s.contactPerson} />
              <Row label={t('supplier.field_mobile')} value={<span dir="ltr">{s.mobile}</span>} />
              <Row label={t('supplier.field_whatsapp')} value={<span dir="ltr">{s.whatsapp}</span>} />
              <Row label={t('supplier.field_email')} value={<span dir="ltr">{s.email}</span>} />
              <Row label={t('supplier.field_address')} value={s.address} />
              <Row label={t('supplier.field_city')} value={s.city} />
              <Row label={t('supplier.field_vat')} value={<span dir="ltr">{s.vatNumber}</span>} />
              <Row label={t('supplier.field_cr')} value={<span dir="ltr">{s.crNumber}</span>} />
              <Row label={t('supplier.field_payment_terms')} value={s.paymentTermsDays !== null ? t('supplier.days', { days: fmt.number(s.paymentTermsDays) }) : null} />
              <Row label={t('supplier.field_currency')} value="SAR" />
              <Row label={t('supplier.field_notes')} value={s.notes} />
              <Row label={t('suppliers.updated')} value={fmt.dateTime(s.updatedAt)} />
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {s.openingBalance !== undefined ? (
            <Card>
              <CardHeader><CardTitle className="text-base">{t('supplier.profile_financial')}</CardTitle></CardHeader>
              <CardContent>
                <dl>
                  <Row label={t('supplier.field_opening_balance')} value={fmt.money(s.openingBalance)} />
                  <Row label={t('supplier.field_credit_limit')} value={s.creditLimit ? fmt.money(s.creditLimit) : null} />
                  <Row label={t('supplier.field_bank_name')} value={s.bankName} />
                  <Row label={t('supplier.field_bank_account_name')} value={s.bankAccountName} />
                  <Row label={t('supplier.field_iban')} value={<span dir="ltr">{s.iban}</span>} />
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">{t('supplier.balance_pending')}</p>
              </CardContent>
            </Card>
          ) : null}
          {s.currentBalance !== undefined ? (
            <Card>
              <CardHeader><CardTitle className="text-base">{t('supplier.profile_balance')}</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-2xl font-semibold tabular-nums">{fmt.money(s.currentBalance)}</span>
                  {s.openingBalanceLocked ? <Badge variant="outline">{t('supplier.field_opening_locked')}</Badge> : null}
                </div>
              </CardContent>
            </Card>
          ) : null}
          {can('suppliers.adjust') && s.currentBalance !== undefined ? (
            <AdjustBalance supplierId={s.id} onDone={() => void queryClient.invalidateQueries({ queryKey: ['supplier', orgId, supplierId] })} />
          ) : null}

          {/* Purchase and payment history: real records arrive in Phases 4C and 4D. Nothing is shown as data yet. */}
          <Card>
            <CardHeader><CardTitle className="text-base">{t('supplier.history_purchases')}</CardTitle></CardHeader>
            <CardContent><Alert variant="info">{t('supplier.phase_4c')}</Alert></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">{t('supplier.history_payments')}</CardTitle></CardHeader>
            <CardContent><Alert variant="info">{t('supplier.phase_4d')}</Alert></CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
