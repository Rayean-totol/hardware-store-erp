'use client';

import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from '@erp/ui';
import { Trash2 } from 'lucide-react';
import * as React from 'react';
import { useErrorText } from '@/components/error-message';
import { discardLegacyEntry, summarizeLocalPending, type LegacyPendingEntry } from '@/lib/local-data';
import { useI18n } from '@/providers/i18n-provider';

/**
 * Lists stock changes saved by the earlier offline build that were never sent to the server.
 * They are not counted in stock. The user can delete each one after confirming. Nothing is sent.
 */
export function LegacyPendingPanel({ onChange }: { onChange?: (count: number) => void }) {
  const { t, fmt } = useI18n();
  const errorText = useErrorText();
  const [entries, setEntries] = React.useState<LegacyPendingEntry[] | null>(null);
  const [error, setError] = React.useState<unknown>(null);

  const load = React.useCallback(async () => {
    try {
      const summary = await summarizeLocalPending();
      setEntries(summary.legacy);
      onChange?.(summary.legacy.length);
    } catch (err) {
      setError(err);
    }
  }, [onChange]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (!entries || entries.length === 0) return null;

  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="text-base">{t('legacy.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>{t('legacy.body', { count: fmt.number(entries.length) })}</p>
        {error ? <Alert variant="destructive">{errorText(error)}</Alert> : null}
        <ul className="flex flex-col gap-2">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
              <span>
                {t(`movement.type_${e.movementType}` as 'movement.type_stock_in')} · {fmt.number(e.quantity)}
                <span className="ms-2 text-xs text-muted-foreground">{fmt.dateTime(e.createdAt)}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => {
                if (!window.confirm(t('legacy.discard_confirm'))) return;
                void (async () => {
                  try {
                    await discardLegacyEntry(e.id);
                    await load();
                  } catch (err) {
                    setError(err);
                  }
                })();
              }}>
                <Trash2 aria-hidden="true" />
                {t('legacy.discard')}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
