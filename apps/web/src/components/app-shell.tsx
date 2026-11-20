'use client';

import { localName } from '@erp/i18n';
import { Button, cn, NativeSelect, Spinner } from '@erp/ui';
import { Boxes, ClipboardList, LogOut, Package, Printer, Tags, Users, Warehouse as WarehouseIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { useI18n } from '@/providers/i18n-provider';
import { useSession } from '@/providers/session-provider';
import { SyncProvider } from '@/providers/sync-provider';
import { ErrorAlert } from './error-message';
import { LanguageSwitcher } from './language-switcher';

/** Authenticated layout: redirects to /login or /onboarding when needed. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (session.status === 'signed_out') router.replace('/login/');
    else if (session.status === 'signed_in' && !session.membership) router.replace('/onboarding/');
  }, [session.status, session.membership, router]);

  if (session.status === 'error') {
    return (
      <main className="mx-auto max-w-xl p-6">
        <ErrorAlert error={session.error} onRetry={() => void session.refresh()} />
      </main>
    );
  }
  if (session.status !== 'signed_in' || !session.membership) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner label={t('common.loading')} />
      </main>
    );
  }

  const nav = [
    { href: '/products/', label: t('nav.products'), icon: Package, show: session.can('catalog.read') },
    { href: '/inventory/', label: t('nav.inventory'), icon: ClipboardList, show: session.can('inventory.read') },
    { href: '/warehouses/', label: t('nav.warehouses'), icon: WarehouseIcon, show: session.can('inventory.read') },
    { href: '/labels/', label: t('nav.labels'), icon: Printer, show: session.can('catalog.read') },
    { href: '/catalog/', label: t('nav.catalog_setup'), icon: Tags, show: session.can('catalog.read') },
    { href: '/team/', label: t('nav.team'), icon: Users, show: session.can('users.manage') },
  ].filter((n) => n.show);

  return (
    <SyncProvider>
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-4 border-b bg-card p-4 md:w-64 md:border-e md:border-b-0">
        <div className="flex items-center gap-2 font-semibold">
          <Boxes className="size-5 text-primary" aria-hidden="true" />
          {t('app.name')}
        </div>

        {session.memberships.length > 1 ? (
          <NativeSelect
            aria-label={t('nav.organization')}
            value={session.membership.orgId}
            onChange={(e) => session.setActiveOrg(e.target.value)}
            className="h-9 text-xs"
          >
            {session.memberships.map((m) => (
              <option key={m.orgId} value={m.orgId}>
                {locale === 'ar' ? m.orgNameAr : m.orgNameEn}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <p className="text-sm text-muted-foreground">
            {localName({ nameEn: session.membership.orgNameEn, nameAr: session.membership.orgNameAr }, locale)}
            <span className="block text-xs">{t(`role.${session.membership.role}` as 'role.owner')}</span>
          </p>
        )}

        <nav aria-label="Main" className="flex gap-1 overflow-x-auto md:flex-col">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname?.startsWith(href.replace(/\/$/, ''));
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap hover:bg-accent',
                  active && 'bg-accent font-medium text-accent-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>

        <p className="hidden text-xs text-muted-foreground md:block">{t('nav.planned')}</p>

        <div className="mt-auto flex flex-wrap items-center gap-2 md:flex-col md:items-stretch">
          <LanguageSwitcher />
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => void session.signOut()}>
            <LogOut className="dir-icon" aria-hidden="true" />
            {t('nav.sign_out')}
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
    </SyncProvider>
  );
}
