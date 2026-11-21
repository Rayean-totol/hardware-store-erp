'use client';

import { useConnection } from '@/providers/connection-provider';
import { useI18n } from '@/providers/i18n-provider';

/** Explains why a save button is disabled. Renders nothing while writes are allowed. */
export function WriteHint() {
  const { t } = useI18n();
  const { writable } = useConnection();
  if (writable) return null;
  return <p className="text-xs text-muted-foreground" role="note">{t('writes.disabled_hint')}</p>;
}
