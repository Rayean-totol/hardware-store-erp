'use client';

import { useQuery } from '@tanstack/react-query';
import { useServices } from '@/providers/services-provider';

export const catalogKeys = {
  units: (orgId: string) => ['units', orgId] as const,
  categories: (orgId: string) => ['categories', orgId] as const,
  brands: (orgId: string) => ['brands', orgId] as const,
  products: (orgId: string) => ['products', orgId] as const,
  product: (id: string) => ['product', id] as const,
};

export function useUnits(orgId: string) {
  const { catalog } = useServices();
  return useQuery({ queryKey: catalogKeys.units(orgId), queryFn: () => catalog.listUnits(orgId), staleTime: 5 * 60_000 });
}

export function useCategories(orgId: string) {
  const { catalog } = useServices();
  return useQuery({ queryKey: catalogKeys.categories(orgId), queryFn: () => catalog.listCategories(orgId) });
}

export function useBrands(orgId: string) {
  const { catalog } = useServices();
  return useQuery({ queryKey: catalogKeys.brands(orgId), queryFn: () => catalog.listBrands(orgId) });
}
