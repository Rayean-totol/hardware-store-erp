import { describe, expect, it } from 'vitest';
import { planProductImport, productsToCsv, toCsv, unitCatalog, type ProductCsvLookups, type UnitDef } from '../src';
import { ORG, U } from './fixtures';

const units: Array<UnitDef & { id: string }> = Object.entries(U).map(([code, u]) => ({ ...u, code }));
const codeOf = (id: string) => units.find((u) => u.id === id)?.code;

const lookups: ProductCsvLookups = {
  unitsByCode: new Map(units.map((u) => [u.code, u])),
  categoryIdByName: new Map([['fasteners', '30000000-0000-4000-8000-000000000001']]),
  brandIdByName: new Map([['najd fasteners', '40000000-0000-4000-8000-000000000001']]),
  existingBySku: new Map([['WS-4X40', { id: '50000000-0000-4000-8000-000000000001', rowVersion: 7 }]]),
};

const HEADER = 'sku,name_en,name_ar,name_bn,description,category,brand,product_type,base_unit,tax_category,tax_exemption_reason,reorder_level,unit,factor,barcode,sale_price,is_sale,is_purchase';

describe('planProductImport', () => {
  it('groups unit rows by SKU, plans create and update, and maps line numbers', () => {
    const csv = [
      HEADER,
      'ws-4x40,Wood screw,برغي خشب,,,Fasteners,Najd Fasteners,stock,pcs,S,,500,pcs,1,2000000100012,0.15,yes,yes',
      'ws-4x40,Wood screw,برغي خشب,,,Fasteners,Najd Fasteners,stock,pcs,S,,500,box,200,2000000100029,25,yes,yes',
      'nut-m6,Nut M6,صامولة,,,,,stock,pcs,S,,,pcs,1,,0.10,yes,yes',
    ].join('\n');
    const plan = planProductImport(csv, ORG, lookups);
    expect(plan.fatal).toEqual([]);
    expect(plan.counts).toEqual({ create: 1, update: 1, invalid: 0 });
    const update = plan.products.find((p) => p.sku === 'WS-4X40')!;
    expect(update.action).toBe('update');
    expect(update.draft?.id).toBe('50000000-0000-4000-8000-000000000001');
    expect(update.draft?.units.map((u) => u.factor)).toEqual(['1', '200']);
    expect(update.draft?.units.find((u) => u.isBase)?.unitId).toBe(U.pcs.id);
    expect(update.draft?.categoryId).toBe('30000000-0000-4000-8000-000000000001');
  });

  it('reports row-level problems against the right CSV line', () => {
    const csv = [
      HEADER,
      'BAD1,Bad,بد,,,,,stock,pcs,S,,,pcs,1,2000000100013,1,yes,yes',   // wrong check digit
      'BAD1,Bad,بد,,,,,stock,pcs,S,,,box,12.5,,,yes,yes',              // fraction on indivisible base
      'BAD2,Bad2,بد,,,,,stock,pcs,S,,,nonsense,1,,,yes,yes',           // unknown unit
      'BAD3,Bad3,بد,,,Unknown cat,,stock,pcs,S,,,pcs,1,,,yes,yes',     // unknown category
      'BAD4,,,,,,,stock,pcs,S,,,pcs,1,,,yes,yes',                      // missing names
    ].join('\n');
    const plan = planProductImport(csv, ORG, lookups);
    expect(plan.counts.invalid).toBe(4);
    const bad1 = plan.products.find((p) => p.sku === 'BAD1')!;
    expect(bad1.issues).toContainEqual({ line: 2, path: 'barcode', code: 'barcode_check_digit' });
    expect(bad1.issues).toContainEqual({ line: 3, path: 'factor', code: 'units.factor_whole' });
    expect(plan.products.find((p) => p.sku === 'BAD2')!.issues).toContainEqual({ line: 4, path: 'unit', code: 'import.unknown_unit' });
    expect(plan.products.find((p) => p.sku === 'BAD3')!.issues).toContainEqual({ line: 5, path: 'category', code: 'import.unknown_category' });
    expect(plan.products.find((p) => p.sku === 'BAD4')!.issues).toContainEqual({ line: 6, path: 'name_en', code: 'required' });
  });

  it('detects missing columns and rows without a SKU as fatal or row errors', () => {
    expect(planProductImport('sku,name_en\nA,B', ORG, lookups).fatal).toEqual([
      { line: 1, path: 'name_ar', code: 'csv.missing_column' },
      { line: 1, path: 'base_unit', code: 'csv.missing_column' },
      { line: 1, path: 'unit', code: 'csv.missing_column' },
      { line: 1, path: 'factor', code: 'csv.missing_column' },
    ]);
    const plan = planProductImport(`${HEADER}\n,No sku,ناقص,,,,,stock,pcs,S,,,pcs,1,,,yes,yes`, ORG, lookups);
    expect(plan.fatal).toEqual([{ line: 2, path: 'sku', code: 'required' }]);
    expect(planProductImport(HEADER, ORG, lookups).fatal[0]?.code).toBe('csv.empty');
  });

  it('round-trips export → import without changes', () => {
    const exported = productsToCsv(
      [{
        sku: 'PNT-TAPE-48', nameEn: 'Masking tape, 48 mm', nameAr: 'شريط تغطية', nameBn: null, description: 'Blue "premium"',
        categoryId: '30000000-0000-4000-8000-000000000001', brandId: null, productType: 'stock', baseUnitId: U.roll.id,
        taxCategory: 'S', taxExemptionReasonCode: null, reorderLevel: '20',
        units: [
          { unitId: U.roll.id, factor: '1', barcode: '2000000100166', salePrice: '6.5', isSaleUnit: true, isPurchaseUnit: true },
          { unitId: U.box.id, factor: '48', barcode: null, salePrice: '285', isSaleUnit: true, isPurchaseUnit: false },
        ],
      }],
      { unitCode: codeOf, categoryName: () => 'Fasteners', brandName: () => undefined },
    );
    expect(exported.split('\r\n')[0]).toContain('sku,name_en');
    const plan = planProductImport(exported, ORG, { ...lookups, existingBySku: new Map() });
    expect(plan.fatal).toEqual([]);
    const p = plan.products[0]!;
    expect(p.action).toBe('create');
    expect(p.draft!.nameEn).toBe('Masking tape, 48 mm');
    expect(p.draft!.description).toBe('Blue "premium"');
    expect(p.draft!.units.find((u) => u.unitId === U.box.id)).toMatchObject({ factor: '48', isPurchaseUnit: false });
    expect(p.draft!.reorderLevel).toBe('20');
  });

  it('neutralises formula injection in names on export and restores them on import', () => {
    const exported = productsToCsv(
      [{
        sku: 'EVIL-1', nameEn: '=HYPERLINK("http://x")', nameAr: 'ص', nameBn: null, description: null, categoryId: null,
        brandId: null, productType: 'stock', baseUnitId: U.pcs.id, taxCategory: 'S', taxExemptionReasonCode: null,
        reorderLevel: null, units: [{ unitId: U.pcs.id, factor: '1', barcode: null, salePrice: null, isSaleUnit: true, isPurchaseUnit: true }],
      }],
      { unitCode: codeOf, categoryName: () => undefined, brandName: () => undefined },
    );
    expect(exported).toContain("'=HYPERLINK");
    const plan = planProductImport(exported, ORG, lookups);
    expect(plan.products[0]!.draft!.nameEn).toBe('=HYPERLINK("http://x")');
  });

  it('unitCatalog helper keeps unit ids addressable', () => {
    expect(unitCatalog(units).get(U.pcs.id)?.code).toBe('pcs');
    void toCsv;
  });
});
