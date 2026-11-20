import type { CachedProduct } from '../src/offline/types';

export const ORG = '20000000-0000-4000-8000-000000000001';
export const WH = '30000000-0000-4000-8000-000000000001';
export const WH_JED = '30000000-0000-4000-8000-000000000002';
export const PCS = '10000000-0000-4000-8000-000000000001';
export const BOX = '10000000-0000-4000-8000-000000000003';
export const M = '10000000-0000-4000-8000-000000000004';
export const SCREW = '50000000-0000-4000-8000-000000000001';
export const CABLE = '50000000-0000-4000-8000-000000000002';
export const SERVICE = '50000000-0000-4000-8000-000000000003';

export const products: CachedProduct[] = [
  {
    id: SCREW, sku: 'FST-WS-4X40', nameEn: 'Wood screw', nameAr: 'برغي', nameBn: null, productType: 'stock',
    baseUnitId: PCS, baseUnitAllowsFraction: false, reorderLevel: '2000', archived: false,
    units: [
      { unitId: PCS, factor: '1', barcode: '2000000100012' },
      { unitId: BOX, factor: '200', barcode: '2000000100029' },
    ],
  },
  {
    id: CABLE, sku: 'ELC-CU-2.5', nameEn: 'Copper cable', nameAr: 'كابل', nameBn: null, productType: 'stock',
    baseUnitId: M, baseUnitAllowsFraction: true, reorderLevel: null, archived: false,
    units: [{ unitId: M, factor: '1', barcode: null }],
  },
  {
    id: SERVICE, sku: 'SRV-KEY', nameEn: 'Key cutting', nameAr: 'نسخ مفاتيح', nameBn: null, productType: 'service',
    baseUnitId: PCS, baseUnitAllowsFraction: false, reorderLevel: '2000', archived: false,
    units: [{ unitId: PCS, factor: '1', barcode: null }],
  },
];
