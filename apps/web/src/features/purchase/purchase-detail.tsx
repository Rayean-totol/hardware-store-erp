'use client';

import type { PurchaseOrder } from '@erp/data';
import { purchaseActions, type PurchaseAction } from '@erp/domain';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@erp/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';

/** One purchase order with the actions the user may take. The server checks every action again. */
export function PurchaseDetail({ orderId }: { orderId: string }) {
  const { t, fmt } = useI18n();
  const { purchaseOrders } = useServices();
  const membership = useMembership();
  const { user, can } = useSession();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState<PurchaseAction | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [reason, setReason] = React.useState('');
  const [note, setNote] = React.useState<string | null>(null);

  const order = useQuery({
    queryKey: ['purchase-order', membership.orgId, orderId],
    queryFn: () => purchaseOrders.get(membership.orgId, orderId),
  });

  if (order.isPending) return <Card className="p-6"><Spinner label={t('common.loading')} /></Card>;
  if (order.error) return <ErrorAlert error={order.error} onRetry={() => void order.refetch()} />;
  const po: PurchaseOrder = order.data;
  const actions = purchaseActions(po.status, { permissions: membership.permissions, isCreator: user !== null && po.createdBy === user.id });
  const canSeeCost = can('purchase.cost_view');

  async function run(action: PurchaseAction) {
    setBusy(action);
    setError(null);
    setNote(null);
    try {
      if (action === 'submit') await purchaseOrders.submit(membership.orgId, po.id, po.rowVersion);
      if (action === 'approve') await purchaseOrders.approve(membership.orgId, po.id, po.rowVersion);
      if (action === 'cancel') await purchaseOrders.cancel(membership.orgId, po.id, po.rowVersion, reason);
      setNote(t(`purchase.done_${action}`));
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['purchase-order', membership.orgId, orderId] });
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders', membership.orgId] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title={<span className="font-mono" dir="ltr">{po.poNumber}</span>}
        actions={
          <>
            <Badge variant={po.status === 'cancelled' ? 'outline' : 'secondary'}>{t(`purchase.status_${po.status}`)}</Badge>
            {actions.includes('edit') ? (
              <Button asChild variant="outline"><Link href={`/purchase-orders/edit/?id=${po.id}`}><Pencil aria-hidden="true" />{t('common.edit')}</Link></Button>
            ) : null}
          </>
        }
      />
      {note ? <Alert variant="success" className="mb-4">{note}</Alert> : null}
      {error ? <div className="mb-4"><ErrorAlert error={error} /></div> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card>
          <CardHeader><CardTitle className="text-base">{t('purchase.section_header')}</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">{t('purchase.field_supplier')}</dt><dd>{po.supplierNameEn ?? '—'}</dd>
              <dt className="text-muted-foreground">{t('purchase.created')}</dt><dd>{fmt.dateTime(po.createdAt)}</dd>
              <dt className="text-muted-foreground">{t('purchase.field_delivery')}</dt><dd>{po.expectedDeliveryDate ? fmt.date(po.expectedDeliveryDate) : '—'}</dd>
              <dt className="text-muted-foreground">{t('purchase.field_notes')}</dt><dd>{po.deliveryNotes ?? '—'}</dd>
              {po.cancelReason ? <><dt className="text-muted-foreground">{t('purchase.cancel_reason')}</dt><dd>{po.cancelReason}</dd></> : null}
            </dl>
            {canSeeCost && po.grandTotal ? (
              <div className="mt-4 grid gap-1 border-t border-border pt-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">{t('purchase.subtotal')}</span><span className="tabular-nums">{fmt.money(po.subtotalNet ?? '0')}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('purchase.discount')}</span><span className="tabular-nums">{fmt.money(po.discountTotal ?? '0')}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('purchase.vat')}</span><span className="tabular-nums">{fmt.money(po.vatTotal ?? '0')}</span></div>
                <div className="flex justify-between text-base font-semibold"><span>{t('purchase.grand_total')}</span><span className="tabular-nums">{fmt.money(po.grandTotal)}</span></div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">{t('purchase.section_lines')}</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('purchase.col_product')}</TableHead>
                    <TableHead className="text-end">{t('purchase.col_qty')}</TableHead>
                    <TableHead className="text-end">{t('purchase.col_received')}</TableHead>
                    {canSeeCost ? <TableHead className="text-end">{t('purchase.col_cost')}</TableHead> : null}
                    {canSeeCost ? <TableHead className="text-end">{t('purchase.col_total')}</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {po.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground" dir="ltr">{l.sku}</span> {l.nameEn}
                      </TableCell>
                      <TableCell className="text-end tabular-nums" dir="ltr">{l.enteredQuantity}</TableCell>
                      <TableCell className="text-end tabular-nums" dir="ltr">{l.receivedBaseQuantity}</TableCell>
                      {canSeeCost ? <TableCell className="text-end tabular-nums">{l.unitCost ? fmt.money(l.unitCost) : '—'}</TableCell> : null}
                      {canSeeCost ? <TableCell className="text-end tabular-nums">{l.grossAmount ? fmt.money(l.grossAmount) : '—'}</TableCell> : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {actions.includes('submit') || actions.includes('approve') ? (
            <Card>
              <CardContent className="flex flex-wrap gap-2 p-4">
                {actions.includes('submit') ? (
                  <Button disabled={busy !== null} onClick={() => void run('submit')}>{busy === 'submit' ? t('common.saving') : t('purchase.submit')}</Button>
                ) : null}
                {actions.includes('approve') ? (
                  <Button disabled={busy !== null} onClick={() => void run('approve')}>{busy === 'approve' ? t('common.saving') : t('purchase.approve')}</Button>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {actions.includes('cancel') ? (
            <Card>
              <CardHeader><CardTitle className="text-base">{t('purchase.cancel_title')}</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <Field label={t('purchase.cancel_reason')} id="cancel-reason" required>
                  {(p) => <Input {...p} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
                </Field>
                <div className="flex justify-end">
                  <Button variant="destructive" disabled={busy !== null || reason.trim().length < 5} onClick={() => void run('cancel')}>
                    {busy === 'cancel' ? t('common.saving') : t('purchase.cancel_order')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
          <p className="text-xs text-muted-foreground">{t('purchase.stock_note')}</p>
        </div>
      </div>
    </>
  );
}
