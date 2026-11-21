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
import { hashPhotoFile, hashProductPhotos } from './photo-index';
import { type PhotoMatch, rankPhotoMatches } from './photo-hash';

const CANDIDATE_LIMIT = 300;

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
      const query = await hashPhotoFile(file);
      setTotal(withImages.length);
      setDone(0);
      const byId = new Map(withImages.map((p) => [p.id, p] as const));
      const hashed = await hashProductPhotos(
        withImages.map((p) => ({ id: p.id, imagePath: p.imagePath! })),
        (path) => productImages.signedUrl(path),
        (d, n) => {
          setDone(d);
          setTotal(n);
        },
      );
      setProducts(byId);
      setMatches(rankPhotoMatches(query, hashed, 5));
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
