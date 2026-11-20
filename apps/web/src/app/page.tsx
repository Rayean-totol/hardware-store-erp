'use client';

import { Spinner } from '@erp/ui';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useI18n } from '@/providers/i18n-provider';

export default function Home() {
  const router = useRouter();
  const { t } = useI18n();
  React.useEffect(() => router.replace('/products/'), [router]);
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <Spinner label={t('common.loading')} />
    </main>
  );
}
