'use client';

import { LOCALE_INFO, LOCALES, type Locale } from '@erp/i18n';
import { NativeSelect } from '@erp/ui';
import { Languages } from 'lucide-react';
import { useI18n } from '@/providers/i18n-provider';

export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <label className={`flex items-center gap-2 text-sm ${className ?? ''}`}>
      <Languages className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{t('nav.language')}</span>
      <NativeSelect
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="h-8 w-auto py-1 text-xs"
        aria-label={t('nav.language')}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_INFO[l].label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
