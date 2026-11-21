'use client';

import * as React from 'react';
import { supabaseConfig } from '@/lib/config';
import { checkServer, deriveConnection, initialConnection, reduceConnection, writesAllowed, type ConnectionEvent, type ConnectionModel, type ConnectionState } from '@/lib/connection';
import { connectionGate } from '@/lib/connection-gate';

export interface ConnectionValue {
  state: ConnectionState;
  /** True only when the server was reached recently and the browser reports a connection. */
  writable: boolean;
  /** Checks the server now. Resolves true only if writes are allowed afterwards. */
  revalidate(): Promise<boolean>;
}

export const ConnectionContext = React.createContext<ConnectionValue | null>(null);

const CHECK_INTERVAL_MS = 30_000;

/**
 * Tracks online / offline / reconnecting from browser events and a periodic server check.
 * It also drives the write gate that every repository write goes through.
 */
export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [model, setModel] = React.useState<ConnectionModel>(initialConnection);
  const modelRef = React.useRef<ConnectionModel>(initialConnection);

  const apply = React.useCallback((event: ConnectionEvent) => {
    modelRef.current = reduceConnection(modelRef.current, event);
    connectionGate.set(writesAllowed(deriveConnection(modelRef.current)));
    setModel(modelRef.current);
  }, []);

  const revalidate = React.useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      apply({ type: 'browser', online: false });
      return false;
    }
    if (!supabaseConfig.ok) {
      apply({ type: 'check', reachable: false });
      return false;
    }
    const reachable = await checkServer(supabaseConfig.url, supabaseConfig.anonKey);
    apply({ type: 'check', reachable });
    return writesAllowed(deriveConnection(modelRef.current));
  }, [apply]);

  React.useEffect(() => {
    const onOnline = () => {
      apply({ type: 'browser', online: true });
      void revalidate();
    };
    const onOffline = () => apply({ type: 'browser', online: false });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (navigator.onLine) void revalidate();
    else apply({ type: 'browser', online: false });
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void revalidate();
    }, CHECK_INTERVAL_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(timer);
      connectionGate.set(false);
    };
  }, [apply, revalidate]);

  const state = deriveConnection(model);
  const value = React.useMemo<ConnectionValue>(
    () => ({ state, writable: writesAllowed(state), revalidate }),
    [state, revalidate],
  );
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionValue {
  const ctx = React.useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnection must be used inside <ConnectionProvider>');
  return ctx;
}
