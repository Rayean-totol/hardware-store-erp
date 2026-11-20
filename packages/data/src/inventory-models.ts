import type { PriceLevel, StockReason } from '@erp/domain';

export interface Warehouse {
  id: string;
  branchId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  nameBn: string | null;
  isActive: boolean;
  rowVersion: number;
}

/** Decimal values are strings everywhere: JSON numbers would lose precision. */
export interface StockLevel {
  productId: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  nameBn: string | null;
  baseUnitId: string;
  quantity: string;
  averageCost: string;
  reorderLevel: string | null;
  lastMovementAt: string | null;
  isLow: boolean;
}

export interface LowStockItem {
  warehouseId: string;
  branchId: string;
  productId: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  quantity: string;
  reorderLevel: string;
  shortage: string;
}

export interface Movement {
  id: string;
  clientId: string;
  warehouseId: string;
  productId: string;
  movementType: 'stock_in' | 'stock_out' | 'adjustment';
  unitId: string;
  enteredQuantity: string;
  factor: string;
  quantityChange: string;
  unitCost: string | null;
  baseUnitCost: string | null;
  balanceAfter: string;
  averageCostAfter: string;
  reasonCode: StockReason | null;
  note: string | null;
  reference: string | null;
  deviceId: string | null;
  occurredAt: string;
  recordedAt: string;
  recordedBy: string | null;
}

export interface MovementQuery {
  warehouseId?: string | null;
  productId?: string | null;
  movementType?: 'stock_in' | 'stock_out' | 'adjustment' | null;
  limit: number;
  offset: number;
}

/** One command as sent to the server. `clientId` is the idempotency key. */
export interface MovementPayload {
  clientId: string;
  warehouseId: string;
  productId: string;
  movementType: 'stock_in' | 'stock_out' | 'adjustment';
  unitId: string;
  /** Entered quantity as a decimal string; signed for adjustments, positive otherwise. */
  quantity: string;
  unitCost: string | null;
  reasonCode: StockReason | null;
  note: string | null;
  reference: string | null;
  occurredAt: string;
}

export type ApplyStatus = 'applied' | 'duplicate' | 'rejected';

export interface ApplyResult {
  clientId: string;
  status: ApplyStatus;
  movementId: string | null;
  balanceAfter: string | null;
  averageCostAfter: string | null;
  warnings: string[];
  code: string | null;
  message: string | null;
  detail: string | null;
}

export interface PriceTierRow {
  id: string;
  unitId: string;
  priceLevel: PriceLevel;
  minQuantity: string;
  price: string;
}
