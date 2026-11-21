import { calculateSale, settlePayments, type DiscountType, type PaymentInput, type SaleIssue, type TaxCategory } from '@erp/domain';
import type { Product } from '@erp/data';

/**
 * Pure till state. The screen keeps these lines; the server recalculates every amount on checkout.
 * Quantities and prices stay as typed strings until they are valid, so partly typed values do not break the screen.
 */
export interface CartLine {
  key: string;
  productId: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  nameBn: string | null;
  imagePath: string | null;
  unitId: string;
  quantity: string;
  listPrice: string;
  /** Null means the catalogue price. A different value is a price override (needs permission). */
  unitPrice: string | null;
  discountType: DiscountType | null;
  discountValue: string;
  taxCategory: TaxCategory;
}

export interface SellableUnit {
  unitId: string;
  price: string;
  taxCategory: TaxCategory;
}

/** The unit a product is sold in at the till: its sale unit with a price (base unit as a fallback). */
export function sellableUnit(product: Product): SellableUnit | null {
  const unit =
    product.units.find((u) => u.isSaleUnit && u.salePrice) ??
    product.units.find((u) => u.isBase && u.salePrice) ??
    null;
  const price = unit?.salePrice;
  if (!unit || !price) return null;
  return { unitId: unit.unitId, price, taxCategory: product.taxCategory };
}

export function lineFor(product: Product, unit: SellableUnit, key: string): CartLine {
  return {
    key,
    productId: product.id,
    sku: product.sku,
    nameEn: product.nameEn,
    nameAr: product.nameAr,
    nameBn: product.nameBn ?? null,
    imagePath: product.imagePath ?? null,
    unitId: unit.unitId,
    quantity: '1',
    listPrice: unit.price,
    unitPrice: null,
    discountType: null,
    discountValue: '',
    taxCategory: unit.taxCategory,
  };
}

/** Adds one piece of the product, or increases the quantity of an existing line for the same unit. */
export function addProduct(lines: CartLine[], product: Product, newKey: () => string): CartLine[] {
  const unit = sellableUnit(product);
  if (!unit) return lines;
  const existing = lines.find((l) => l.productId === product.id && l.unitId === unit.unitId);
  if (existing) {
    const next = Number(existing.quantity) + 1;
    return lines.map((l) => (l.key === existing.key ? { ...l, quantity: String(Number.isFinite(next) ? next : existing.quantity) } : l));
  }
  return [...lines, lineFor(product, unit, newKey())];
}

export function patchLine(lines: CartLine[], key: string, patch: Partial<CartLine>): CartLine[] {
  return lines.map((l) => (l.key === key ? { ...l, ...patch } : l));
}

export function removeLine(lines: CartLine[], key: string): CartLine[] {
  return lines.filter((l) => l.key !== key);
}

export interface CartTotals {
  net: string;
  discount: string;
  vat: string;
  gross: string;
}

/** Live totals from the domain rules. Null when a line is not valid yet. */
export function cartTotals(lines: CartLine[], pricesIncludeVat: boolean): CartTotals | null {
  const totals = calculateSale(
    lines.map((l) => ({
      quantity: l.quantity || '0',
      listPrice: l.listPrice,
      unitPrice: l.unitPrice,
      discountType: l.discountType,
      discountValue: l.discountValue || null,
      taxCategory: l.taxCategory,
    })),
    pricesIncludeVat,
  );
  if (!totals) return null;
  return {
    net: totals.net.toFixed(2),
    discount: totals.discount.toFixed(2),
    vat: totals.vat.toFixed(2),
    gross: totals.gross.toFixed(2),
  };
}

export interface PaymentEntry {
  /** Cash handed over (may exceed the cash due; the difference is change). */
  cashTendered: string;
  card: string;
  transfer: string;
}

export interface Settlement {
  /** Payments as the server expects them (credit is added by the server). */
  payments: PaymentInput[];
  paid: string;
  change: string;
  balance: string;
  issues: SaleIssue[];
}

const toAmount = (v: string) => (v.trim() === '' ? null : v.trim());

/**
 * Cash fills the invoice first; card and transfer are taken as typed. Cash handed over above what is due
 * becomes change. Whatever is left is the balance (credit).
 */
export function settle(gross: string, entry: PaymentEntry): Settlement {
  const total = Number(gross);
  const card = toAmount(entry.card);
  const transfer = toAmount(entry.transfer);
  const cash = toAmount(entry.cashTendered);
  const nonCash = (Number(card ?? 0) + Number(transfer ?? 0));
  const cashDue = Math.max(0, Math.round((total - nonCash) * 100) / 100);
  const cashApplied = cash === null ? 0 : Math.min(Number(cash), cashDue);

  const payments: PaymentInput[] = [];
  if (cash !== null && cashApplied > 0) payments.push({ method: 'cash', amount: cashApplied.toFixed(2), tendered: Number(cash).toFixed(2) });
  if (card !== null && Number(card) > 0) payments.push({ method: 'card', amount: Number(card).toFixed(2) });
  if (transfer !== null && Number(transfer) > 0) payments.push({ method: 'transfer', amount: Number(transfer).toFixed(2) });

  const result = settlePayments(gross, payments);
  return {
    payments,
    paid: result.paid.toFixed(2),
    change: result.change.toFixed(2),
    balance: result.balance.toFixed(2),
    issues: result.issues,
  };
}

/** Parses the saved holds list; anything unexpected is dropped rather than breaking the till. */
export interface HeldCart {
  id: string;
  savedAt: string;
  customerId: string | null;
  note: string;
  lines: CartLine[];
}

export function parseHolds(raw: string | null): HeldCart[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (h): h is HeldCart =>
        typeof h === 'object' && h !== null && typeof (h as HeldCart).id === 'string' && Array.isArray((h as HeldCart).lines),
    );
  } catch {
    return [];
  }
}
