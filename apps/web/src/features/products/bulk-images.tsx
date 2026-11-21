'use client';

import { loadAllProducts, type Product } from '@erp/data';
import { Alert, Badge, Button, Card, CardContent, Spinner } from '@erp/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, ImagePlus, Upload } from 'lucide-react';
import * as React from 'react';
import { ErrorAlert, useErrorText } from '@/components/error-message';
import { PageHeader } from '@/components/page-header';
import { useConnection } from '@/providers/connection-provider';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { useMembership, useSession } from '@/providers/session-provider';
import { compressForUpload } from './image-compress';
import { matchImages, type ImageMatch } from './image-match';
import { catalogKeys } from './use-catalog-data';

interface Item {
  key: string;
  file: File;
  blob: Blob | null;
  preview: string | null;
  error: string | null;
  result: 'uploaded' | 'failed' | null;
}

/**
 * Bulk product photos. Each file is matched to a product by its SKU in the file name. Nothing is
 * uploaded until every file has been previewed, and an existing photo is replaced only after an
 * explicit confirmation. Uploads use the same storage path and permissions as the product screen.
 */
export function BulkImages() {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const { catalog, productImages } = useServices();
  const { orgId } = useMembership();
  const { writable } = useConnection();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [items, setItems] = React.useState<Item[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  const products = useQuery({
    queryKey: [...catalogKeys.products(orgId), 'bulk-images'],
    queryFn: () => loadAllProducts(catalog, orgId),
    enabled: can('catalog.write'),
  });

  const refs = React.useMemo(
    () => (products.data ?? []).map((p: Product) => ({ id: p.id, sku: p.sku, hasImage: Boolean(p.imagePath) })),
    [products.data],
  );
  const matches: ImageMatch[] = React.useMemo(() => matchImages(items.map((i) => i.file.name), refs), [items, refs]);
  const matchOf = (index: number) => matches[index]!;

  // Release preview URLs when the page is left.
  const previews = React.useRef<string[]>([]);
  React.useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    setBusy('compress');
    try {
      for (const file of Array.from(list)) {
        const key = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`;
        let blob: Blob | null = null;
        let preview: string | null = null;
        let itemError: string | null = null;
        try {
          blob = await compressForUpload(file);
          preview = URL.createObjectURL(blob);
          previews.current.push(preview);
        } catch (err) {
          itemError = errorText(err);
        }
        setItems((current) => [...current, { key, file, blob, preview, error: itemError, result: null }]);
      }
    } finally {
      setBusy(null);
    }
  }

  const uploadable = items
    .map((item, index) => ({ item, match: matchOf(index) }))
    .filter(({ item, match }) => item.blob && !item.result && (match.status === 'ready' || (match.status === 'replace' && replaceConfirmed)));
  const replaceCount = matches.filter((m) => m.status === 'replace').length;
  const blockedReason = !writable ? t('writes.disabled_hint') : null;

  async function uploadAll() {
    if (busy || !writable) return;
    setBusy('upload');
    setError(null);
    setProgress({ done: 0, total: uploadable.length });
    try {
      let done = 0;
      for (const { item, match } of uploadable) {
        try {
          const file = new File([item.blob!], `${match.sku}.jpg`, { type: 'image/jpeg' });
          const path = await productImages.upload(orgId, match.productId!, file, 'jpg');
          await catalog.setProductImagePath(match.productId!, path);
          setItems((current) => current.map((i) => (i.key === item.key ? { ...i, result: 'uploaded' } : i)));
        } catch (err) {
          const message = errorText(err);
          setItems((current) => current.map((i) => (i.key === item.key ? { ...i, result: 'failed', error: message } : i)));
        }
        done += 1;
        setProgress({ done, total: uploadable.length });
      }
      await queryClient.invalidateQueries({ queryKey: catalogKeys.products(orgId) });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  if (!can('catalog.write')) {
    return (<><PageHeader title={t('images.title')} /><Alert variant="warning">{t('errors.forbidden')}</Alert></>);
  }

  const uploaded = items.filter((i) => i.result === 'uploaded').length;
  const failed = items.filter((i) => i.result === 'failed').length;
  // Skipped = not uploaded in this session and not queued for upload (unmatched, ambiguous, unsupported, or unconfirmed replace).
  const queued = new Set(uploadable.map(({ item }) => item.key));
  const skipped = items.filter((i) => !i.result && !queued.has(i.key)).length;

  return (
    <>
      <PageHeader title={t('images.title')} />
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">{t('images.help')}</p>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap gap-3 pt-5">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
            <ImagePlus className="size-4" aria-hidden="true" />
            {t('images.pick_gallery')}
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only"
              onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
            <Camera className="size-4" aria-hidden="true" />
            {t('images.pick_camera')}
            <input type="file" accept="image/*" capture="environment" className="sr-only"
              onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          {products.isPending ? <Spinner label={t('common.loading')} /> : null}
          {busy === 'compress' ? <Spinner label={t('images.compressing')} /> : null}
          {products.error ? <ErrorAlert error={products.error} /> : null}
          {error ? <ErrorAlert error={error} /> : null}
        </CardContent>
      </Card>

      {items.length === 0 ? <p className="text-sm text-muted-foreground">{t('images.none')}</p> : null}

      <ul className="flex flex-col gap-3">
        {items.map((item, index) => {
          const match = matchOf(index);
          const variant = match.status === 'ready' ? 'success' : match.status === 'replace' ? 'warning' : 'destructive';
          return (
            <li key={item.key} className="flex gap-3 rounded-lg border p-3">
              {item.preview ? (
                <img src={item.preview} alt="" className="size-20 shrink-0 rounded-md object-cover" />
              ) : (
                <div className="flex size-20 shrink-0 items-center justify-center rounded-md border text-xs text-muted-foreground">—</div>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                <span dir="ltr" className="truncate font-mono text-xs">{item.file.name}</span>
                <span dir="ltr" className="font-mono text-xs">{match.sku ?? '—'}</span>
                <Badge variant={item.result === 'uploaded' ? 'success' : item.result === 'failed' ? 'destructive' : variant} className="w-fit">
                  {item.result ? t(`images.result_${item.result}` as 'images.result_uploaded') : t(`images.status_${match.status}` as 'images.status_ready')}
                </Badge>
                {item.blob ? <span className="text-xs text-muted-foreground">{t('images.size', { kb: fmt.number(Math.round(item.blob.size / 1024)) })}</span> : null}
                {item.error ? <span className="text-xs text-destructive">{item.error}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>

      {items.length > 0 ? (
        <Card className="mt-4">
          <CardContent className="flex flex-col gap-3 pt-5 text-sm">
            <p>{t('images.summary', { ready: fmt.number(uploadable.length), skipped: fmt.number(skipped), uploaded: fmt.number(uploaded), failed: fmt.number(failed) })}</p>
            {replaceCount > 0 ? (
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" className="size-4" checked={replaceConfirmed} onChange={(e) => setReplaceConfirmed(e.target.checked)} />
                {t('images.confirm_replace', { count: fmt.number(replaceCount) })}
              </label>
            ) : null}
            {blockedReason ? <p className="text-xs text-muted-foreground">{blockedReason}</p> : null}
            {progress ? <p className="tabular-nums">{fmt.number(progress.done)} / {fmt.number(progress.total)}</p> : null}
            <div>
              <Button onClick={() => void uploadAll()} disabled={uploadable.length === 0 || busy !== null || !writable}>
                <Upload aria-hidden="true" />
                {busy === 'upload' ? t('common.saving') : t('images.run', { count: fmt.number(uploadable.length) })}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
