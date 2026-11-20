import { describe, expect, it } from 'vitest';
import { calculateLine, dec, moneyString, roundMoney, tryDec, vatRateFor } from '../src';

describe('decimal parsing', () => {
  it('avoids binary floating point errors', () => {
    expect(dec('0.1').plus('0.2').toString()).toBe('0.3');
  });
  it('rejects garbage, NaN and Infinity', () => {
    expect(() => dec('12abc')).toThrow(RangeError);
    expect(() => dec(Number.NaN)).toThrow(RangeError);
    expect(() => dec(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => dec('1e5')).toThrow(RangeError); // exponent notation not accepted from users
    expect(tryDec('')).toBeNull();
    expect(tryDec(' 12.5 ')?.toString()).toBe('12.5');
  });
  it('rounds money half-up to 2 dp', () => {
    expect(roundMoney('2.345').toString()).toBe('2.35');
    expect(roundMoney('2.344').toString()).toBe('2.34');
    expect(roundMoney('-2.345').toString()).toBe('-2.35');
    expect(moneyString('5')).toBe('5.00');
  });
});

describe('VAT line calculation', () => {
  it('uses 15% for standard rated, 0 otherwise', () => {
    expect(vatRateFor('S').toString()).toBe('0.15');
    expect(vatRateFor('Z').toString()).toBe('0');
    expect(vatRateFor('E').toString()).toBe('0');
  });

  it('splits VAT-inclusive prices so net + vat = gross exactly', () => {
    const line = calculateLine({ unitPrice: '115', quantity: '1', taxCategory: 'S', pricesIncludeVat: true });
    expect(line.gross.toString()).toBe('115');
    expect(line.net.toString()).toBe('100');
    expect(line.vat.toString()).toBe('15');

    const awkward = calculateLine({ unitPrice: '0.15', quantity: '7', taxCategory: 'S', pricesIncludeVat: true });
    expect(awkward.gross.toFixed(2)).toBe('1.05');
    expect(awkward.net.toFixed(2)).toBe('0.91');
    expect(awkward.vat.toFixed(2)).toBe('0.14');
    expect(awkward.net.plus(awkward.vat).eq(awkward.gross)).toBe(true);
  });

  it('adds VAT to exclusive prices', () => {
    const line = calculateLine({ unitPrice: '3.333', quantity: '3', taxCategory: 'S', pricesIncludeVat: false });
    expect(line.net.toFixed(2)).toBe('10.00');
    expect(line.vat.toFixed(2)).toBe('1.50');
    expect(line.gross.toFixed(2)).toBe('11.50');
  });

  it('handles fractional quantities (metres of cable)', () => {
    const line = calculateLine({ unitPrice: '3.50', quantity: '12.5', taxCategory: 'S', pricesIncludeVat: true });
    expect(line.gross.toFixed(2)).toBe('43.75');
    expect(line.net.toFixed(2)).toBe('38.04');
    expect(line.vat.toFixed(2)).toBe('5.71');
  });

  it('zero-rated lines carry no VAT', () => {
    const line = calculateLine({ unitPrice: '50', quantity: '2', taxCategory: 'Z', pricesIncludeVat: true });
    expect(line.vat.toString()).toBe('0');
    expect(line.net.toString()).toBe('100');
  });
});
