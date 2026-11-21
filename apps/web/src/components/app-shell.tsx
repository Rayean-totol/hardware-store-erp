'use client';

import { localName, type Locale } from '@erp/i18n';
import { Alert, Button, Dialog, DialogContent, DialogDescription, DialogTitle, NativeSelect, Spinner, cn } from '@erp/ui';
import {
  Boxes, ChevronLeft, ChevronRight, ClipboardList, Download, FileText, LayoutDashboard, LogOut, Menu, Package,
  Printer, Receipt, ShoppingCart, Tags, Truck, Users, UserRound, Warehouse as WarehouseIcon, Landmark,
  Calculator, Archive, Settings, Clock, X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { type LocalPendingSummary, clearLegacyDatabase, pendingTotal, summarizeLocalPending } from '@/lib/local-data';
import { isActiveRoute, mobilePrimaryTabs, type NavEntry } from '@/lib/navigation';
import { readPref, writePref } from '@/lib/storage';
import { useBackLayer } from '@/lib/use-back-layer';
import { useConnection } from '@/providers/connection-provider';
import { useI18n } from '@/providers/i18n-provider';
import { useSession } from '@/providers/session-provider';
import { ConnectionIndicator } from './connection-indicator';
import { ErrorAlert } from './error-message';
import { LanguageSwitcher } from './language-switcher';
import { useInstallPrompt } from './pwa-install';

type Icon = React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

/** Authenticated layout: redirects to /login or /onboarding when needed, then renders the shell. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const { t, locale, fmt } = useI18n();
  const { state } = useConnection();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const install = useInstallPrompt();
  const [collapsed, setCollapsed] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [signOutOpen, setSignOutOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const [signOutError, setSignOutError] = React.useState<unknown>(null);
  const [pending, setPending] = React.useState<LocalPendingSummary | null>(null);

  const closeMenu = React.useCallback(() => setMenuOpen(false), []);
  const closeSignOut = React.useCallback(() => setSignOutOpen(false), []);
  useBackLayer(menuOpen, closeMenu, 'menu');
  useBackLayer(signOutOpen, closeSignOut, 'signout');

  // Navigating from the More sheet: first drop the sheet's history entry (so back does not
  // return to it), then go to the link once that has happened. Navigating straight away would be
  // undone by the history step.
  const pendingHref = React.useRef<string | null>(null);
  React.useEffect(() => {
    const onPop = () => {
      const href = pendingHref.current;
      if (href) {
        pendingHref.current = null;
        router.push(href);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [router]);
  const navigateFromSheet = (href: string) => {
    if (window.history.state?.erpLayer === 'menu') {
      pendingHref.current = href;
      window.history.back();
    } else {
      setMenuOpen(false);
      router.push(href);
    }
  };

  React.useEffect(() => {
    setCollapsed(readPref('erp.sidebar') === 'collapsed');
  }, []);
  React.useEffect(() => {
    writePref('erp.sidebar', collapsed ? 'collapsed' : 'expanded');
  }, [collapsed]);
  React.useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  React.useEffect(() => {
    if (session.status === 'signed_out') router.replace('/login/');
    else if (session.status === 'signed_in' && !session.membership) router.replace('/onboarding/');
  }, [session.status, session.membership, router]);

  // Legacy data check. Unsent changes are only ever listed here, never sent. When nothing is pending,
  // the old offline database is removed, since it holds nothing the user still needs.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const summary = await summarizeLocalPending();
      if (summary.legacy.length === 0) await clearLegacyDatabase();
      if (!cancelled) setPending(summary);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const requestSignOut = async () => {
    setSignOutError(null);
    const summary = await summarizeLocalPending();
    if (pendingTotal(summary) === 0) {
      await doSignOut();
      return;
    }
    setPending(summary);
    setSignOutOpen(true);
  };

  const doSignOut = async () => {
    setSigningOut(true);
    try {
      await session.signOut();
    } catch (error) {
      setSignOutError(error);
    } finally {
      setSigningOut(false);
    }
  };

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

  const live: Array<NavEntry & { icon: Icon; label: string }> = [
    { key: 'dashboard', href: '/dashboard/', icon: LayoutDashboard, show: session.can('inventory.read') },
    { key: 'products', href: '/products/', icon: Package, show: session.can('catalog.read') },
    { key: 'inventory', href: '/inventory/', icon: ClipboardList, show: session.can('inventory.read') },
    { key: 'warehouses', href: '/warehouses/', icon: WarehouseIcon, show: session.can('inventory.read') },
    { key: 'catalog', href: '/catalog/', icon: Tags, show: session.can('catalog.read') },
    { key: 'labels', href: '/labels/', icon: Printer, show: session.can('catalog.read') },
    { key: 'pos', href: '/pos/', icon: ShoppingCart, show: session.can('sales.read') },
    { key: 'suppliers', href: '/suppliers/', icon: UserRound, show: session.can('suppliers.read') },
    { key: 'purchase', href: '/purchase-orders/', icon: Truck, show: session.can('purchase.read') },
    { key: 'team', href: '/team/', icon: Users, show: session.can('users.manage') },
  ].map((item) => ({ ...item, label: t(`nav.${item.key}` as 'nav.dashboard') }));
  // Modules that are planned but not built yet: shown, never clickable.
  const planned: Array<{ key: string; icon: Icon }> = [
    { key: 'customers', icon: Users }, { key: 'expenses', icon: Receipt }, { key: 'accounts', icon: Landmark },
    { key: 'reports', icon: FileText }, { key: 'staff', icon: Clock }, { key: 'vat', icon: Calculator },
    { key: 'backup', icon: Archive }, { key: 'settings', icon: Settings },
  ];
  const labelOf = (key: string) => t(`nav.${key}` as 'nav.dashboard');
  const primary = mobilePrimaryTabs(live);

  const navList = (collapsedView: boolean, onNavigate?: (href: string) => void) => (
    <nav aria-label={t('nav.main')} className="flex flex-col gap-1">
      {live.filter((n) => n.show).map(({ key, href, icon: Icon, label }) => {
        const active = isActiveRoute(pathname, href);
        return (
          <Link key={key} href={href} aria-current={active ? 'page' : undefined} title={collapsedView ? label : undefined}
            onClick={onNavigate ? (e) => { e.preventDefault(); onNavigate(href); } : undefined}
            className={cn(
              'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
              active ? 'bg-primary text-primary-foreground shadow-md shadow-primary/30' : 'text-foreground/80 hover:bg-accent',
              collapsedView && 'justify-center px-0',
            )}>
            <Icon className="size-5 shrink-0" aria-hidden={true} />
            <span className={cn('truncate', collapsedView && 'sr-only')}>{label}</span>
          </Link>
        );
      })}
      {planned.map(({ key, icon: Icon }) => (
        <span key={key} aria-disabled="true" title={t('nav.soon_hint')}
          className={cn('flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground/60',
            collapsedView && 'justify-center px-0')}>
          <Icon className="size-5 shrink-0" aria-hidden={true} />
          <span className={cn('truncate', collapsedView && 'sr-only')}>{labelOf(key)}</span>
          {!collapsedView ? <span className="ms-auto rounded-full border border-border px-2 py-0.5 text-[10px]">{t('nav.soon')}</span> : null}
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

  const installBlock = install.canInstall || install.showIosHint ? (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      {install.canInstall ? (
        <Button variant="outline" size="sm" className="min-h-11 justify-start" onClick={() => void install.install()}>
          <Download aria-hidden={true} />{t('pwa.install')}
        </Button>
      ) : null}
      {install.showIosHint ? <p className="text-xs text-muted-foreground">{t('pwa.install_ios')}</p> : null}
    </div>
  ) : null;

  const pendingLegacy = pending?.legacy.length ?? 0;

  return (
    <>
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
          {navList(collapsed)}
          <div className="mt-auto flex flex-col gap-2">
            <LanguageSwitcher />
            <Button variant="ghost" size="sm" className={cn('justify-start', collapsed && 'justify-center')} onClick={() => void requestSignOut()}>
              <LogOut className="rtl:-scale-x-100" aria-hidden={true} />
              <span className={cn(collapsed && 'sr-only')}>{t('nav.sign_out')}</span>
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-sidebar-border bg-background/90 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur sm:gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground md:hidden">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-amber-400 to-orange-500 text-black">
                <Boxes className="size-4" aria-hidden={true} />
              </span>
              <span className="truncate font-semibold text-foreground">{t('app.name')}</span>
            </div>
            <div className="hidden min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground md:flex">
              <span className="truncate">{session.user?.email ?? ''}</span>
            </div>
            <ConnectionIndicator />
            <span className="hidden items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground lg:flex">
              <Archive className="size-3.5" aria-hidden={true} />
              {t(`role.${session.membership.role}` as 'role.owner')}
            </span>
          </header>

          {state !== 'online' ? (
            <div role="status" className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
              {t('connection.offline_banner')}
            </div>
          ) : null}

          {pendingLegacy > 0 ? (
            <div className="px-4 pt-4 md:px-6 lg:px-8">
              <Alert variant="warning" className="flex flex-wrap items-center justify-between gap-2">
                <span>{t('legacy.banner', { count: fmt.number(pendingLegacy) })}</span>
                <Button asChild size="sm" variant="outline"><Link href="/inventory/">{t('legacy.review')}</Link></Button>
              </Alert>
            </div>
          ) : null}

          <main className="min-w-0 flex-1 p-4 pb-28 md:p-6 md:pb-6 lg:p-8">{children}</main>
        </div>
      </div>

      {/* Phones: primary tabs plus "More". Respects the bottom safe area (home indicator). */}
      <nav aria-label={t('nav.primary')} className="fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-border bg-sidebar/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-flow-col auto-cols-[minmax(0,1fr)]">
          {primary.map(({ key, href, icon: Icon, label }) => {
            const active = isActiveRoute(pathname, href);
            return (
              <li key={key} className="min-w-0">
                <Link href={href} aria-current={active ? 'page' : undefined}
                  className={cn('flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium',
                    active ? 'text-amber-400' : 'text-muted-foreground')}>
                  <Icon className="size-5" aria-hidden={true} />
                  <span className="max-w-full truncate">{label}</span>
                </Link>
              </li>
            );
          })}
          <li className="min-w-0">
            <button type="button" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls="erp-more-sheet"
              onClick={() => setMenuOpen(true)}
              className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium text-muted-foreground">
              <Menu className="size-5" aria-hidden={true} />
              <span>{t('nav.more')}</span>
            </button>
          </li>
        </ul>
      </nav>

      {/* Phones: "More" sheet with every permitted module, install, language and sign-out. */}
      {menuOpen ? (
        <div id="erp-more-sheet" className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={t('nav.more')}>
          <button type="button" aria-label={t('nav.close_menu')} className="absolute inset-0 bg-black/60" onClick={closeMenu} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col gap-4 overflow-y-auto rounded-t-2xl border-t border-sidebar-border bg-sidebar p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold">
                <span className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-black">
                  <Boxes className="size-5" aria-hidden={true} />
                </span>
                <span className="text-sm">{t('app.name')}</span>
              </div>
              <Button variant="ghost" size="icon" aria-label={t('nav.close_menu')} onClick={closeMenu}>
                <X aria-hidden={true} />
              </Button>
            </div>
            <ConnectionIndicator className="self-start" />
            {orgLine}
            {navList(false, navigateFromSheet)}
            {installBlock}
            <div className="flex flex-col gap-2">
              <LanguageSwitcher />
              <Button variant="ghost" size="sm" className="min-h-11 justify-start" onClick={() => { closeMenu(); void requestSignOut(); }}>
                <LogOut className="rtl:-scale-x-100" aria-hidden={true} />{t('nav.sign_out')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Dialog open={signOutOpen} onOpenChange={(open) => { if (!open && !signingOut) setSignOutOpen(false); }}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogTitle>{t('signout.title')}</DialogTitle>
          <DialogDescription>
            {t('signout.body', { count: fmt.number(pendingTotal(pending ?? { legacy: [], heldSales: 0 })) })}
          </DialogDescription>
          {pending && pending.legacy.length > 0 ? (
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
              {pending.legacy.map((e) => (
                <li key={e.id} className="rounded-md border p-2">
                  {t(`movement.type_${e.movementType}` as 'movement.type_stock_in')} · {fmt.number(e.quantity)} · {fmt.dateTime(e.createdAt)}
                </li>
              ))}
            </ul>
          ) : null}
          {pending && pending.heldSales > 0 ? <p className="text-sm">{t('signout.holds', { count: fmt.number(pending.heldSales) })}</p> : null}
          {signOutError ? <ErrorAlert error={signOutError} /> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setSignOutOpen(false)} disabled={signingOut}>{t('common.cancel')}</Button>
            <Button variant="destructive" disabled={signingOut} onClick={() => void doSignOut()}>
              {signingOut ? t('common.loading') : t('signout.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}
