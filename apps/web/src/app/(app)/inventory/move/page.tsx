'use client';

import { Spinner } from '@erp/ui';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { MovementForm } from '@/features/inventory/movement-form';

function Move() {
  const type = useSearchParams().get('type');
  return <MovementForm initialType={type} />;
}

export default function MovePage() {
  return (
    <Suspense fallback={<Spinner label="…" />}>
      <Move />
    </Suspense>
  );
}
