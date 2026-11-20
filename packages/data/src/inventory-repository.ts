import type { DbClient } from './client';
import { toDataError, unwrap, DataError } from './errors';
import type { ApplyResult, LowStockItem, Movement, MovementPayload, MovementQuery, PriceTierRow, StockLevel, Warehouse } from './inventory-models';
import type { PriceLevel } from '@erp/domain';

const WAREHOUSE_SELECT = 'id, branch_id, code, name_en, name_ar, name_bn, is_active, row_version';

interface RawWarehouse { id: string; branch_id: string; code: string; name_en: string; name_ar: string; name_bn: string | null; is_active: boolean; row_version: number }
interface RawLevel { product_id: string; sku: string; name_en: string; name_ar: string; name_bn: string | null; base_unit_id: string; quantity: string; average_cost: string; reorder_level: string | null; last_movement_at: string | null; is_low: boolean }
interface RawLow { warehouse_id: string; branch_id: string; product_id: string; sku: string; name_en: string; name_ar: string; quantity: string; reorder_level: string; shortage: string }
interface RawMovement {
  id: string; client_id: string; warehouse_id: string; product_id: string; movement_type: Movement['movementType']; unit_id: string;
  entered_quantity: string; factor: string; quantity_change: string; unit_cost: string | null; base_unit_cost: string | null;
  balance_after: string; average_cost_after: string; reason_code: Movement['reasonCode']; note: string | null; reference: string | null;
  device_id: string | null; occurred_at: string; recorded_at: string; recorded_by: string | null;
}
interface RawApply { client_id: string; status: ApplyResult['status']; movement_id?: string; balance_after?: string; average_cost_after?: string; warnings?: string[]; code?: string; message?: string; detail?: string | null }
interface RawTier { id: string; unit_id: string; price_level: PriceLevel; min_quantity: string; price: string }

export const mapWarehouse = (r: RawWarehouse): Warehouse => ({
  id: r.id, branchId: r.branch_id, code: r.code, nameEn: r.name_en, nameAr: r.name_ar, nameBn: r.name_bn,
  isActive: r.is_active, rowVersion: Number(r.row_version),
});

export const mapApplyResult = (r: RawApply): ApplyResult => ({
  clientId: r.client_id,
  status: r.status,
  movementId: r.movement_id ?? null,
  balanceAfter: r.balance_after ?? null,
  averageCostAfter: r.average_cost_after ?? null,
  warnings: r.warnings ?? [],
  code: r.code ?? null,
  message: r.message ?? null,
  detail: r.detail ?? null,
});

const mapMovement = (r: RawMovement): Movement => ({
  id: r.id, clientId: r.client_id, warehouseId: r.warehouse_id, productId: r.product_id, movementType: r.movement_type,
  unitId: r.unit_id, enteredQuantity: r.entered_quantity, factor: r.factor, quantityChange: r.quantity_change,
  unitCost: r.unit_cost, baseUnitCost: r.base_unit_cost, balanceAfter: r.balance_after, averageCostAfter: r.average_cost_after,
  reasonCode: r.reason_code, note: r.note, reference: r.reference, deviceId: r.device_id, occurredAt: r.occurred_at,
  recordedAt: r.recorded_at, recordedBy: r.recorded_by,
});

/** Payload → snake_case JSON accepted by public.apply_stock_movements. */
export function toMovementJson(m: MovementPayload) {
  return {
    client_id: m.clientId,
    warehouse_id: m.warehouseId,
    product_id: m.productId,
    movement_type: m.movementType,
    unit_id: m.unitId,
    quantity: m.quantity,
    unit_cost: m.unitCost,
    reason_code: m.reasonCode,
    note: m.note,
    reference: m.reference,
    occurred_at: m.occurredAt,
  };
}

export interface InventoryRepository {
  listWarehouses(orgId: string): Promise<Warehouse[]>;
  saveWarehouse(input: { id?: string; orgId: string; branchId: string; code: string; nameEn: string; nameAr: string; nameBn: string | null; isActive: boolean }): Promise<Warehouse>;
  listStockLevels(warehouseId: string): Promise<StockLevel[]>;
  listLowStock(orgId: string, branchId?: string | null): Promise<LowStockItem[]>;
  listMovements(q: MovementQuery): Promise<Movement[]>;
  /** Sends a batch; resolves with one result per movement (never throws for business rejections). */
  applyMovements(orgId: string, deviceId: string, batch: MovementPayload[]): Promise<ApplyResult[]>;
  listPriceTiers(productId: string): Promise<PriceTierRow[]>;
  savePriceTiers(orgId: string, productId: string, tiers: Array<Omit<PriceTierRow, 'id'> & { id?: string }>): Promise<number>;
  resolveSalePrice(productId: string, unitId: string, quantity: string, level: PriceLevel): Promise<string | null>;
}

export function createSupabaseInventoryRepository(db: DbClient): InventoryRepository {
  return {
    async listWarehouses(orgId) {
      const rows = unwrap(await db.from('warehouses').select(WAREHOUSE_SELECT).eq('org_id', orgId).order('code')) as unknown as RawWarehouse[];
      return rows.map(mapWarehouse);
    },

    async saveWarehouse(input) {
      const row = {
        org_id: input.orgId, branch_id: input.branchId, code: input.code.trim().toUpperCase(),
        name_en: input.nameEn.trim(), name_ar: input.nameAr.trim(), name_bn: input.nameBn?.trim() || null,
        is_active: input.isActive,
      };
      const query = input.id ? db.from('warehouses').update(row).eq('id', input.id) : db.from('warehouses').insert(row);
      return mapWarehouse(unwrap(await query.select(WAREHOUSE_SELECT).single()) as unknown as RawWarehouse);
    },

    async listStockLevels(warehouseId) {
      const rows = unwrap(await db.rpc('list_stock_levels', { p_warehouse_id: warehouseId })) as unknown as RawLevel[];
      return rows.map((r) => ({
        productId: r.product_id, sku: r.sku, nameEn: r.name_en, nameAr: r.name_ar, nameBn: r.name_bn,
        baseUnitId: r.base_unit_id, quantity: r.quantity, averageCost: r.average_cost, reorderLevel: r.reorder_level,
        lastMovementAt: r.last_movement_at, isLow: r.is_low,
      }));
    },

    async listLowStock(orgId, branchId = null) {
      const rows = unwrap(await db.rpc('list_low_stock', { p_org_id: orgId, p_branch_id: branchId })) as unknown as RawLow[];
      return rows.map((r) => ({
        warehouseId: r.warehouse_id, branchId: r.branch_id, productId: r.product_id, sku: r.sku,
        nameEn: r.name_en, nameAr: r.name_ar, quantity: r.quantity, reorderLevel: r.reorder_level, shortage: r.shortage,
      }));
    },

    async listMovements(q) {
      const rows = unwrap(await db.rpc('list_stock_movements', {
        p_warehouse_id: q.warehouseId ?? null,
        p_product_id: q.productId ?? null,
        p_movement_type: q.movementType ?? null,
        p_limit: q.limit,
        p_offset: q.offset,
      })) as unknown as RawMovement[];
      return rows.map(mapMovement);
    },

    async applyMovements(orgId, deviceId, batch) {
      if (batch.length === 0) return [];
      const result = await db.rpc('apply_stock_movements', {
        p_org_id: orgId,
        p_device_id: deviceId,
        p_movements: batch.map(toMovementJson),
      });
      const raw = unwrap(result) as unknown as RawApply[];
      if (!Array.isArray(raw) || raw.length !== batch.length) {
        // Never assume: a shape mismatch must be visible, not silently treated as success.
        throw new DataError('unknown', `apply_stock_movements returned ${Array.isArray(raw) ? raw.length : 'no'} results for ${batch.length} movements`);
      }
      return raw.map(mapApplyResult);
    },

    async listPriceTiers(productId) {
      const result = await db.from('product_prices').select('id, unit_id, price_level, min_quantity::text, price::text').eq('product_id', productId);
      const rows = unwrap(result) as unknown as RawTier[];
      return rows.map((r) => ({ id: r.id, unitId: r.unit_id, priceLevel: r.price_level, minQuantity: r.min_quantity, price: r.price }));
    },

    async savePriceTiers(orgId, productId, tiers) {
      const payload = tiers.map((t) => ({
        ...(t.id ? { id: t.id } : {}),
        unit_id: t.unitId, price_level: t.priceLevel, min_quantity: t.minQuantity, price: t.price,
      }));
      const result = await db.rpc('save_product_prices', { p_org_id: orgId, p_product_id: productId, p_prices: payload });
      return unwrap(result) as unknown as number;
    },

    async resolveSalePrice(productId, unitId, quantity, level) {
      const result = await db.rpc('resolve_sale_price', { p_product_id: productId, p_unit_id: unitId, p_quantity: quantity, p_level: level });
      if (result.error) throw toDataError(result.error);
      return (result.data as string | null) ?? null;
    },
  };
}
