'use client';

import { applyImportPlan, DataError, planImportFile, type ImportOutcome } from '@erp/data';
import { importBlockReason } from './import-gate';
import type { ImportPlan } from '@erp/domain';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@erp/ui';
import { Upload } from 'lucide-react';
import * as React from 'react';
import { ErrorAlert, useErrorText } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';

const MAX_BYTES = 2 * 1024 * 1024;

const TEMPLATE = [
  'sku,name_en,name_ar,name_bn,description,category,brand,product_type,base_unit,tax_category,tax_exemption_reason,reorder_level,unit,factor,barcode,sale_price,is_sale,is_purchase',
  'EXAMPLE-1,Example screw,برغي مثال,,,Fasteners,Najd Fasteners,stock,pcs,S,,100,pcs,1,,0.15,yes,yes',
  'EXAMPLE-1,Example screw,برغي مثال,,,Fasteners,Najd Fasteners,stock,pcs,S,,100,box,200,,25,yes,yes',
].join('\r\n') + '\r\n';

export function ProductImport() {
  const { t, tMaybe, fmt } = useI18n();
  const { catalog } = useServices();
  const { orgId } = useMembership();
  const { can } = useSession();
  const errorText = useErrorText();
  const [fileName, setFileName] = React.useState('');
  const [plan, setPlan] = React.useState<ImportPlan | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = React.useState<ImportOutcome[] | null>(null);
  const [error, setError] = React.useState<unknown>(null);

  const issueText = (code: string) => tMaybe(`issues.${code}`) ?? tMaybe(`errors.${code}`) ?? code;

  async function onFile(file: File | undefined) {
    setError(null);
    setOutcomes(null);
    setPlan(null);
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_BYTES) {
      setError(new Error(t('import.too_large')));
      return;
    }
    setBusy('plan');
    try {
      setPlan(await planImportFile(catalog, orgId, await file.text()));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (importBlockReason(plan) !== null) return; // belt and braces: never run a blocked plan
    if (!plan) return;
    setBusy('apply');
    setError(null);
    setProgress({ done: 0, total: plan.counts.create + plan.counts.update });
    try {
      setOutcomes(await applyImportPlan(catalog, plan, (done, total) => setProgress({ done, total })));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  function downloadTemplate() {
    const blob = new Blob(['﻿', TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'products-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!can('catalog.write')) {
    return (<><PageHeader title={t('import.title')} /><Alert variant="warning">{t('errors.forbidden')}</Alert></>);
  }

  // Fail closed: any invalid row blocks the whole import (see import-gate.ts).
  const block = importBlockReason(plan);
  const runnable = block === null;

  return (
    <>
      <PageHeader title={t('import.title')} actions={<Button variant="outline" onClick={downloadTemplate}>{t('import.template')}</Button>} />
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">{t('import.help')}</p>

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 pt-5">
          <label className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
              <Upload className="size-4" aria-hidden="true" />
              {t('import.choose_file')}
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
            </span>
            {fileName ? <span className="text-sm text-muted-foreground" dir="ltr">{fileName}</span> : null}
          </label>
          {busy === 'plan' ? <Spinner label={t('import.checking')} /> : null}
          {error ? <ErrorAlert error={error} /> : null}
        </CardContent>
      </Card>

      {plan ? (
        <>
          {plan.fatal.length > 0 ? (
            <Alert variant="destructive" className="mb-4">
              <p>{t('import.fatal')}</p>
              <ul className="mt-1 list-disc ps-5">
                {plan.fatal.map((f, i) => <li key={i}>{f.line > 0 ? t('import.line', { line: f.line }) + ' ' : ''}{issueText(f.code)} {f.path}</li>)}
              </ul>
            </Alert>
          ) : null}
          {block === 'invalid' ? (
            <Alert variant="destructive" className="mb-4">
              <p>{t('import.blocked_invalid', { count: fmt.number(plan.counts.invalid) })}</p>
            </Alert>
          ) : null}
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="success">{t('import.count_create', { count: fmt.number(plan.counts.create) })}</Badge>
            <Badge variant="secondary">{t('import.count_update', { count: fmt.number(plan.counts.update) })}</Badge>
            <Badge variant={plan.counts.invalid > 0 ? 'destructive' : 'outline'}>{t('import.count_invalid', { count: fmt.number(plan.counts.invalid) })}</Badge>
            <Button onClick={() => void run()} disabled={!runnable || busy !== null}>
              {busy === 'apply' ? t('common.saving') : t('import.run', { count: fmt.number(plan.counts.create + plan.counts.update) })}
            </Button>
            {progress ? <span className="tabular-nums">{fmt.number(progress.done)} / {fmt.number(progress.total)}</span> : null}
          </div>

          <Card className="mb-4">
            <CardHeader><CardTitle className="text-base">{t('import.preview')}</CardTitle></CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('import.line_col')}</TableHead>
                  <TableHead>{t('products.col_sku')}</TableHead>
                  <TableHead>{t('import.action')}</TableHead>
                  <TableHead>{t('import.problems')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.products.map((p) => (
                  <TableRow key={`${p.sku}-${p.firstLine}`}>
                    <TableCell>{p.firstLine}</TableCell>
                    <TableCell dir="ltr" className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell>
                      {p.action === 'invalid' ? <Badge variant="destructive">{t('import.invalid')}</Badge>
                        : p.action === 'create' ? <Badge variant="success">{t('import.create')}</Badge>
                          : <Badge variant="secondary">{t('import.update')}</Badge>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {[...p.issues, ...p.warnings].map((i, idx) => (
                        <div key={idx} className={p.issues.includes(i) ? 'text-destructive' : 'text-muted-foreground'}>
                          {t('import.line', { line: i.line })} · {i.path ? `${i.path}: ` : ''}{issueText(i.code)}
                        </div>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      ) : null}

      {outcomes ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('import.results')}</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {outcomes.map((o, i) => (
                <li key={i} className={o.status === 'failed' ? 'text-destructive' : ''}>
                  <span dir="ltr" className="font-mono text-xs">{o.sku}</span> — {t(`import.status_${o.status}` as 'import.status_created')}
                  {o.status === 'failed' ? ` · ${errorText(new DataError(o.code ?? 'unknown', o.message ?? ''))}` : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
