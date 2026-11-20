'use client';

import { localName, type Locale } from '@erp/i18n';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, NativeSelect, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from '@erp/ui';
import { AlertTriangle, Boxes, PackageX, Package, Wallet, Landmark, Users, Truck, Receipt, Percent, TrendingUp, BarChart3 } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useMembership, useSession } from '@/providers/session-provider';
import { useInventorySummary, useLowStockList } from './use-dashboard';

type Tone = 'green' | 'blue' | 'orange' | 'purple' | 'cyan';
const TONE: Record<Tone, string> = {
  green: 'from-emerald-500/25 via-emerald-500/5 to-transparent border-emerald-500/30 text-emerald-300',
  blue: 'from-blue-500/25 via-blue-500/5 to-transparent border-blue-500/30 text-blue-300',
  orange: 'from-orange-500/25 via-orange-500/5 to-transparent border-orange-500/30 text-orange-300',
  purple: 'from-purple-500/25 via-purple-500/5 to-transparent border-purple-500/30 text-purple-300',
  cyan: 'from-cyan-500/25 via-cyan-500/5 to-transparent border-cyan-500/30 text-cyan-300',
};

function StatCard({ tone, icon: Icon, label, value, note }: {
  tone: Tone; icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  label: string; value: string | null; note?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={cn('rounded-2xl border bg-gradient-to-br p-4 shadow-lg shadow-black/20', TONE[tone])}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-foreground/80">{label}</span>
        <Icon className="size-5" aria-hidden={true} />
      </div>
      {value === null ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('dashboard.not_available')}</p>
      ) : (
        <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      )}
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function Dashboard() {
  const { t, fmt, locale } = useI18n();
  const membership = useMembership();
  const branches = membership.branches;
  const { can } = useSession();
  const [branchId, setBranchId] = React.useState<string | null>(null);
  const summary = useInventorySummary(membership.orgId, branchId);
  const lowStock = useLowStockList(membership.orgId, branchId);

  if (!can('inventory.read')) {
    return (<><PageHeader title={t('dashboard.title')} /><Alert variant="warning">{t('errors.forbidden')}</Alert></>);
  }

  const s = summary.data;
  const money = (v: string) => fmt.money(v);
  const top = (lowStock.data ?? []).slice(0, 6);

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label={t('dashboard.branch')} className="h-9 w-auto text-xs" value={branchId ?? ''}
              onChange={(e) => setBranchId(e.target.value || null)}>
              <option value="">{branches.length > 1 ? t('dashboard.all_branches') : t('dashboard.my_branch')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{locale === 'ar' ? b.nameAr : b.nameEn}</option>
              ))}
            </NativeSelect>
          </div>
        }
      />
      <p className="mb-5 text-sm text-muted-foreground">{t('dashboard.subtitle')}</p>

      {summary.error ? <ErrorAlert error={summary.error} onRetry={() => void summary.refetch()} /> : null}

      {/* Real inventory figures */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard tone="cyan" icon={Boxes} label={t('dashboard.stock_value')} value={s ? money(s.stockValue) : null}
          note={t('dashboard.stock_value_note')} />
        <StatCard tone="blue" icon={Package} label={t('dashboard.products')} value={s ? fmt.number(s.productCount) : null} />
        <StatCard tone="orange" icon={AlertTriangle} label={t('dashboard.low_stock')} value={s ? fmt.number(s.lowStockCount) : null}
          note={t('dashboard.low_stock_note')} />
        <StatCard tone="purple" icon={PackageX} label={t('dashboard.out_of_stock')} value={s ? fmt.number(s.outOfStockCount) : null} />
      </div>

      {/* Figures that need modules not built yet: shown honestly, never as sample numbers */}
      <h2 className="mb-3 mt-8 text-sm font-medium text-muted-foreground">{t('dashboard.pending_title')}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard tone="green" icon={BarChart3} label={t('dashboard.today_sales')} value={null} note={t('dashboard.needs_pos')} />
        <StatCard tone="blue" icon={Truck} label={t('dashboard.today_purchases')} value={null} note={t('dashboard.needs_purchase')} />
        <StatCard tone="orange" icon={Receipt} label={t('dashboard.today_expenses')} value={null} note={t('dashboard.needs_accounts')} />
        <StatCard tone="purple" icon={TrendingUp} label={t('dashboard.today_profit')} value={null} note={t('dashboard.needs_accounts')} />
        <StatCard tone="green" icon={Wallet} label={t('dashboard.cash_balance')} value={null} note={t('dashboard.needs_accounts')} />
        <StatCard tone="blue" icon={Landmark} label={t('dashboard.bank_balance')} value={null} note={t('dashboard.needs_accounts')} />
        <StatCard tone="cyan" icon={Users} label={t('dashboard.receivables')} value={null} note={t('dashboard.needs_customers')} />
        <StatCard tone="orange" icon={Percent} label={t('dashboard.net_vat')} value={null} note={t('dashboard.needs_vat')} />
      </div>

      <div className="mt-8 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card className="border-border bg-card/80">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">{t('dashboard.low_stock_table')}</CardTitle>
            <Button asChild variant="ghost" size="sm"><Link href="/inventory/">{t('dashboard.view_all')}</Link></Button>
          </CardHeader>
          <CardContent>
            {lowStock.isPending ? <Spinner label={t('common.loading')} /> : lowStock.error ? <ErrorAlert error={lowStock.error} /> : (
              top.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t('dashboard.no_low_stock')}</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('products.col_sku')}</TableHead>
                      <TableHead>{t('products.col_name')}</TableHead>
                      <TableHead className="text-end">{t('dashboard.on_hand')}</TableHead>
                      <TableHead className="text-end">{t('dashboard.min')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {top.map((r) => (
                      <TableRow key={`${r.warehouseId}-${r.productId}`}>
                        <TableCell dir="ltr" className="font-mono text-xs">{r.sku}</TableCell>
                        <TableCell>{localName({ nameEn: r.nameEn, nameAr: r.nameAr, nameBn: null }, locale as Locale)}</TableCell>
                        <TableCell className="text-end tabular-nums text-red-400">{fmt.number(r.quantity)}</TableCell>
                        <TableCell className="text-end tabular-nums">{fmt.number(r.reorderLevel)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card/80">
          <CardHeader><CardTitle className="text-base">{t('dashboard.charts_title')}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('dashboard.charts_pending')}</p>
            <div className="mt-4 flex items-center gap-2"><Badge variant="outline">{t('dashboard.phase_pos')}</Badge><Badge variant="outline">{t('dashboard.phase_purchase')}</Badge></div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

