import { describe, expect, it } from 'vitest';
import { purchaseActions, validPurchaseQuantity, validUnitCost } from '../src/purchase';

const ALL = ['purchase.read', 'purchase.create', 'purchase.approve', 'purchase.void', 'purchase.cost_view'];

describe('purchaseActions: what a user may see on an order', () => {
  it('a creator can edit and submit their draft, but not approve it', () => {
    const creator = { permissions: ['purchase.read', 'purchase.create'], isCreator: true };
    expect(purchaseActions('draft', creator)).toEqual(['edit', 'submit']);
    expect(purchaseActions('submitted', creator)).not.toContain('approve');
  });

  it('an approver other than the creator approves a submitted order, and never their own', () => {
    expect(purchaseActions('submitted', { permissions: ALL, isCreator: false })).toContain('approve');
    expect(purchaseActions('submitted', { permissions: ALL, isCreator: true })).not.toContain('approve');
  });

  it('a cancelled order offers nothing; a received order is not cancellable from here', () => {
    expect(purchaseActions('cancelled', { permissions: ALL, isCreator: false })).toEqual([]);
    expect(purchaseActions('partially_received', { permissions: ALL, isCreator: false })).toEqual([]);
  });

  it('a user without purchase permissions sees no actions', () => {
    expect(purchaseActions('draft', { permissions: ['purchase.read'], isCreator: true })).toEqual([]);
  });

  it('cancel needs purchase.void on any open status', () => {
    const voider = { permissions: ['purchase.read', 'purchase.void'], isCreator: false };
    expect(purchaseActions('approved', voider)).toEqual(['cancel']);
    expect(purchaseActions('submitted', voider)).toEqual(['cancel']);
  });
});

describe('input checks mirror the database', () => {
  it.each([['10', true], ['0.5', true], ['1.000001', true], ['0', false], ['-1', false], ['1.0000001', false], ['abc', false]])(
    'quantity %s → %s', (text, ok) => expect(validPurchaseQuantity(text)).toBe(ok));
  it.each([['0', true], ['12.5', true], ['4.2345', true], ['4.23456', false], ['-1', false], ['NaN', false]])(
    'unit cost %s → %s', (text, ok) => expect(validUnitCost(text)).toBe(ok));
});
