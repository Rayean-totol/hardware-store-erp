import { describe, expect, it } from 'vitest';
import { isActiveRoute, mobilePrimaryTabs, type NavEntry } from '@/lib/navigation';

const entry = (key: string, show = true): NavEntry & { label: string } => ({ key, href: `/${key}/`, show, label: key });

describe('mobile primary tabs', () => {
  it('shows Dashboard, Products, Inventory and POS in that order, only where permitted', () => {
    const items = [entry('pos'), entry('team'), entry('inventory'), entry('products'), entry('dashboard')];
    expect(mobilePrimaryTabs(items).map((i) => i.key)).toEqual(['dashboard', 'products', 'inventory', 'pos']);
  });

  it('leaves out tabs the user cannot open (a cashier without catalog.read has no Products tab)', () => {
    const cashier = [entry('dashboard'), entry('products', false), entry('inventory'), entry('pos')];
    expect(mobilePrimaryTabs(cashier).map((i) => i.key)).toEqual(['dashboard', 'inventory', 'pos']);
  });

  it('never shows a tab for a module that is not in the list', () => {
    expect(mobilePrimaryTabs([entry('team')])).toEqual([]);
  });
});

describe('active route', () => {
  it('matches the section and its pages, not a different section with a similar name', () => {
    expect(isActiveRoute('/products/', '/products/')).toBe(true);
    expect(isActiveRoute('/products/edit/', '/products/')).toBe(true);
    expect(isActiveRoute('/products', '/products/')).toBe(true);
    expect(isActiveRoute('/products-archive/', '/products/')).toBe(false);
    expect(isActiveRoute('/dashboard/', '/products/')).toBe(false);
  });
});
