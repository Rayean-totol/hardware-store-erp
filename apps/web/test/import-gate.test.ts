import type { ImportPlan } from '@erp/domain';
import { describe, expect, it } from 'vitest';
import { importBlockReason } from '@/features/products/import-gate';

const row = (action: 'create' | 'update' | 'invalid') => ({
  sku: `DEMO-${action}`, firstLine: 2, action, draft: null, existing: null, issues: [], warnings: [],
});
const plan = (products: ReturnType<typeof row>[], fatal: ImportPlan['fatal'] = []): ImportPlan => ({
  fatal,
  products,
  counts: {
    create: products.filter((p) => p.action === 'create').length,
    update: products.filter((p) => p.action === 'update').length,
    invalid: products.filter((p) => p.action === 'invalid').length,
  },
});

describe('product import gate', () => {
  it('allows a clean plan of creates', () => {
    expect(importBlockReason(plan([row('create'), row('create')]))).toBeNull();
  });

  it('allows a clean plan of updates', () => {
    expect(importBlockReason(plan([row('update')]))).toBeNull();
  });

  it('blocks a plan with even one invalid record, even when most rows are valid', () => {
    const p = plan([...Array.from({ length: 9 }, () => row('create')), row('invalid')]);
    expect(p.counts.create).toBe(9);
    expect(importBlockReason(p)).toBe('invalid');
  });

  it('blocks when the summary count says zero but a row is still invalid (both checks)', () => {
    const p = plan([row('create'), row('invalid')]);
    p.counts.invalid = 0;
    expect(importBlockReason(p)).toBe('invalid');
  });

  it('blocks a file with fatal problems', () => {
    expect(importBlockReason(plan([row('create')], [{ line: 1, path: 'sku', code: 'missing' }]))).toBe('fatal');
  });

  it('blocks when there is no plan yet, and when there is nothing to import', () => {
    expect(importBlockReason(null)).toBe('no_plan');
    expect(importBlockReason(plan([]))).toBe('nothing');
  });
});
