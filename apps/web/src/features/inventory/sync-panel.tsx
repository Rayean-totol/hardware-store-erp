'use client';

import { DataError } from '@erp/data';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@erp/ui';
import { RefreshCw, Trash2, RotateCcw } from 'lucide-react';
import * as React from 'react';
import { useErrorText } from '@/components/error-message';
import { useI18n } from '@/providers/i18n-provider';
import { useSync } from '@/providers/sync-provider';

/** Shows connection state, queued work and rejected movements. Rejected work is never dropped silently. */
export function SyncPanel() {
  const { t, fmt } = useI18n();
  const errorText = useErrorText();
  const sync = useSync();
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<unknown>(null);
  const failed = sync.queue.filter((e) => e.status === 'failed');

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error);
    } finally {
      setBusy(false);
    }
  }

  const report = sync.lastReport;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t('sync.title')}</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={sync.online ? 'success' : 'warning'}>{sync.online ? t('sync.online') : t('sync.offline')}</Badge>
          <Button size="sm" variant="outline" disabled={busy || !sync.ready} onClick={() => void run(() => sync.flush())}>
            <RefreshCw aria-hidden="true" className={busy ? 'animate-spin' : undefined} />
            {t('sync.now')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {!sync.durable ? <Alert variant="destructive">{t('sync.not_durable', { message: sync.storageError ?? '' })}</Alert> : null}
        {actionError ? <Alert variant="destructive">{errorText(actionError)}</Alert> : null}
        {report?.networkError ? <Alert variant="warning">{t('sync.network_problem')}</Alert> : null}
        {report && report.refreshErrors.length > 0 ? <Alert variant="warning">{t('sync.refresh_problem')}</Alert> : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <dt className="text-muted-foreground">{t('sync.queued')}</dt>
          <dd className="tabular-nums">{fmt.number(sync.status?.pending ?? 0)}</dd>
          <dt className="text-muted-foreground">{t('sync.awaiting_refresh')}</dt>
          <dd className="tabular-nums">{fmt.number(sync.status?.acked ?? 0)}</dd>
          <dt className="text-muted-foreground">{t('sync.rejected')}</dt>
          <dd className="tabular-nums">{fmt.number(sync.status?.failed ?? 0)}</dd>
          <dt className="text-muted-foreground">{t('sync.last_synced')}</dt>
          <dd>{sync.status?.lastSyncedAt ? fmt.dateTime(sync.status.lastSyncedAt) : t('sync.never')}</dd>
        </dl>
        {failed.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">{t('sync.rejected_title')}</h3>
            <ul className="flex flex-col gap-2">
              {failed.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                  <span>
                    {e.payload.movementType} · {fmt.number(e.payload.quantity)} —{' '}
                    <span className="text-destructive">
                      {errorText(new DataError(e.lastError?.code ?? 'unknown', e.lastError?.message ?? ''))}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
                      if (!sync.engine) return;
                      await sync.engine.retry(e.id);
                      await sync.refresh();
                    })}>
                      <RotateCcw aria-hidden="true" />
                      {t('sync.retry')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
                      if (!window.confirm(t('sync.discard_confirm'))) return;
                      void run(async () => {
                        if (!sync.engine) return;
                        await sync.engine.discard(e.id);
                        await sync.refresh();
                      });
                    }}>
                      <Trash2 aria-hidden="true" />
                      {t('sync.discard')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
