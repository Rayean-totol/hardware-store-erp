'use client';

import { SyncEngine, type FlushReport, type OutboxEntry, type SyncStatus } from '@erp/data';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { getOfflineStorage } from '@/lib/offline-store';
import { getDeviceId } from '@/lib/storage';
import { useServices } from './services-provider';
import { useMembership } from './session-provider';

const FLUSH_INTERVAL_MS = 20_000;

export interface SyncValue {
  ready: boolean;
  engine: SyncEngine | null;
  durable: boolean;
  storageError: string | null;
  online: boolean;
  status: SyncStatus | null;
  queue: OutboxEntry[];
  lastReport: FlushReport | null;
  flush(): Promise<FlushReport | null>;
  refresh(): Promise<void>;
}

const SyncContext = React.createContext<SyncValue | null>(null);

/**
 * Owns the offline sync engine for the active organization. It sends queued movements when
 * the browser comes back online, every FLUSH_INTERVAL_MS, and on demand. Failures never
 * throw into the UI: they are recorded in the status and shown.
 */
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { syncTransport } = useServices();
  const { orgId } = useMembership();
  const queryClient = useQueryClient();
  const [engine, setEngine] = React.useState<SyncEngine | null>(null);
  const [durable, setDurable] = React.useState(true);
  const [storageError, setStorageError] = React.useState<string | null>(null);
  const [online, setOnline] = React.useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [status, setStatus] = React.useState<SyncStatus | null>(null);
  const [queue, setQueue] = React.useState<OutboxEntry[]>([]);
  const [lastReport, setLastReport] = React.useState<FlushReport | null>(null);
  const engineRef = React.useRef<SyncEngine | null>(null);

  const refresh = React.useCallback(async () => {
    const e = engineRef.current;
    if (!e) return;
    setStatus(await e.status());
    setQueue(await e.queued());
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    getOfflineStorage().then((storage) => {
      if (cancelled) return;
      const e = new SyncEngine({ orgId, deviceId: getDeviceId(), store: storage.store, transport: syncTransport });
      engineRef.current = e;
      setDurable(storage.durable);
      setStorageError(storage.storageError);
      setEngine(e);
      void e.status().then((s) => !cancelled && setStatus(s));
      void e.queued().then((q) => !cancelled && setQueue(q));
    });
    return () => {
      cancelled = true;
      engineRef.current = null;
    };
  }, [orgId, syncTransport]);

  const flush = React.useCallback(async (): Promise<FlushReport | null> => {
    const e = engineRef.current;
    if (!e) return null;
    const report = await e.flush();
    setLastReport(report);
    await refresh();
    await queryClient.invalidateQueries({ queryKey: ['stock'] });
    await queryClient.invalidateQueries({ queryKey: ['movements'] });
    return report;
  }, [queryClient, refresh]);

  React.useEffect(() => {
    if (!engine) return;
    const onOnline = () => {
      setOnline(true);
      void flush();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const timer = window.setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    void flush();
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(timer);
    };
  }, [engine, flush]);

  const value: SyncValue = {
    ready: engine !== null,
    engine,
    durable,
    storageError,
    online,
    status,
    queue,
    lastReport,
    flush,
    refresh,
  };
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncValue {
  const ctx = React.useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside <SyncProvider>');
  return ctx;
}
