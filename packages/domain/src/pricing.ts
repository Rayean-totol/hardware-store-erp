import { dec, tryDec, type Dec, type Numeric } from './decimal';

/**
 * Selling prices. product_units.sale_price is the base RETAIL price; price tiers add
 * wholesale/trade levels and quantity breaks. Mirrors public.resolve_sale_price().
 */
export const PRICE_LEVELS = ['retail', 'wholesale', 'trade'] as const;
export type PriceLevel = (typeof PRICE_LEVELS)[number];

export interface PriceTier {
  unitId: string;
  level: PriceLevel;
  minQuantity: string;
  price: string;
}

export interface UnitBasePrice {
  unitId: string;
  salePrice: string | null;
}

/**
 * Best price for a sale: the highest quantity break at or below `quantity` in the requested
 * level; otherwise the retail break; otherwise the base retail price. Null when no price exists.
 */
export function resolveSalePrice(params: {
  unitId: string;
  quantity: Numeric;
  level: PriceLevel;
  tiers: readonly PriceTier[];
  basePrices: readonly UnitBasePrice[];
}): Dec | null {
  const { unitId, level, tiers } = params;
  const qty = dec(params.quantity);
  const bestFor = (lvl: PriceLevel): PriceTier | undefined => {
    let best: PriceTier | undefined;
    for (const t of tiers) {
      if (t.unitId !== unitId || t.level !== lvl || dec(t.minQuantity).gt(qty)) continue;
      if (!best || dec(t.minQuantity).gt(dec(best.minQuantity))) best = t;
    }
    return best;
  };
  const tier = bestFor(level) ?? (level === 'retail' ? undefined : bestFor('retail'));
  if (tier) return dec(tier.price);
  const base = params.basePrices.find((b) => b.unitId === unitId);
  return base ? tryDec(base.salePrice) : null;
}

export interface PriceIssue {
  index: number;
  code: 'price.invalid' | 'price.negative' | 'price.min_quantity' | 'price.duplicate' | 'price.unit';
}

/** Validate a tier set before saving (the database enforces the same rules). */
export function validatePriceTiers(tiers: readonly PriceTier[], unitIds: ReadonlySet<string>): PriceIssue[] {
  const issues: PriceIssue[] = [];
  const seen = new Set<string>();
  tiers.forEach((t, index) => {
    if (!unitIds.has(t.unitId)) issues.push({ index, code: 'price.unit' });
    const price = tryDec(t.price);
    if (!price) issues.push({ index, code: 'price.invalid' });
    else if (price.isNegative()) issues.push({ index, code: 'price.negative' });
    const min = tryDec(t.minQuantity);
    if (!min || min.lte(0)) issues.push({ index, code: 'price.min_quantity' });
    const key = `${t.unitId}|${t.level}|${min?.toString() ?? t.minQuantity}`;
    if (seen.has(key)) issues.push({ index, code: 'price.duplicate' });
    seen.add(key);
  });
  return issues;
}
