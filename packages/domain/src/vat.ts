import { dec, type Dec, type Numeric } from './decimal';
import { roundMoney } from './money';

/**
 * VAT categories (UNCL5305 codes, as used by ZATCA):
 * S = standard rate, Z = zero rated, E = exempt, O = out of scope.
 */
export const TAX_CATEGORIES = ['S', 'Z', 'E', 'O'] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

/**
 * Saudi standard VAT rate (15% since 1 July 2020). Kept as a constant for Phase 1;
 * Phase 3 moves rates to a dated table so historical documents keep their rate.
 */
export const SAUDI_STANDARD_VAT_RATE = dec('0.15');

export function vatRateFor(category: TaxCategory): Dec {
  return category === 'S' ? SAUDI_STANDARD_VAT_RATE : dec(0);
}

/**
 * Exemption / zero-rating reason codes. Required on invoice lines whose category is not S.
 * The list must be re-verified against ZATCA's current code list before Phase 6.
 */
export const VAT_EXEMPTION_REASONS: Record<Exclude<TaxCategory, 'S'>, readonly string[]> = {
  E: ['VATEX-SA-29', 'VATEX-SA-29-7', 'VATEX-SA-30'],
  Z: [
    'VATEX-SA-32',
    'VATEX-SA-33',
    'VATEX-SA-34-1',
    'VATEX-SA-34-2',
    'VATEX-SA-34-3',
    'VATEX-SA-34-4',
    'VATEX-SA-34-5',
    'VATEX-SA-35',
    'VATEX-SA-36',
    'VATEX-SA-EDU',
    'VATEX-SA-HEA',
    'VATEX-SA-MLTRY',
  ],
  O: ['VATEX-SA-OOS'],
};

export interface LineAmounts {
  /** Amount excluding VAT, 2 dp. */
  net: Dec;
  /** VAT amount, 2 dp. */
  vat: Dec;
  /** Amount including VAT, 2 dp. net + vat === gross always holds. */
  gross: Dec;
  rate: Dec;
}

/**
 * Line-level VAT calculation. Amounts are rounded per line (half-up, 2 dp) and
 * VAT is derived so that net + vat === gross exactly.
 */
export function calculateLine(params: {
  unitPrice: Numeric;
  quantity: Numeric;
  taxCategory: TaxCategory;
  pricesIncludeVat: boolean;
}): LineAmounts {
  const rate = vatRateFor(params.taxCategory);
  const extended = dec(params.unitPrice).times(dec(params.quantity));
  if (params.pricesIncludeVat) {
    const gross = roundMoney(extended);
    const net = roundMoney(gross.dividedBy(rate.plus(1)));
    return { net, vat: gross.minus(net), gross, rate };
  }
  const net = roundMoney(extended);
  const vat = roundMoney(net.times(rate));
  return { net, vat, gross: net.plus(vat), rate };
}
