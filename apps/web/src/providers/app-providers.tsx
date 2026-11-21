'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { ConfigError } from '@/components/config-error';
import { supabaseConfig } from '@/lib/config';
import { createSupabaseServices } from '@/lib/services';
import { guardServices } from '@/lib/services-guard';
import { getDeviceId } from '@/lib/storage';
import { ConnectionProvider } from './connection-provider';
import { I18nProvider } from './i18n-provider';
import { ServicesProvider } from './services-provider';
import { SessionProvider } from './session-provider';
import { PwaRegister } from '@/components/pwa-register';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  });
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(makeQueryClient);
  const services = React.useMemo(
    () => (supabaseConfig.ok && typeof window !== 'undefined' ? guardServices(createSupabaseServices(supabaseConfig, getDeviceId())) : null),
    [],
  );

  return (
    <I18nProvider>
      {!supabaseConfig.ok ? (
        <ConfigError missing={supabaseConfig.missing} />
      ) : services ? (
        <ConnectionProvider>
          <QueryClientProvider client={queryClient}>
            <ServicesProvider services={services}>
              <SessionProvider>{children}</SessionProvider>
            </ServicesProvider>
          </QueryClientProvider>
        </ConnectionProvider>
      ) : null}
      <PwaRegister />
    </I18nProvider>
  );
}
