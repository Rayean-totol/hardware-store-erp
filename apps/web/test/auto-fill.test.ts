import { describe, expect, it } from 'vitest';
import {
  categoryIdFromText,
  englishNameFromLines,
  labelLines,
  suggestFromLabel,
  translateName,
  unitCodeFromText,
  type OrgCategory,
  type OrgUnit,
} from '@/features/products/auto-fill';

const categories: OrgCategory[] = [
  { id: 'c-fast', nameEn: 'Fasteners', nameAr: 'مثبتات', nameBn: 'ফাস্টেনার' },
  { id: 'c-plumb', nameEn: 'Plumbing', nameAr: 'سباكة', nameBn: 'প্লাম্বিং' },
  { id: 'c-elec', nameEn: 'Electrical', nameAr: 'كهرباء', nameBn: 'বৈদ্যুতিক' },
  { id: 'c-paint', nameEn: 'Paint', nameAr: 'دهانات', nameBn: 'রং' },
];
const units: OrgUnit[] = [
  { id: 'u-pcs', code: 'pcs' },
  { id: 'u-box', code: 'box' },
  { id: 'u-kg', code: 'kg' },
];

describe('label lines', () => {
  it('keeps only lines with real letters, trimmed', () => {
    expect(labelLines('  PVC PIPE 1/2 INCH \n\n 12 \n ab\nBox of 50 pcs')).toEqual(['PVC PIPE 1/2 INCH', 'Box of 50 pcs']);
  });
});

describe('English name', () => {
  it('picks the product line over a unit-only line', () => {
    expect(englishNameFromLines(['Box of 50 pcs', 'PVC PIPE 1/2 INCH'])).toBe('PVC PIPE 1/2 INCH');
  });

  it('returns null when nothing usable is printed', () => {
    expect(englishNameFromLines(['123 456', 'مرحبا'])).toBeNull();
  });
});

describe('translation', () => {
  it('translates when every word is in the glossary, keeping sizes', () => {
    expect(translateName('PVC PIPE 1/2 INCH')).toEqual({ ar: 'PVC أنبوب 1/2 بوصة', bn: 'PVC পাইপ 1/2 ইঞ্চি' });
  });

  it('refuses to translate when any word is unknown', () => {
    expect(translateName('Turbo Pipe')).toBeNull();
  });
});

describe('unit', () => {
  it('finds one unambiguous unit that the organisation has', () => {
    expect(unitCodeFromText('50 pcs', units)).toBe('pcs');
    expect(unitCodeFromText('net 10 kg', units)).toBe('kg');
  });

  it('returns null when two units are named or the organisation lacks the unit', () => {
    expect(unitCodeFromText('box 5 pcs', units)).toBeNull();
    expect(unitCodeFromText('roll of tape', units)).toBeNull();
  });
});

describe('category', () => {
  it('suggests the matching category when the group is clear', () => {
    expect(categoryIdFromText('PVC PIPE 1/2 INCH', categories)).toBe('c-plumb');
    expect(categoryIdFromText('أنبوب PVC', categories)).toBe('c-plumb');
  });

  it('stays empty when the text fits two groups', () => {
    expect(categoryIdFromText('pipe and screw', categories)).toBeNull();
  });

  it('stays empty when no organisation category matches the group', () => {
    expect(categoryIdFromText('hammer', categories)).toBeNull();
  });
});

describe('suggestFromLabel', () => {
  it('fills what is reliable from an English label and marks translations for review', () => {
    const s = suggestFromLabel('PVC PIPE 1/2 INCH\n50 pcs', categories, units);
    expect(s).toEqual({
      nameEn: 'PVC PIPE 1/2 INCH',
      nameAr: 'PVC أنبوب 1/2 بوصة',
      nameBn: 'PVC পাইপ 1/2 ইঞ্চি',
      categoryId: 'c-plumb',
      unitId: 'u-pcs',
      translated: true,
    });
  });

  it('uses printed Arabic and Bangla lines instead of translating', () => {
    const s = suggestFromLabel('Elbow\nكوع\nবাঁকা', categories, units);
    expect(s.nameAr).toBe('كوع');
    expect(s.nameBn).toBe('বাঁকা');
    expect(s.translated).toBe(false);
  });

  it('leaves every field empty when the label is unreadable', () => {
    const s = suggestFromLabel('', categories, units);
    expect(s).toEqual({ nameEn: null, nameAr: null, nameBn: null, categoryId: null, unitId: null, translated: false });
  });
});
