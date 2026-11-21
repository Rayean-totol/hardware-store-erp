/**
 * Browser harness for the built static app. Supabase calls are answered from fixed FIXTURES so the
 * authenticated screens can render without a real account. No real business data is used or changed.
 * Requires Playwright (the sandbox provides it; see docs/pwa-mobile-upgrade.md).
 */
const { chromium } = require('playwright');

const ORIGIN = process.env.E2E_ORIGIN || 'http://127.0.0.1:4173';
const BASE = '/hardware-store-erp';
const SUPABASE = 'https://example.supabase.co';
const ORG = '00000000-0000-4000-8000-000000000001';
const BRANCH = '80000000-0000-4000-8000-000000000001';
const USER_ID = 'a0000000-0000-4000-8000-000000000001';

// Permissions per role, as granted by the database role matrix (subset used by the navigation).
const ROLE_PERMISSIONS = {
  owner: ['org.manage', 'branch.manage', 'users.manage', 'audit.read', 'catalog.read', 'catalog.write', 'catalog.price_write', 'catalog.archive',
    'warehouse.manage', 'inventory.read', 'inventory.move', 'inventory.adjust', 'sales.read', 'sales.create', 'sales.discount', 'sales.price_override',
    'sales.credit', 'sales.void', 'customers.manage', 'suppliers.read', 'suppliers.manage', 'suppliers.adjust', 'purchase.read', 'purchase.create',
    'purchase.approve', 'purchase.void', 'purchase.cost_view'],
  cashier: ['catalog.read', 'inventory.read', 'sales.read', 'sales.create'],
  storekeeper: ['catalog.read', 'catalog.write', 'inventory.read', 'inventory.move', 'suppliers.read', 'purchase.read'],
};

const EMPTY_PAGE = { items: [], total: 0, limit: 50, offset: 0 };
const DASHBOARD = { stock_value: '0.00', stock_positions: 0, out_of_stock_count: 0, low_stock_count: 0, product_count: 0 };

function context(role) {
  return {
    user_id: USER_ID,
    memberships: [{
      membership_id: 'm1', org_id: ORG, org_name_en: 'Al Qureshi Hardware', org_name_ar: 'القرشي للأدوات',
      prices_include_vat: true, role, all_branches: role === 'owner',
      permissions: ROLE_PERMISSIONS[role] ?? [],
      branches: [{ id: BRANCH, code: 'RUH', name_en: 'Riyadh', name_ar: 'الرياض' }],
    }],
  };
}

const WAREHOUSE = { id: '70000000-0000-4000-8000-000000000001', branch_id: BRANCH, code: 'RUH', name_en: 'Riyadh', name_ar: 'الرياض', name_bn: null, is_active: true, row_version: 1 };

function rpcAnswer(name) {
  switch (name) {
    case 'get_my_context': return null; // filled per role
    case 'dashboard_inventory_summary': return DASHBOARD;
    case 'list_suppliers': case 'list_purchase_orders': return EMPTY_PAGE;
    case 'search_products': return [];
    case 'list_low_stock': case 'list_stock_levels': case 'list_stock_movements': return [];
    default: return [];
  }
}

function tableAnswer(table) {
  if (table === 'warehouses') return [WAREHOUSE];
  return [];
}

/** Opens a page as the given role. `offline` can be toggled later with setOffline(). */
async function openApp({ role = 'owner', viewport = { width: 390, height: 844 }, locale = 'en', colorScheme = 'dark' } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const context_ = await browser.newContext({ viewport, locale: locale === 'ar' ? 'ar-SA' : 'en-US', colorScheme, isMobile: viewport.width < 600, hasTouch: viewport.width < 900 });
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: 'e2e-access', token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'e2e-refresh',
    user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' } };
  await context_.addInitScript(([key, value, loc]) => {
    try {
      if (!sessionStorage.getItem('e2e-seeded')) {
        localStorage.setItem(key, value);
        localStorage.setItem('erp.locale', loc);
        sessionStorage.setItem('e2e-seeded', '1');
      }
    } catch { /* storage unavailable */ }
  }, ['sb-example-auth-token', JSON.stringify(session), locale]);
  await context_.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    let body;
    if (url.pathname === '/auth/v1/user') body = session.user;
    else if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.replace('/rest/v1/rpc/', '');
      body = name === 'get_my_context' ? context(role) : rpcAnswer(name);
    } else if (url.pathname.startsWith('/rest/v1/')) {
      body = tableAnswer(url.pathname.replace('/rest/v1/', ''));
    } else body = {};
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  });
  const page = await context_.newPage();
  return { browser, context: context_, page };
}

/** Horizontal overflow in CSS pixels: how much wider the page is than the viewport. */
async function overflowOf(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overflow: Math.max(0, doc.scrollWidth - doc.clientWidth) };
  });
}

module.exports = { chromium, ORIGIN, BASE, openApp, overflowOf, ROLE_PERMISSIONS };
