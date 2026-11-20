import { D, dec, type Dec, type Numeric } from './decimal';

export const BASE_CURRENCY = 'SAR';
/** SAR has 100 halalas. */
export const MONEY_DECIMALS = 2;
/** Unit prices may carry more precision than invoice totals (DB: numeric(18,4)). */
export const PRICE_DECIMALS = 4;

export function roundMoney(value: Numeric): Dec {
  return dec(value).toDecimalPlaces(MONEY_DECIMALS, D.ROUND_HALF_UP);
}

export function roundPrice(value: Numeric): Dec {
  return dec(value).toDecimalPlaces(PRICE_DECIMALS, D.ROUND_HALF_UP);
}

/** Fixed 2-decimal string for storage/transport, e.g. "12.50". */
export function moneyString(value: Numeric): string {
  return roundMoney(value).toFixed(MONEY_DECIMALS);
}
