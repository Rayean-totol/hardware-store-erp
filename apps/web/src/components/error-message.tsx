'use client';

import { toDataError } from '@erp/data';
import { Alert, Button } from '@erp/ui';
import { useI18n } from '@/providers/i18n-provider';

/**
 * Turn any thrown value into a user-facing message. Known codes are translated; unknown
 * errors show their raw message so nothing is hidden.
 */
export function useErrorText(): (error: unknown) => string {
  const { t, tMaybe } = useI18n();
  return (raw) => {
    // Normalise anything (DataError, PostgREST error object, network TypeError, plain Error).
    const error = toDataError(raw);
    if (error.code === 'auth.failed') return t('auth.failed', { message: error.message });
    if (error.code !== 'unknown') {
      const translated = tMaybe(`errors.${error.code}`, { detail: error.detail ?? '', message: error.message });
      if (translated) return translated;
    }
    return t('errors.unknown', { message: error.message });
  };
}

export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const text = useErrorText();
  const { t } = useI18n();
  return (
    <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-3">
      <p>{text(error)}</p>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </Alert>
  );
}
