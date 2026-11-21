import { describe, expect, it } from 'vitest';
import { parseProductView, placeholderKindFor, productStatusKey } from '@/features/products/catalog-view';

describe('parseProductView', () => {
  it('defaults to the grid for missing or unknown values', () => {
    expect(parseProductView(null)).toBe('grid');
    expect(parseProductView(undefined)).toBe('grid');
    expect(parseProductView('')).toBe('grid');
    expect(parseProductView('table')).toBe('grid');
    expect(parseProductView('grid')).toBe('grid');
  });

  it('keeps an explicit list choice', () => {
    expect(parseProductView('list')).toBe('list');
  });
});

describe('placeholderKindFor', () => {
  it.each([
    ['Electrical', 'electrical'],
    ['Lighting', 'electrical'],
    ['Plumbing', 'plumbing'],
    ['Water Tap', 'plumbing'],
    ['Tools', 'tools'],
    ['Power Tools', 'tools'],
    ['Measuring Tape', 'tools'],
    ['Paints & Chemicals', 'paint'],
    ['Fasteners', 'fasteners'],
    ['Building Materials', 'building'],
    ['Safety & PPE', 'safety'],
    ['Hardware General', 'general'],
  ])('maps %s to %s', (name, kind) => {
    expect(placeholderKindFor(name)).toBe(kind);
  });

  it('falls back to the general placeholder without a category', () => {
    expect(placeholderKindFor(null)).toBe('general');
    expect(placeholderKindFor(undefined)).toBe('general');
    expect(placeholderKindFor('')).toBe('general');
  });
});

describe('productStatusKey', () => {
  it('reports archived only when archived_at is set', () => {
    expect(productStatusKey(null)).toBe('common.active');
    expect(productStatusKey('2026-11-20T00:00:00Z')).toBe('common.archived');
  });
});
