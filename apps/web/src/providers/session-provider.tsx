'use client';

import type { MembershipContext } from '@erp/data';
import type { Permission } from '@erp/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { clearLocalBusinessData } from '@/lib/local-data';
import type { AuthUser } from '@/lib/services';
import { readPref, writePref } from '@/lib/storage';
import { useServices } from './services-provider';

type Status = 'loading' | 'signed_out' | 'signed_in' | 'error';

interface SessionValue {
  status: Status;
  error: unknown;
  user: AuthUser | null;
  memberships: MembershipContext[];
  /** The organization the user is currently working in. */
  membership: MembershipContext | null;
  setActiveOrg(orgId: string): void;
  can(permission: Permission): boolean;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = React.createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { auth, org } = useServices();
  const queryClient = useQueryClient();
  const [user, setUser] = React.useState<AuthUser | null | undefined>(undefined);
  const [authError, setAuthError] = React.useState<unknown>(null);
  const [activeOrgId, setActiveOrgId] = React.useState<string | null>(() => readPref('erp.orgId'));

  React.useEffect(() => {
    let cancelled = false;
    auth.getUser().then(
      (u) => !cancelled && setUser(u),
      (e: unknown) => {
        if (!cancelled) {
          setAuthError(e);
          setUser(null);
        }
      },
    );
    const unsubscribe = auth.onChange((u) => {
      setUser(u);
      if (!u) queryClient.clear();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [auth, queryClient]);

  const context = useQuery({
    queryKey: ['my-context', user?.id],
    queryFn: () => org.getMyContext(),
    enabled: Boolean(user),
  });

  const memberships = context.data ?? [];
  const membership = memberships.find((m) => m.orgId === activeOrgId) ?? memberships[0] ?? null;

  let status: Status;
  if (user === undefined) status = 'loading';
  else if (user === null) status = authError ? 'error' : 'signed_out';
  else if (context.isPending) status = 'loading';
  else if (context.isError) status = 'error';
  else status = 'signed_in';

  const value: SessionValue = {
    status,
    error: authError ?? context.error,
    user: user ?? null,
    memberships,
    membership,
    setActiveOrg: (orgId) => {
      writePref('erp.orgId', orgId);
      setActiveOrgId(orgId);
    },
    can: (permission) => membership?.permissions.includes(permission) ?? false,
    refresh: async () => {
      await context.refetch();
    },
    signOut: async () => {
      await auth.signOut();
      // Business data kept on this device (held sales, unsent legacy entries, cache) goes with the session.
      await clearLocalBusinessData();
      queryClient.clear();
    },
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

/** For pages that only render once a membership exists (enforced by AppShell). */
export function useMembership(): MembershipContext {
  const { membership } = useSession();
  if (!membership) throw new Error('useMembership requires an active organization');
  return membership;
}
