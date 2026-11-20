import type { DbClient } from '../client';
import { toDataError, unwrap } from '../errors';
import type { CatalogRepository } from '../catalog-repository';
import type { InventoryRepository } from '../inventory-repository';
import type { SyncTransport } from './sync-engine';
import type { CachedProduct } from './types';

/**
 * Connects the sync engine to the real backend: the PostgREST RPCs in InventoryRepository and
 * CatalogRepository. Every call goes through the same RLS-protected API as the online app.
 */
export function createSupabaseSyncTransport(
  db: DbClient,
  inventory: InventoryRepository,
  catalog: CatalogRepository,
): SyncTransport {
  return {
    applyMovements: (orgId, deviceId, batch) => inventory.applyMovements(orgId, deviceId, batch),
    listStockLevels: (warehouseId) => inventory.listStockLevels(warehouseId),
    async loadCatalog(orgId) {
      const units = await catalog.listUnits(orgId);
      const unitById = new Map(units.map((u) => [u.id, u]));
      const products: CachedProduct[] = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const page = await catalog.searchProducts({ orgId, includeArchived: true, limit: pageSize, offset });
        for (const p of page.items) {
          products.push({
            id: p.id,
            sku: p.sku,
            nameEn: p.nameEn,
            nameAr: p.nameAr,
            nameBn: p.nameBn ?? null,
            productType: p.productType,
            baseUnitId: p.baseUnitId,
            baseUnitAllowsFraction: unitById.get(p.baseUnitId)?.allowFraction ?? false,
            reorderLevel: p.reorderLevel ?? null,
            archived: p.archivedAt !== null,
            units: p.units.map((u) => ({ unitId: u.unitId, factor: u.factor, barcode: u.barcode ?? null })),
          });
        }
        if (page.items.length < pageSize) break;
      }
      const org = unwrap(await db.from('organizations').select('allow_negative_stock').eq('id', orgId).single()) as unknown as {
        allow_negative_stock: boolean;
      };
      if (typeof org.allow_negative_stock !== 'boolean') {
        throw toDataError(new Error('organizations.allow_negative_stock missing from response'));
      }
      return { products, allowNegativeStock: org.allow_negative_stock };
    },
  };
}
