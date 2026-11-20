'use client';

import { localName, type Locale } from '@erp/i18n';
import { Button, cn, NativeSelect, Spinner } from '@erp/ui';
import {
  Boxes, ChevronLeft, ChevronRight, ClipboardList, FileText, LayoutDashboard, LogOut, Menu, Package,
  Printer, Receipt, ShoppingCart, Tags, Truck, Users, UserRound, Warehouse as WarehouseIcon, Wallet, Landmark,
  Calculator, Archive, Settings, Clock, X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { readPref, writePref } from '@/lib/storage';
import { useI18n } from '@/providers/i18n-provider';
import { useSession } from '@/providers/session-provider';
import { SyncProvider } from '@/providers/sync-provider';
import { ErrorAlert } from './error-message';
import { LanguageSwitcher } from './language-switcher';

type Icon = React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
interface NavItem {
  key: string;
  href?: string;
  icon: Icon;
  show: boolean;
}

/** Authenticated layout: redirects to /login or /onboarding when needed, then renders the shell. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const [collapsed, setCollapsed] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  React.useEffect(() => {
    setCollapsed(readPref('erp.sidebar') === 'collapsed');
  }, []);
  React.useEffect(() => {
    writePref('erp.sidebar', collapsed ? 'collapsed' : 'expanded');
  }, [collapsed]);
  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);
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

  const live: NavItem[] = [
    { key: 'dashboard', href: '/dashboard/', icon: LayoutDashboard, show: session.can('inventory.read') },
    { key: 'products', href: '/products/', icon: Package, show: session.can('catalog.read') },
    { key: 'inventory', href: '/inventory/', icon: ClipboardList, show: session.can('inventory.read') },
    { key: 'warehouses', href: '/warehouses/', icon: WarehouseIcon, show: session.can('inventory.read') },
    { key: 'catalog', href: '/catalog/', icon: Tags, show: session.can('catalog.read') },
    { key: 'labels', href: '/labels/', icon: Printer, show: session.can('catalog.read') },
    { key: 'pos', href: '/pos/', icon: ShoppingCart, show: session.can('sales.read') },
    { key: 'team', href: '/team/', icon: Users, show: session.can('users.manage') },
  ];
  // Modules that are planned but not built yet: shown, never clickable.
  const planned: Array<{ key: string; icon: Icon }> = [
    { key: 'purchase', icon: Truck }, { key: 'suppliers', icon: UserRound },
    { key: 'customers', icon: Users }, { key: 'expenses', icon: Receipt }, { key: 'accounts', icon: Landmark },
    { key: 'reports', icon: FileText }, { key: 'staff', icon: Clock }, { key: 'vat', icon: Calculator },
    { key: 'backup', icon: Archive }, { key: 'settings', icon: Settings },
  ];
  const labelOf = (key: string) => t(`nav.${key}` as 'nav.dashboard');

  const navList = (
    <nav aria-label={t('nav.main')} className="flex flex-col gap-1">
      {live.filter((n) => n.show).map(({ key, href, icon: Icon }) => {
        const active = href ? pathname.startsWith(href.replace(/\/$/, '')) : false;
        return (
          <Link key={key} href={href!} aria-current={active ? 'page' : undefined} title={collapsed ? labelOf(key) : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
              active ? 'bg-primary text-primary-foreground shadow-md shadow-primary/30' : 'text-foreground/80 hover:bg-accent',
              collapsed && 'justify-center px-0',
            )}>
            <Icon className="size-5 shrink-0" aria-hidden={true} />
            <span className={cn('truncate', collapsed && 'sr-only')}>{labelOf(key)}</span>
          </Link>
        );
      })}
      {planned.map(({ key, icon: Icon }) => (
        <span key={key} aria-disabled="true" title={t('nav.soon_hint')}
          className={cn('flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground/60',
            collapsed && 'justify-center px-0')}>
          <Icon className="size-5 shrink-0" aria-hidden={true} />
          <span className={cn('truncate', collapsed && 'sr-only')}>{labelOf(key)}</span>
          {!collapsed ? <span className="ms-auto rounded-full border border-border px-2 py-0.5 text-[10px]">{t('nav.soon')}</span> : null}
        </span>
      ))}
    </nav>
  );

  const brand = (
    <div className={cn('flex items-center gap-2 px-2 font-semibold', collapsed && 'justify-center px-0')}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-black">
        <Boxes className="size-5" aria-hidden={true} />
      </span>
      <span className={cn('leading-tight', collapsed && 'sr-only')}>
        <span className="block text-sm">{t('app.name')}</span>
        <span className="block text-xs font-normal text-amber-400">{t('app.product')}</span>
      </span>
    </div>
  );

  const orgLine = session.memberships.length > 1 ? (
    <NativeSelect aria-label={t('nav.organization')} value={session.membership.orgId}
      onChange={(e) => session.setActiveOrg(e.target.value)} className="h-9 text-xs">
      {session.memberships.map((m) => (
        <option key={m.orgId} value={m.orgId}>{locale === 'ar' ? m.orgNameAr : m.orgNameEn}</option>
      ))}
    </NativeSelect>
  ) : (
    <p className={cn('px-2 text-xs text-muted-foreground', collapsed && 'sr-only')}>
      {localName({ nameEn: session.membership.orgNameEn, nameAr: session.membership.orgNameAr }, locale as Locale)}
      <span className="block">{t(`role.${session.membership.role}` as 'role.owner')}</span>
    </p>
  );

  return (
    <SyncProvider>
      <div className="flex min-h-dvh bg-background">
        {/* Desktop sidebar */}
        <aside className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col gap-4 overflow-y-auto border-e border-sidebar-border bg-sidebar p-3 transition-[width] duration-200 md:flex',
          collapsed ? 'w-20' : 'w-64',
        )}>
          <div className="flex items-center justify-between gap-2">
            {brand}
            <Button variant="ghost" size="icon" aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
              onClick={() => setCollapsed((c) => !c)} className={cn(collapsed && 'hidden')}>
              <ChevronLeft className="rtl:-scale-x-100" aria-hidden={true} />
            </Button>
          </div>
          {collapsed ? (
            <Button variant="ghost" size="icon" aria-label={t('nav.expand')} onClick={() => setCollapsed(false)}>
              <ChevronRight className="rtl:-scale-x-100" aria-hidden={true} />
            </Button>
          ) : null}
          {orgLine}
          {navList}
          <div className="mt-auto flex flex-col gap-2">
            <LanguageSwitcher />
            <Button variant="ghost" size="sm" className={cn('justify-start', collapsed && 'justify-center')} onClick={() => void session.signOut()}>
              <LogOut className="rtl:-scale-x-100" aria-hidden={true} />
              <span className={cn(collapsed && 'sr-only')}>{t('nav.sign_out')}</span>
            </Button>
          </div>
        </aside>

        {/* Mobile drawer */}
        {drawerOpen ? (
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={t('nav.main')}>
            <button type="button" aria-label={t('nav.close_menu')} className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
            <aside className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto border-e border-sidebar-border bg-sidebar p-3">
              <div className="flex items-center justify-between">
                {brand}
                <Button variant="ghost" size="icon" aria-label={t('nav.close_menu')} onClick={() => setDrawerOpen(false)}>
                  <X aria-hidden={true} />
                </Button>
              </div>
              {orgLine}
              {navList}
              <div className="mt-auto flex flex-col gap-2">
                <LanguageSwitcher />
                <Button variant="ghost" size="sm" className="justify-start" onClick={() => void session.signOut()}>
                  <LogOut className="rtl:-scale-x-100" aria-hidden={true} />{t('nav.sign_out')}
                </Button>
              </div>
            </aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-sidebar-border bg-background/90 px-4 py-3 backdrop-blur">
            <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('nav.open_menu')} onClick={() => setDrawerOpen(true)}>
              <Menu aria-hidden={true} />
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
              <Wallet className="size-4 shrink-0" aria-hidden={true} />
              <span className="truncate">{session.user?.email ?? ''}</span>
            </div>
            <span className="hidden items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground sm:flex">
              <Archive className="size-3.5" aria-hidden={true} />
              {t(`role.${session.membership.role}` as 'role.owner')}
            </span>
          </header>
          <main className="min-w-0 flex-1 p-4 md:p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </SyncProvider>
  );
}

