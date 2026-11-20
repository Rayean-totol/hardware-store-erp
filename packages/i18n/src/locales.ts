export const LOCALES = ['en', 'ar', 'bn'] as const;
export type Locale = (typeof LOCALES)[number];
export type NumberingSystem = 'latn' | 'arab' | 'beng';

export interface LocaleInfo {
  code: Locale;
  /** Endonym shown in the language switcher. */
  label: string;
  dir: 'ltr' | 'rtl';
  /** BCP 47 tag used for Intl formatting (without the numbering-system extension). */
  intl: string;
  /** Default digits. Saudi businesses commonly prefer Latin digits even in Arabic UI. */
  defaultNumbering: NumberingSystem;
}

export const LOCALE_INFO: Record<Locale, LocaleInfo> = {
  en: { code: 'en', label: 'English', dir: 'ltr', intl: 'en-GB', defaultNumbering: 'latn' },
  ar: { code: 'ar', label: 'العربية', dir: 'rtl', intl: 'ar-SA', defaultNumbering: 'latn' },
  bn: { code: 'bn', label: 'বাংলা', dir: 'ltr', intl: 'bn-BD', defaultNumbering: 'beng' },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Pick the best locale from a list of preferences (e.g. navigator.languages). */
export function negotiateLocale(preferences: readonly string[], fallback: Locale = 'ar'): Locale {
  for (const pref of preferences) {
    const base = pref.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return fallback;
}

/** Choose a translated name, falling back to English (and Arabic for Bangla gaps). */
export function localName(
  names: { nameEn: string; nameAr: string; nameBn?: string | null },
  locale: Locale,
): string {
  if (locale === 'ar') return names.nameAr || names.nameEn;
  if (locale === 'bn') return names.nameBn || names.nameEn;
  return names.nameEn;
}
