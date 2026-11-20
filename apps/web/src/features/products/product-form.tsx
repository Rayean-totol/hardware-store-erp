'use client';

import type { Brand, Category, Product, Unit } from '@erp/data';
import { DataError } from '@erp/data';
import {
  calculateLine,
  generateInStoreEan13,
  suggestFactor,
  tryDec,
  unitCatalog,
  VAT_EXEMPTION_REASONS,
  validateProductDraft,
  type ProductDraft,
  type ProductUnitDef,
  type TaxCategory,
  type ValidationIssue,
} from '@erp/domain';
import type { MessageKey } from '@erp/i18n';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  Input,
  NativeSelect,
  Textarea,
} from '@erp/ui';
import { Barcode, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { ErrorAlert } from '@/components/error-message';
import { useI18n } from '@/providers/i18n-provider';

export interface ProductFormProps {
  orgId: string;
  product: Product | null;
  units: Unit[];
  categories: Category[];
  brands: Brand[];
  pricesIncludeVat: boolean;
  canEditPrices: boolean;
  /** Persists the validated draft. Throws DataError on failure. */
  onSave(draft: ProductDraft, expectedVersion: number | null): Promise<void>;
  onCancel(): void;
  onReload?(): void;
}

function emptyDraft(orgId: string, units: Unit[]): ProductDraft {
  const pcs = units.find((u) => u.code === 'pcs') ?? units[0];
  return {
    orgId,
    sku: '',
    nameEn: '',
    nameAr: '',
    nameBn: '',
    description: '',
    categoryId: '',
    brandId: '',
    productType: 'stock',
    baseUnitId: pcs?.id ?? '',
    taxCategory: 'S',
    taxExemptionReasonCode: '',
    reorderLevel: '',
    units: pcs
      ? [{ unitId: pcs.id, factor: '1', isBase: true, barcode: '', salePrice: '', isSaleUnit: true, isPurchaseUnit: true }]
      : [],
  };
}

function draftFromProduct(p: Product): ProductDraft {
  return {
    id: p.id,
    orgId: p.orgId,
    sku: p.sku,
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    nameBn: p.nameBn ?? '',
    description: p.description ?? '',
    categoryId: p.categoryId ?? '',
    brandId: p.brandId ?? '',
    productType: p.productType,
    baseUnitId: p.baseUnitId,
    taxCategory: p.taxCategory,
    taxExemptionReasonCode: p.taxExemptionReasonCode ?? '',
    reorderLevel: p.reorderLevel ? String(Number(p.reorderLevel)) : '',
    units: p.units.map((u) => ({
      unitId: u.unitId,
      // DB returns numeric(18,6) as "200.000000"; show "200"
      factor: tryDec(u.factor)?.toString() ?? u.factor,
      isBase: u.isBase,
      barcode: u.barcode ?? '',
      salePrice: u.salePrice ? (tryDec(u.salePrice)?.toString() ?? u.salePrice) : '',
      isSaleUnit: u.isSaleUnit,
      isPurchaseUnit: u.isPurchaseUnit,
    })),
  };
}

function randomBarcode(): string {
  // 10-digit random sequence in the GS1 in-store range (prefix 20). The DB unique index
  // rejects the (very unlikely) collision; the user then simply generates again.
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  const seq = ((buf[0]! % 100_000) * 100_000 + (buf[1]! % 100_000)) % 10_000_000_000;
  return generateInStoreEan13(seq, '20');
}

export function ProductForm(props: ProductFormProps) {
  const { orgId, product, units, categories, brands, pricesIncludeVat, canEditPrices } = props;
  const { t, tMaybe, fmt, name } = useI18n();
  const [draft, setDraft] = React.useState<ProductDraft>(() => (product ? draftFromProduct(product) : emptyDraft(orgId, units)));
  const [issues, setIssues] = React.useState<ValidationIssue[]>([]);
  const [submitted, setSubmitted] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<unknown>(null);
  const [warnings, setWarnings] = React.useState<ValidationIssue[]>([]);

  const catalog = React.useMemo(() => unitCatalog(units), [units]);
  const unitById = (id: string) => units.find((u) => u.id === id);
  const baseUnit = unitById(draft.baseUnitId);

  // Live validation once the user has tried to submit.
  React.useEffect(() => {
    if (!submitted) return;
    const result = validateProductDraft(draft, catalog);
    setIssues(result.ok ? result.warnings : result.issues);
  }, [draft, submitted, catalog]);

  const issueText = (code: string) => tMaybe(`issues.${code}`) ?? code;
  const errorFor = (path: string) => {
    const issue = issues.find((i) => i.path === path && i.severity === 'error');
    return issue ? issueText(issue.code) : undefined;
  };
  const warningFor = (path: string) => {
    const issue = issues.find((i) => i.path === path && i.severity === 'warning');
    return issue ? issueText(issue.code) : undefined;
  };
  const formLevelErrors = issues.filter((i) => i.severity === 'error' && (i.path === 'units' || i.path === ''));

  const update = (patch: Partial<ProductDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const updateUnit = (index: number, patch: Partial<ProductUnitDef>) =>
    setDraft((d) => ({ ...d, units: d.units.map((u, i) => (i === index ? { ...u, ...patch } : u)) }));

  function changeBaseUnit(unitId: string) {
    setDraft((d) => {
      const others = d.units.filter((u) => !u.isBase && u.unitId !== unitId);
      const oldBase = d.units.find((u) => u.isBase);
      const newBase: ProductUnitDef = {
        unitId,
        factor: '1',
        isBase: true,
        barcode: oldBase?.barcode ?? '',
        salePrice: oldBase?.salePrice ?? '',
        isSaleUnit: oldBase?.isSaleUnit ?? true,
        isPurchaseUnit: oldBase?.isPurchaseUnit ?? true,
      };
      return { ...d, baseUnitId: unitId, units: [newBase, ...others] };
    });
  }

  function changeRowUnit(index: number, unitId: string) {
    const unit = unitById(unitId);
    const suggestion = unit && baseUnit ? suggestFactor(unit, baseUnit) : null;
    updateUnit(index, { unitId, ...(suggestion ? { factor: suggestion } : {}) });
  }

  function addUnit() {
    const used = new Set(draft.units.map((u) => u.unitId));
    const next = units.find((u) => !used.has(u.id) && u.dimension === baseUnit?.dimension) ?? units.find((u) => !used.has(u.id));
    if (!next) return;
    const suggestion = baseUnit ? suggestFactor(next, baseUnit) : null;
    setDraft((d) => ({
      ...d,
      units: [
        ...d.units,
        { unitId: next.id, factor: suggestion ?? '', isBase: false, barcode: '', salePrice: '', isSaleUnit: true, isPurchaseUnit: true },
      ],
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setSaveError(null);
    const result = validateProductDraft(draft, catalog);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    setIssues(result.warnings);
    setSaving(true);
    try {
      await props.onSave(result.value, product ? product.rowVersion : null);
      setWarnings(result.warnings);
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  }

  const conflict = saveError instanceof DataError && saveError.code === 'concurrency_conflict';
  const exemptionCodes = draft.taxCategory === 'S' ? [] : VAT_EXEMPTION_REASONS[draft.taxCategory];

  const vatPreview = (price: string | null | undefined) => {
    const value = tryDec(price ?? '');
    if (!value || value.isNegative()) return null;
    const line = calculateLine({ unitPrice: value, quantity: 1, taxCategory: draft.taxCategory, pricesIncludeVat });
    return t('product.vat_preview', {
      net: fmt.money(line.net.toFixed(2)),
      vat: fmt.money(line.vat.toFixed(2)),
      gross: fmt.money(line.gross.toFixed(2)),
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6" aria-label={product ? t('product.edit_title') : t('product.new_title')}>
      {submitted && issues.some((i) => i.severity === 'error') ? (
        <Alert variant="destructive">
          <p>{t('issues.form_has_errors')}</p>
          {formLevelErrors.length > 0 ? (
            <ul className="mt-1 list-disc ps-5">
              {formLevelErrors.map((i) => <li key={i.code}>{issueText(i.code)}</li>)}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      {conflict ? (
        <Alert variant="warning" className="flex flex-wrap items-center justify-between gap-2">
          <p>{t('product.conflict')}</p>
          {props.onReload ? <Button size="sm" variant="outline" onClick={props.onReload}>{t('common.reload')}</Button> : null}
        </Alert>
      ) : saveError ? (
        <ErrorAlert error={saveError} />
      ) : null}
      {warnings.length > 0 ? (
        <Alert variant="warning">
          <p>{t('product.warnings')}</p>
          <ul className="mt-1 list-disc ps-5">{warnings.map((w) => <li key={w.path + w.code}>{issueText(w.code)}</li>)}</ul>
        </Alert>
      ) : null}

      <Card>
        <CardHeader><CardTitle>{t('product.section_general')}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label={t('product.sku')} required error={errorFor('sku')}>
            {(p) => (
              <Input {...p} dir="ltr" className="font-mono uppercase" value={draft.sku} maxLength={40}
                onChange={(e) => update({ sku: e.target.value })} />
            )}
          </Field>
          <Field label={t('product.type')}>
            {(p) => (
              <NativeSelect {...p} value={draft.productType} onChange={(e) => update({ productType: e.target.value as ProductDraft['productType'] })}>
                <option value="stock">{t('product.type_stock')}</option>
                <option value="service">{t('product.type_service')}</option>
              </NativeSelect>
            )}
          </Field>
          <Field label={t('product.name_en')} required error={errorFor('nameEn')}>
            {(p) => <Input {...p} dir="ltr" lang="en" value={draft.nameEn} maxLength={200} onChange={(e) => update({ nameEn: e.target.value })} />}
          </Field>
          <Field label={t('product.name_ar')} required hint={t('product.name_ar_hint')} error={errorFor('nameAr')} warning={warningFor('nameAr')}>
            {(p) => <Input {...p} dir="rtl" lang="ar" value={draft.nameAr} maxLength={200} onChange={(e) => update({ nameAr: e.target.value })} />}
          </Field>
          <Field label={t('product.name_bn')} optionalLabel={t('common.optional')} error={errorFor('nameBn')}>
            {(p) => <Input {...p} lang="bn" value={draft.nameBn ?? ''} maxLength={200} onChange={(e) => update({ nameBn: e.target.value })} />}
          </Field>
          <Field label={t('product.category')} optionalLabel={t('common.optional')}>
            {(p) => (
              <NativeSelect {...p} value={draft.categoryId ?? ''} onChange={(e) => update({ categoryId: e.target.value })}>
                <option value="">{t('common.none')}</option>
                {categories.filter((c) => c.isActive || c.id === draft.categoryId).map((c) => (
                  <option key={c.id} value={c.id}>{c.parentId ? '— ' : ''}{name(c)}</option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('product.brand')} optionalLabel={t('common.optional')}>
            {(p) => (
              <NativeSelect {...p} value={draft.brandId ?? ''} onChange={(e) => update({ brandId: e.target.value })}>
                <option value="">{t('common.none')}</option>
                {brands.filter((b) => b.isActive || b.id === draft.brandId).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('product.reorder_level')} optionalLabel={t('common.optional')} error={errorFor('reorderLevel')}>
            {(p) => <Input {...p} dir="ltr" inputMode="decimal" value={draft.reorderLevel ?? ''} onChange={(e) => update({ reorderLevel: e.target.value })} />}
          </Field>
          <Field label={t('product.description')} optionalLabel={t('common.optional')} className="md:col-span-2" error={errorFor('description')}>
            {(p) => <Textarea {...p} value={draft.description ?? ''} maxLength={2000} onChange={(e) => update({ description: e.target.value })} />}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('product.section_tax')}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label={t('product.tax_category')}>
            {(p) => (
              <NativeSelect {...p} value={draft.taxCategory}
                onChange={(e) => update({ taxCategory: e.target.value as TaxCategory, taxExemptionReasonCode: '' })}>
                {(['S', 'Z', 'E', 'O'] as const).map((c) => (
                  <option key={c} value={c}>{t(`product.tax_${c}` as MessageKey)}</option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {draft.taxCategory !== 'S' ? (
            <Field label={t('product.exemption_reason')} required error={errorFor('taxExemptionReasonCode')}>
              {(p) => (
                <NativeSelect {...p} dir="ltr" value={draft.taxExemptionReasonCode ?? ''}
                  onChange={(e) => update({ taxExemptionReasonCode: e.target.value })}>
                  <option value="">{t('common.none')}</option>
                  {exemptionCodes.map((code) => <option key={code} value={code}>{code}</option>)}
                </NativeSelect>
              )}
            </Field>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('product.section_units')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('product.units_help')}</p>
          <p className="text-xs text-muted-foreground">
            {pricesIncludeVat ? t('product.prices_incl_vat') : t('product.prices_excl_vat')}
            {!canEditPrices ? ` · ${t('product.price_readonly')}` : ''}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label={t('product.base_unit')} hint={t('product.base_unit_hint')} className="max-w-xs">
            {(p) => (
              <NativeSelect {...p} value={draft.baseUnitId} onChange={(e) => changeBaseUnit(e.target.value)}>
                {units.map((u) => <option key={u.id} value={u.id}>{name(u)} ({u.code})</option>)}
              </NativeSelect>
            )}
          </Field>

          <ol className="flex flex-col gap-3" aria-label={t('product.section_units')}>
            {draft.units.map((row, index) => {
              const rowUnit = unitById(row.unitId);
              const factorDec = tryDec(row.factor);
              const takenElsewhere = new Set(draft.units.filter((_, i) => i !== index).map((u) => u.unitId));
              const preview = vatPreview(row.salePrice);
              return (
                <li key={index} className="rounded-lg border p-3" data-testid={`unit-row-${index}`}>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1.6fr_1fr_auto]">
                    <Field label={t('product.unit')} error={errorFor(`units.${index}.unitId`)}>
                      {(p) => (
                        <div className="flex items-center gap-2">
                          <NativeSelect {...p} value={row.unitId} disabled={row.isBase} onChange={(e) => changeRowUnit(index, e.target.value)}>
                            {units.filter((u) => !takenElsewhere.has(u.id)).map((u) => (
                              <option key={u.id} value={u.id}>{name(u)} ({u.code})</option>
                            ))}
                          </NativeSelect>
                          {row.isBase ? <Badge>{t('product.base_badge')}</Badge> : null}
                        </div>
                      )}
                    </Field>
                    <Field label={t('product.factor')} error={errorFor(`units.${index}.factor`)}>
                      {(p) => (
                        <Input {...p} dir="ltr" inputMode="decimal" value={row.factor} disabled={row.isBase}
                          onChange={(e) => updateUnit(index, { factor: e.target.value })} />
                      )}
                    </Field>
                    <Field label={t('product.barcode')} optionalLabel={t('common.optional')} error={errorFor(`units.${index}.barcode`)}>
                      {(p) => (
                        <div className="flex gap-1">
                          <Input {...p} dir="ltr" className="font-mono" value={row.barcode ?? ''} maxLength={48}
                            onChange={(e) => updateUnit(index, { barcode: e.target.value.trim() })} />
                          <Button variant="outline" size="icon" aria-label={t('product.generate_barcode')} title={t('product.generate_barcode')}
                            onClick={() => updateUnit(index, { barcode: randomBarcode() })}>
                            <Barcode aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                    </Field>
                    <Field label={t('product.sale_price')} optionalLabel={t('common.optional')}
                      error={errorFor(`units.${index}.salePrice`)} warning={warningFor(`units.${index}.salePrice`)}
                      hint={preview ?? undefined}>
                      {(p) => (
                        <Input {...p} dir="ltr" inputMode="decimal" value={row.salePrice ?? ''} disabled={!canEditPrices}
                          onChange={(e) => updateUnit(index, { salePrice: e.target.value })} />
                      )}
                    </Field>
                    <div className="flex items-end gap-3 pb-2">
                      <label className="flex items-center gap-1.5 text-sm">
                        <Checkbox checked={row.isSaleUnit} onChange={(e) => updateUnit(index, { isSaleUnit: e.target.checked })} />
                        {t('product.sale_unit')}
                      </label>
                      <label className="flex items-center gap-1.5 text-sm">
                        <Checkbox checked={row.isPurchaseUnit} onChange={(e) => updateUnit(index, { isPurchaseUnit: e.target.checked })} />
                        {t('product.purchase_unit')}
                      </label>
                      {!row.isBase ? (
                        <Button variant="ghost" size="icon" aria-label={`${t('common.remove')} ${rowUnit ? name(rowUnit) : ''}`}
                          onClick={() => setDraft((d) => ({ ...d, units: d.units.filter((_, i) => i !== index) }))}>
                          <Trash2 aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {!row.isBase && rowUnit && baseUnit && factorDec && factorDec.gt(0) ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t('product.factor_equals', { unit: name(rowUnit), factor: fmt.number(factorDec.toString()), base: name(baseUnit) })}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <div>
            <Button variant="outline" onClick={addUnit} disabled={draft.units.length >= units.length}>
              <Plus aria-hidden="true" />
              {t('product.add_unit')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</Button>
        <Button variant="outline" onClick={props.onCancel}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}
