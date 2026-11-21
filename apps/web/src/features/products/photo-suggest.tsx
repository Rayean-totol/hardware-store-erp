'use client';

import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, NativeSelect, Spinner } from '@erp/ui';
import { Camera, Check } from 'lucide-react';
import * as React from 'react';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { useI18n } from '@/providers/i18n-provider';
import { useServices } from '@/providers/services-provider';
import { type OrgCategory, type OrgUnit, suggestFromLabel } from './auto-fill';
import { type PhotoMatch, rankPhotoMatches } from './photo-hash';
import { hashPhotoFile, hashProductPhotos } from './photo-index';
import { readLabel } from './ocr';

export interface PhotoSuggestion {
  nameEn?: string;
  nameAr?: string;
  nameBn?: string;
  categoryId?: string;
  unitId?: string;
  barcode?: string;
}

interface Props {
  orgId: string;
  categories: OrgCategory[];
  units: OrgUnit[];
  onApply: (s: PhotoSuggestion) => void;
}

type Status = 'idle' | 'reading' | 'ready' | 'error';

/**
 * "Take a photo" for a new product. Reads the label on this device and proposes names, category and
 * unit, and warns when the photo looks like an existing product. Nothing is applied until the user
 * presses Apply, and nothing is saved from here: the normal form still validates and saves.
 */
export function PhotoSuggest({ orgId, categories, units, onApply }: Props) {
  const { t } = useI18n();
  const { catalog, productImages } = useServices();
  const [status, setStatus] = React.useState<Status>('idle');
  const [progress, setProgress] = React.useState(0);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [rawText, setRawText] = React.useState('');
  const [fields, setFields] = React.useState<PhotoSuggestion>({});
  const [translated, setTranslated] = React.useState(false);
  const [similar, setSimilar] = React.useState<PhotoMatch[]>([]);
  const [similarNames, setSimilarNames] = React.useState<Map<string, { name: string; sku: string }>>(new Map());

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setStatus('reading');
    setProgress(0);
    setSimilar([]);
    setPreview(URL.createObjectURL(file));
    try {
      const ocr = await readLabel(file, setProgress);
      const s = suggestFromLabel(ocr.text, categories, units);
      setRawText(ocr.text.trim());
      setTranslated(s.translated);
      setFields({
        nameEn: s.nameEn ?? '',
        nameAr: s.nameAr ?? '',
        nameBn: s.nameBn ?? '',
        categoryId: s.categoryId ?? '',
        unitId: s.unitId ?? '',
      });
      setStatus('ready');

      const page = await catalog.searchProducts({
        orgId, search: '', categoryId: null, brandId: null, includeArchived: false, limit: 300, offset: 0,
      });
      const list = page.items.filter((p) => Boolean(p.imagePath));
      if (list.length > 0) {
        const query = await hashPhotoFile(file);
        const hashed = await hashProductPhotos(
          list.map((p) => ({ id: p.id, imagePath: p.imagePath! })),
          (path) => productImages.signedUrl(path),
        );
        setSimilar(rankPhotoMatches(query, hashed, 3));
        setSimilarNames(new Map(list.map((p) => [p.id, { name: p.nameEn, sku: p.sku }] as const)));
      }
    } catch {
      setStatus('error');
    }
  };

  const apply = () => {
    const out: PhotoSuggestion = {};
    if (fields.nameEn) out.nameEn = fields.nameEn;
    if (fields.nameAr) out.nameAr = fields.nameAr;
    if (fields.nameBn) out.nameBn = fields.nameBn;
    if (fields.categoryId) out.categoryId = fields.categoryId;
    if (fields.unitId) out.unitId = fields.unitId;
    if (fields.barcode) out.barcode = fields.barcode;
    onApply(out);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Camera aria-hidden="true" className="size-4" />{t('photo_suggest.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t('photo_suggest.hint')}</p>

        <div className="flex flex-wrap items-center gap-3">
          <Button asChild disabled={status === 'reading'}>
            <label className="cursor-pointer">
              <Camera aria-hidden="true" />
              {t('photo_suggest.pick')}
              <input type="file" accept="image/*" capture="environment" className="sr-only"
                onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </Button>
          <BarcodeScanner onScan={(code) => setFields((f) => ({ ...f, barcode: code }))} />
          {fields.barcode ? <span dir="ltr" className="font-mono text-xs">{fields.barcode}</span> : null}
        </div>

        {status === 'reading' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Spinner label={t('photo_suggest.reading')} />{t('photo_suggest.reading')} {Math.round(progress * 100)}%
          </p>
        ) : null}
        {status === 'error' ? <Alert variant="destructive">{t('photo_suggest.failed')}</Alert> : null}

        {status === 'ready' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[120px_1fr]">
            {preview ? <img src={preview} alt="" className="h-28 w-28 rounded-lg object-cover" /> : null}
            <div className="flex flex-col gap-3">
              {similar.length > 0 ? (
                <Alert variant="warning">
                  {t('photo_suggest.similar')}: {similar.map((m) => `${similarNames.get(m.id)?.name ?? ''} (${similarNames.get(m.id)?.sku ?? ''})`).join(', ')}
                </Alert>
              ) : null}
              {translated ? <p className="text-xs text-muted-foreground">{t('photo_suggest.translated_note')}</p> : null}
              <label className="flex flex-col gap-1 text-sm">{t('product.name_en')}
                <Input dir="ltr" lang="en" value={fields.nameEn ?? ''} onChange={(e) => setFields({ ...fields, nameEn: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-sm">{t('product.name_ar')}
                <Input dir="rtl" lang="ar" value={fields.nameAr ?? ''} onChange={(e) => setFields({ ...fields, nameAr: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-sm">{t('product.name_bn')}
                <Input lang="bn" value={fields.nameBn ?? ''} onChange={(e) => setFields({ ...fields, nameBn: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-sm">{t('product.category')}
                <NativeSelect value={fields.categoryId ?? ''} onChange={(e) => setFields({ ...fields, categoryId: e.target.value })}>
                  <option value="">{t('photo_suggest.none_suggested')}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
                </NativeSelect>
              </label>
              <label className="flex flex-col gap-1 text-sm">{t('product.base_unit')}
                <NativeSelect value={fields.unitId ?? ''} onChange={(e) => setFields({ ...fields, unitId: e.target.value })}>
                  <option value="">{t('photo_suggest.none_suggested')}</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                </NativeSelect>
              </label>
              {rawText ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">{t('photo_suggest.read_text')}</summary>
                  <pre className="mt-2 whitespace-pre-wrap" dir="auto">{rawText}</pre>
                </details>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={apply}><Check aria-hidden="true" />{t('photo_suggest.apply')}</Button>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
