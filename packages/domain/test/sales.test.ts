import { describe, expect, it } from 'vitest';
import { calculateSale, calculateSaleLine, lineDiscount, settlePayments, validSaleQuantity } from '../src/sales';
import { dec } from '../src/decimal';

const base = { taxCategory: 'S' as const };

describe('calculateSaleLine: VAT-inclusive prices', () => {
  it('splits a 115.00 gross price into 100.00 net and 15.00 VAT', () => {
    const a = calculateSaleLine({ ...base, quantity: '1', listPrice: '115' }, true)!;
    expect([a.net.toFixed(2), a.vat.toFixed(2), a.gross.toFixed(2)]).toEqual(['100.00', '15.00', '115.00']);
  });

  it('rounds half-up and keeps net + VAT equal to gross', () => {
    // 10.00 / 1.15 = 8.695652... -> net 8.70, VAT 1.30, gross 10.00 (VAT is the remainder)
    const a = calculateSaleLine({ ...base, quantity: '1', listPrice: '10' }, true)!;
    expect([a.net.toFixed(2), a.vat.toFixed(2), a.gross.toFixed(2)]).toEqual(['8.70', '1.30', '10.00']);
    expect(a.net.plus(a.vat).equals(a.gross)).toBe(true);
  });

  it('applies quantity before VAT', () => {
    const a = calculateSaleLine({ ...base, quantity: '3', listPrice: '2.50' }, true)!;
    expect(a.gross.toFixed(2)).toBe('7.50');
  });
});

describe('calculateSaleLine: VAT-exclusive prices', () => {
  it('adds 15% VAT on top of the net price', () => {
    const a = calculateSaleLine({ ...base, quantity: '2', listPrice: '50' }, false)!;
    expect([a.net.toFixed(2), a.vat.toFixed(2), a.gross.toFixed(2)]).toEqual(['100.00', '15.00', '115.00']);
  });
});

describe('product-specific VAT treatment', () => {
  it('zero-rated and exempt products carry no VAT', () => {
    expect(calculateSaleLine({ quantity: '1', listPrice: '40', taxCategory: 'Z' }, true)!.vat.toFixed(2)).toBe('0.00');
    expect(calculateSaleLine({ quantity: '1', listPrice: '40', taxCategory: 'E' }, false)!.gross.toFixed(2)).toBe('40.00');
  });
});

describe('discounts', () => {
  it('a percentage discount reduces the amount before VAT', () => {
    const a = calculateSaleLine({ ...base, quantity: '1', listPrice: '115', discountType: 'percent', discountValue: '10' }, true)!;
    expect(a.discount.toFixed(2)).toBe('11.50');
    expect(a.gross.toFixed(2)).toBe('103.50');
    expect(a.vat.toFixed(2)).toBe('13.50');
  });

  it('a fixed discount cannot exceed the extended amount', () => {
    expect(lineDiscount(dec('20'), 'fixed', '25')).toBeNull();
    expect(lineDiscount(dec('20'), 'fixed', '5')!.toFixed(2)).toBe('5.00');
  });

  it('a percentage above 100 or a negative discount is invalid', () => {
    expect(lineDiscount(dec('20'), 'percent', '101')).toBeNull();
    expect(lineDiscount(dec('20'), 'percent', '-1')).toBeNull();
  });

  it('no discount when none is given', () => {
    expect(lineDiscount(dec('20'), null, '5')!.toFixed(2)).toBe('0.00');
  });
});

describe('price overrides', () => {
  it('flags a unit price that differs from the list price', () => {
    expect(calculateSaleLine({ ...base, quantity: '1', listPrice: '10', unitPrice: '8' }, true)!.priceOverridden).toBe(true);
    expect(calculateSaleLine({ ...base, quantity: '1', listPrice: '10', unitPrice: '10' }, true)!.priceOverridden).toBe(false);
  });

  it('refuses a negative price', () => {
    expect(calculateSaleLine({ ...base, quantity: '1', listPrice: '10', unitPrice: '-1' }, true)).toBeNull();
  });
});

describe('quantities', () => {
  it('accepts positive quantities with at most 6 decimals', () => {
    expect(validSaleQuantity('0.5')).toBe(true);
    expect(validSaleQuantity('1.000001')).toBe(true);
    expect(validSaleQuantity('0')).toBe(false);
    expect(validSaleQuantity('1.0000001')).toBe(false);
    expect(validSaleQuantity('-2')).toBe(false);
  });
});

describe('calculateSale totals', () => {
  it('sums lines and keeps the invariant net + VAT = gross', () => {
    const t = calculateSale(
      [
        { ...base, quantity: '1', listPrice: '115' },
        { ...base, quantity: '2', listPrice: '10', discountType: 'percent', discountValue: '50' },
      ],
      true,
    )!;
    expect(t.gross.toFixed(2)).toBe('125.00');
    expect(t.net.plus(t.vat).equals(t.gross)).toBe(true);
  });

  it('returns null if any line is invalid', () => {
    expect(calculateSale([{ ...base, quantity: '0', listPrice: '10' }], true)).toBeNull();
  });
});

describe('settlePayments', () => {
  it('exact payment settles the invoice', () => {
    const s = settlePayments('115.00', [{ method: 'card', amount: '115.00' }]);
    expect(s.balance.toFixed(2)).toBe('0.00');
    expect(s.change.toFixed(2)).toBe('0.00');
    expect(s.issues).toEqual([]);
  });

  it('split payment: cash and card add up to the total', () => {
    const s = settlePayments('115.00', [
      { method: 'cash', amount: '65.00' },
      { method: 'card', amount: '50.00' },
    ]);
    expect(s.paid.toFixed(2)).toBe('115.00');
    expect(s.balance.toFixed(2)).toBe('0.00');
  });

  it('cash tendered above the amount gives change', () => {
    const s = settlePayments('115.00', [{ method: 'cash', amount: '115.00', tendered: '120.00' }]);
    expect(s.change.toFixed(2)).toBe('5.00');
    expect(s.issues).toEqual([]);
  });

  it('partial payment leaves the balance outstanding', () => {
    const s = settlePayments('115.00', [{ method: 'cash', amount: '100.00' }]);
    expect(s.balance.toFixed(2)).toBe('15.00');
  });

  it('refuses an overpayment by card, and a tendered amount on card', () => {
    expect(settlePayments('115.00', [{ method: 'card', amount: '120.00' }]).issues).toContain('payment.exceeds_total');
    expect(settlePayments('115.00', [{ method: 'card', amount: '115.00', tendered: '120.00' }]).issues).toContain('payment.tendered_not_cash');
  });

  it('refuses a zero or fractional-halala amount', () => {
    expect(settlePayments('10.00', [{ method: 'cash', amount: '0' }]).issues).toContain('payment.amount');
    expect(settlePayments('10.00', [{ method: 'cash', amount: '1.005' }]).issues).toContain('payment.amount');
  });
});
