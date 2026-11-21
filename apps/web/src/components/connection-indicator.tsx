'use client';

import { Button, cn } from '@erp/ui';
import { RefreshCw, Wifi, WifiOff } from 'lucide-react';
import * as React from 'react';
import { useConnection } from '@/providers/connection-provider';
import { useI18n } from '@/providers/i18n-provider';

/** Online / Offline / Reconnecting. Tapping it checks the server again. */
export function ConnectionIndicator({ className }: { className?: string }) {
  const { t } = useI18n();
  const { state, revalidate } = useConnection();
  const [checking, setChecking] = React.useState(false);
  const label = state === 'online' ? t('connection.online') : state === 'offline' ? t('connection.offline') : t('connection.reconnecting');
  const Icon = state === 'online' ? Wifi : state === 'offline' ? WifiOff : RefreshCw;
  const tone = state === 'online'
    ? 'border-emerald-500/40 text-emerald-400'
    : state === 'offline'
      ? 'border-destructive/50 text-destructive'
      : 'border-amber-500/40 text-amber-400';

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn('h-8 gap-1.5 rounded-full px-3 text-xs', tone, className)}
      aria-label={`${t('connection.status')}: ${label}. ${t('connection.check')}`}
      title={t('connection.check')}
      disabled={checking}
      onClick={async () => {
        setChecking(true);
        try {
          await revalidate();
        } finally {
          setChecking(false);
        }
      }}
    >
      <Icon className={cn('size-3.5', state === 'reconnecting' && 'animate-spin')} aria-hidden={true} />
      <span role="status" aria-live="polite">{label}</span>
    </Button>
  );
}
