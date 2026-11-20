import { describe, expect, it } from 'vitest';
import {
  CATALOGS,
  createFormatters,
  createTranslator,
  interpolate,
  localName,
  negotiateLocale,
  placeholdersOf,
} from '../src';

describe('message catalogs', () => {
  const keys = Object.keys(CATALOGS.en).sort();

  it.each(['ar', 'bn'] as const)('%s has exactly the same keys as en', (locale) => {
    expect(Object.keys(CATALOGS[locale]).sort()).toEqual(keys);
  });

  it.each(['ar', 'bn'] as const)('%s keeps every placeholder of en', (locale) => {
    for (const key of keys) {
      const k = key as keyof typeof CATALOGS.en;
      expect(placeholdersOf(CATALOGS[locale][k]), `${locale}:${key}`).toEqual(placeholdersOf(CATALOGS.en[k]));
    }
  });

  it.each(['en', 'ar', 'bn'] as const)('%s has no empty messages', (locale) => {
    for (const [key, value] of Object.entries(CATALOGS[locale])) {
      expect(value.trim(), `${locale}:${key}`).not.toBe('');
    }
  });

  it('every domain issue code and DB error code used by the app has a message', async () => {
    // Codes raised by app.fail() in supabase/migrations
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(import.meta.dirname, '../../../supabase/migrations');
    const sql = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    const codes = new Set([...sql.matchAll(/app\.fail\('([a-z_.]+)'/g)].map((m) => m[1]!));
    const t = createTranslator('en');
    for (const code of codes) {
      expect(t.tMaybe(`errors.${code}`), code).not.toBeNull();
    }
  });
});

describe('translator', () => {
  it('interpolates parameters and leaves unknown placeholders', () => {
    expect(interpolate('Hello {name}, {x}', { name: 'Ali' })).toBe('Hello Ali, {x}');
    expect(createTranslator('ar').t('common.page', { page: 2, pages: 5 })).toBe('صفحة 2 من 5');
  });
  it('tMaybe returns null for unknown keys', () => {
    expect(createTranslator('bn').tMaybe('errors.does_not_exist')).toBeNull();
    expect(createTranslator('bn').tMaybe('errors.forbidden')).toBe('এই কাজের অনুমতি আপনার নেই।');
  });
});

describe('locale helpers', () => {
  it('negotiates from browser preferences', () => {
    expect(negotiateLocale(['bn-BD', 'en'])).toBe('bn');
    expect(negotiateLocale(['fr-FR', 'en-US'])).toBe('en');
    expect(negotiateLocale(['fr'])).toBe('ar');
  });
  it('picks localized names with fallback', () => {
    const n = { nameEn: 'Hammer', nameAr: 'مطرقة', nameBn: null };
    expect(localName(n, 'ar')).toBe('مطرقة');
    expect(localName(n, 'bn')).toBe('Hammer');
  });
});

describe('formatters', () => {
  it('formats SAR with 2 decimals and Latin digits in Arabic by default', () => {
    const ar = createFormatters('ar');
    expect(ar.money('1234.5')).toMatch(/1,234\.50|1٬234٫50/);
    expect(ar.money('1234.5')).toContain('1');
  });
  it('uses Bengali digits for Bangla by default, Arabic-Indic digits on request', () => {
    expect(createFormatters('bn').number('1234')).toBe('১,২৩৪');
    expect(createFormatters('ar', 'arab').number('12')).toBe('١٢');
  });
  it('formats decimal strings without float rounding', () => {
    expect(createFormatters('en').number('0.123456789012', 12)).toBe('0.123456789012');
  });
});
