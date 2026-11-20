'use client';

import { Alert, AlertTitle } from '@erp/ui';
import { useI18n } from '@/providers/i18n-provider';
import { LanguageSwitcher } from './language-switcher';

export function ConfigError({ missing }: { missing: string[] }) {
  const { t } = useI18n();
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <Alert variant="destructive">
        <AlertTitle>{t('config.title')}</AlertTitle>
        <p>{t('config.body')}</p>
        <ul className="my-2 list-disc ps-6 font-mono text-xs">
          {missing.map((m) => (
            <li key={m} dir="ltr">{m}</li>
          ))}
        </ul>
        <p>{t('config.hint')}</p>
      </Alert>
      <LanguageSwitcher />
    </main>
  );
}
