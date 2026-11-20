'use client';

import { useQuery } from '@tanstack/react-query';
import { useServices } from '@/providers/services-provider';

export function useWarehouses(orgId: string) {
  const { inventory } = useServices();
  return useQuery({ queryKey: ['warehouses', orgId], queryFn: () => inventory.listWarehouses(orgId), staleTime: 60_000 });
}
