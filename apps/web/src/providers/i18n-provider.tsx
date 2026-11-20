'use client';

import {
  createFormatters,
  createTranslator,
  isLocale,
  LOCALE_INFO,
  localName,
  negotiateLocale,
  type Formatters,
  type Locale,
  type Translator,
} from '@erp/i18n';
import { DirectionProvider } from '@erp/ui';
import * as React from 'react';
import { readPref, writePref } from '@/lib/storage';

interface I18nValue extends Translator {
  dir: 'ltr' | 'rtl';
  fmt: Formatters;
  setLocale(locale: Locale): void;
  name(names: { nameEn: string; nameAr: string; nameBn?: string | null }): string;
}

const I18nContext = React.createContext<I18nValue | null>(null);

function initialLocale(): Locale {
  const stored = readPref('erp.locale');
  if (isLocale(stored)) return stored;
  return negotiateLocale(typeof navigator === 'undefined' ? [] : navigator.languages);
}

export function I18nProvider({ children, locale: forced }: { children: React.ReactNode; locale?: Locale }) {
  // The UI is rendered only on the client (see `mounted`), so reading storage here is safe
  // and avoids a hydration mismatch / flash of the wrong language.
  const [mounted, setMounted] = React.useState(false);
  const [locale, setLocaleState] = React.useState<Locale>(forced ?? 'ar');

  React.useEffect(() => {
    if (!forced) setLocaleState(initialLocale());
    setMounted(true);
  }, [forced]);

  const dir = LOCALE_INFO[locale].dir;
  React.useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const value = React.useMemo<I18nValue>(() => {
    const translator = createTranslator(locale);
    return {
      ...translator,
      dir,
      fmt: createFormatters(locale),
      setLocale: (next) => {
        writePref('erp.locale', next);
        setLocaleState(next);
      },
      name: (names) => localName(names, locale),
    };
  }, [locale, dir]);

  if (!mounted) return null;
  return (
    <I18nContext.Provider value={value}>
      <DirectionProvider dir={dir}>{children}</DirectionProvider>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
