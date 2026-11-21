import { dec, type Dec, type Numeric } from './decimal';
import { roundMoney } from './money';
import { calculateLine, type TaxCategory } from './vat';

/**
 * POS sale rules shared by the till screen (live preview) and tests.
 * The database (finalize_sale) recalculates everything on the server; the server result is the
 * authority. These rules must match supabase/migrations/*_pos_sales.sql. Parity is tested in
 * tests/db (pos.test.ts compares the server totals with calculateLine).
 */

export type DiscountType = 'percent' | 'fixed';

export interface SaleLineInput {
  quantity: Numeric;
  /** Catalogue price per entered unit (net if prices are VAT-exclusive, gross if inclusive). */
  listPrice: Numeric;
  /** Price actually charged; defaults to the list price. A different value is a price override. */
  unitPrice?: Numeric | null;
  discountType?: DiscountType | null;
  discountValue?: Numeric | null;
  taxCategory: TaxCategory;
}

export interface SaleLineAmounts {
  extended: Dec;
  discount: Dec;
  net: Dec;
  vat: Dec;
  gross: Dec;
  priceOverridden: boolean;
}

export interface SaleTotals {
  net: Dec;
  discount: Dec;
  vat: Dec;
  gross: Dec;
  lines: SaleLineAmounts[];
}

export type SaleIssue =
  | 'quantity.invalid'
  | 'price.negative'
  | 'discount.invalid'
  | 'payment.amount'
  | 'payment.tendered_not_cash'
  | 'payment.exceeds_total'
  | 'payment.insufficient';

/** Quantity must be positive with at most 6 decimals (the stock ledger precision). */
export function validSaleQuantity(quantity: Numeric): boolean {
  const q = dec(quantity);
  return q.isFinite() && q.gt(0) && q.decimalPlaces() <= 6;
}

/**
 * Discount is applied to the extended amount before VAT. Percent discounts are rounded to 2 dp;
 * fixed discounts cannot exceed the extended amount.
 */
export function lineDiscount(extended: Dec, type: DiscountType | null | undefined, value: Numeric | null | undefined): Dec | null {
  if (!type || value === null || value === undefined || dec(value).isZero()) return dec(0);
  const v = dec(value);
  if (v.isNegative()) return null;
  if (type === 'percent') {
    if (v.gt(100)) return null;
    return roundMoney(extended.times(v).dividedBy(100));
  }
  if (v.gt(extended)) return null;
  return roundMoney(v);
}

/** Amounts for one line. Returns null when the input is invalid (the till shows the problem). */
export function calculateSaleLine(input: SaleLineInput, pricesIncludeVat: boolean): SaleLineAmounts | null {
  if (!validSaleQuantity(input.quantity)) return null;
  const unitPrice = input.unitPrice ?? input.listPrice;
  if (dec(unitPrice).isNegative()) return null;
  const extended = roundMoney(dec(input.quantity).times(dec(unitPrice)));
  const discount = lineDiscount(extended, input.discountType, input.discountValue);
  if (discount === null) return null;
  const afterDiscount = extended.minus(discount);
  // Same rule as the database: one unit at the discounted amount gives the line VAT split.
  const split = calculateLine({ unitPrice: afterDiscount, quantity: '1', taxCategory: input.taxCategory, pricesIncludeVat });
  return {
    extended,
    discount,
    net: split.net,
    vat: split.vat,
    gross: split.gross,
    priceOverridden: !dec(unitPrice).equals(dec(input.listPrice)),
  };
}

export function calculateSale(lines: readonly SaleLineInput[], pricesIncludeVat: boolean): SaleTotals | null {
  const amounts: SaleLineAmounts[] = [];
  for (const line of lines) {
    const a = calculateSaleLine(line, pricesIncludeVat);
    if (!a) return null;
    amounts.push(a);
  }
  const sum = (pick: (a: SaleLineAmounts) => Dec) => amounts.reduce((acc, a) => acc.plus(pick(a)), dec(0));
  return {
    net: sum((a) => a.net),
    discount: sum((a) => a.discount),
    vat: sum((a) => a.vat),
    gross: sum((a) => a.gross),
    lines: amounts,
  };
}

export interface PaymentInput {
  method: 'cash' | 'card' | 'transfer';
  /** Amount applied to the invoice. */
  amount: Numeric;
  /** Amount handed over (cash only; may exceed the amount, the difference is change). */
  tendered?: Numeric | null;
}

export interface Settlement {
  paid: Dec;
  change: Dec;
  /** Outstanding balance; must be recorded as credit (needs a customer with credit allowed). */
  balance: Dec;
  issues: SaleIssue[];
}

/** Payment rules: cash may be tendered above its amount (change); other methods cannot overpay. */
export function settlePayments(total: Numeric, payments: readonly PaymentInput[]): Settlement {
  const issues: SaleIssue[] = [];
  let paid = dec(0);
  let change = dec(0);
  for (const p of payments) {
    const amount = dec(p.amount);
    const tendered = p.tendered === null || p.tendered === undefined ? amount : dec(p.tendered);
    if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 2 || tendered.lt(amount)) {
      issues.push('payment.amount');
      continue;
    }
    if (p.method !== 'cash' && !tendered.equals(amount)) issues.push('payment.tendered_not_cash');
    paid = paid.plus(amount);
    change = change.plus(tendered.minus(amount));
  }
  const totalDec = roundMoney(total);
  if (paid.gt(totalDec)) issues.push('payment.exceeds_total');
  const balance = totalDec.minus(paid).gt(0) ? totalDec.minus(paid) : dec(0);
  return { paid, change, balance, issues: [...new Set(issues)] };
}
