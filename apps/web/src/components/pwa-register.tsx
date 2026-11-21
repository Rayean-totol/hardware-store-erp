'use client';

import { Button } from '@erp/ui';
import * as React from 'react';
import { BASE_PATH } from '@/lib/base-path';
import { useI18n } from '@/providers/i18n-provider';

/**
 * Registers the service worker in production builds only. When a new version is installed it
 * waits; the user decides when to switch, because switching reloads the page.
 */
export function PwaRegister() {
  const { t } = useI18n();
  const [waiting, setWaiting] = React.useState<ServiceWorkerRegistration | null>(null);

  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    let registration: ServiceWorkerRegistration | null = null;
    const onUpdateFound = () => {
      const installing = registration?.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller && registration) setWaiting(registration);
      });
    };
    navigator.serviceWorker
      .register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` })
      .then((reg) => {
        registration = reg;
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg);
        reg.addEventListener('updatefound', onUpdateFound);
      })
      .catch(() => {
        // Without a service worker the app still works online; the failure is not shown as an error.
      });
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  if (!waiting) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md flex-col gap-2 rounded-lg border border-primary/40 bg-card p-4 text-sm shadow-lg md:bottom-4">
      <p className="font-medium">{t('pwa.update_title')}</p>
      <p className="text-xs text-muted-foreground">{t('pwa.update_hint')}</p>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => waiting.waiting?.postMessage({ type: 'SKIP_WAITING' })}>{t('pwa.update_action')}</Button>
      </div>
    </div>
  );
}
