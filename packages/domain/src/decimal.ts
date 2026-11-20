import Decimal from 'decimal.js';

/**
 * Decimal constructor used for ALL quantities and amounts.
 * Never use JavaScript numbers for money: 0.1 + 0.2 !== 0.3.
 * Rounding is half-up (the convention used on Saudi tax invoices).
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;
export type Numeric = string | number | Decimal;

const DECIMAL_STRING = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** Parse a value into a Decimal, throwing on NaN, Infinity or garbage. */
export function dec(value: Numeric): Decimal {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!DECIMAL_STRING.test(trimmed)) {
      throw new RangeError(`Not a decimal number: "${value}"`);
    }
    return new D(trimmed);
  }
  const d = new D(value);
  if (!d.isFinite()) {
    throw new RangeError(`Not a finite number: ${String(value)}`);
  }
  return d;
}

/** Non-throwing parse: returns null for invalid input (user-typed text). */
export function tryDec(value: unknown): Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number' && !Decimal.isDecimal(value)) {
    return null;
  }
  try {
    return dec(value as Numeric);
  } catch {
    return null;
  }
}

/** Number of digits after the decimal point, ignoring trailing zeros. */
export function decimalPlacesOf(value: Decimal): number {
  return value.decimalPlaces();
}
