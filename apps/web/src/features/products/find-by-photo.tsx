'use client';

import type { Product } from '@erp/data';
import { Alert, Button, Card, CardContent, Spinner } from '@erp/ui';
import { useQuery } from '@tanstack/react-query';
import { Camera, Search } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { PageHeader } from '@/components/page-header';
import { useI18n } from '@/providers/i18n-provider';
import { useMembership } from '@/providers/session-provider';
import { useServices } from '@/providers/services-provider';
import { type HashedProduct, dHashFromGrey, greyFromImage, rankPhotoMatches, type PhotoMatch } from './photo-hash';

/** Hashes already computed in this browser session, keyed by storage path. Never stored or sent anywhere. */
const hashCache = new Map<string, string>();
const CANDIDATE_LIMIT = 300;
const WORKERS = 4;

async function hashStoredImage(url: string): Promise<string> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  return dHashFromGrey(greyFromImage(img));
}

export function FindByPhoto() {
  const { t, name } = useI18n();
  const { orgId } = useMembership();
  const { catalog, productImages } = useServices();

  const [matches, setMatches] = React.useState<PhotoMatch[] | null>(null);
  const [products, setProducts] = React.useState<Map<string, Product>>(new Map());
  const [done, setDone] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const candidates = useQuery({
    queryKey: ['find-photo-candidates', orgId],
    queryFn: () =>
      catalog.searchProducts({
        orgId,
        search: '',
        categoryId: null,
        brandId: null,
        includeArchived: false,
        limit: CANDIDATE_LIMIT,
        offset: 0,
      }),
    staleTime: 5 * 60 * 1000,
  });

  const withImages = React.useMemo(
    () => (candidates.data?.items ?? []).filter((p) => Boolean(p.imagePath)),
    [candidates.data],
  );

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setFailed(false);
    setMatches(null);
    try {
      const bitmap = await createImageBitmap(file);
      const q = dHashFromGrey(greyFromImage(bitmap));
      bitmap.close();

      setTotal(withImages.length);
      setDone(0);
      const hashed: HashedProduct[] = [];
      const byId = new Map<string, Product>();
      let next = 0;
      const worker = async () => {
        while (next < withImages.length) {
          const product = withImages[next++]!;
          byId.set(product.id, product);
          try {
            let hash = hashCache.get(product.imagePath!);
            if (!hash) {
              const url = await productImages.signedUrl(product.imagePath!);
              hash = await hashStoredImage(url);
              hashCache.set(product.imagePath!, hash);
            }
            hashed.push({ id: product.id, hash });
          } catch {
            // One unreadable product photo is skipped; the rest still count.
          }
          setDone((d) => d + 1);
        }
      };
      await Promise.all(Array.from({ length: Math.min(WORKERS, withImages.length) }, () => worker()));
      setProducts(byId);
      setMatches(rankPhotoMatches(q, hashed, 5));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t('find_photo.title')} />
      <p className="mb-5 text-sm text-muted-foreground">{t('find_photo.hint')}</p>

      {candidates.isError ? <Alert variant="destructive">{t('errors.network')}</Alert> : null}
      {failed ? <Alert variant="destructive">{t('find_photo.failed')}</Alert> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild disabled={busy || withImages.length === 0}>
          <label className="cursor-pointer">
            <Camera aria-hidden="true" />
            {t('find_photo.pick')}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                void onPick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </Button>
        {candidates.isPending ? <Spinner label={t('common.loading')} /> : null}
        {!candidates.isPending && withImages.length === 0 ? (
          <span className="text-sm text-muted-foreground">{t('find_photo.no_images')}</span>
        ) : null}
      </div>

      {busy ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          {t('find_photo.indexing')} {done}/{total}
        </p>
      ) : null}

      {matches !== null && !busy ? (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">{t('find_photo.closest')}</h2>
          {matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('find_photo.none')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {matches.map((m) => {
                const p = products.get(m.id);
                if (!p) return null;
                return (
                  <Card key={m.id} className="border-border bg-card/80">
                    <CardContent className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{name(p)}</p>
                        <p dir="ltr" className="font-mono text-xs text-muted-foreground">{p.sku}</p>
                      </div>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/products/edit/?id=${p.id}`}>
                          <Search aria-hidden="true" />
                          {t('common.edit')}
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
