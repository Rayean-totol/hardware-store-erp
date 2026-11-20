'use client';

import { useQuery } from '@tanstack/react-query';
import { useServices } from '@/providers/services-provider';

export const dashboardKeys = {
  inventory: (orgId: string, branchId: string | null) => ['dashboard', 'inventory', orgId, branchId] as const,
  lowStock: (orgId: string, branchId: string | null) => ['dashboard', 'low-stock', orgId, branchId] as const,
};

/** Real figures from the database. Nothing here is sample data. */
export function useInventorySummary(orgId: string, branchId: string | null) {
  const { inventory } = useServices();
  return useQuery({
    queryKey: dashboardKeys.inventory(orgId, branchId),
    queryFn: () => inventory.getInventorySummary(orgId, branchId),
  });
}

export function useLowStockList(orgId: string, branchId: string | null) {
  const { inventory } = useServices();
  return useQuery({
    queryKey: dashboardKeys.lowStock(orgId, branchId),
    queryFn: () => inventory.listLowStock(orgId, branchId),
  });
}
