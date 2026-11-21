/**
 * Browser harness for the built static app. Supabase calls are answered from FIXTURES (clearly fake
 * data, see "fixture" below) so authenticated screens can render without a real account. Writes are
 * recorded in memory and never reach any database. No real business data is used.
 * Requires Playwright; the sandbox provides it at /opt/pw-browsers/chromium.
 */
const { chromium } = require('playwright');

const ORIGIN = process.env.E2E_ORIGIN || 'http://127.0.0.1:4173';
const BASE = '/hardware-store-erp';
const SUPABASE = 'https://example.supabase.co';
const ORG = '00000000-0000-4000-8000-000000000001';
const BRANCH = '80000000-0000-4000-8000-000000000001';
const USER_ID = 'a0000000-0000-4000-8000-000000000001';
const WH = '70000000-0000-4000-8000-000000000001';
const PCS = '10000000-0000-4000-8000-000000000001';
const HAMMER_ID = '50000000-0000-4000-8000-000000000001';
const BARCODE = '2000000100104';

// fixture: FAKE product and stock used only by these tests.
const FIXTURE_PRODUCT = {
  id: HAMMER_ID, org_id: ORG, sku: 'TLS-HAM-16', name_en: 'Claw hammer', name_ar: 'مطرقة مخلب', name_bn: null,
  description: null, category_id: null, brand_id: null, product_type: 'stock', base_unit_id: PCS, tax_category: 'S',
  tax_exemption_reason_code: null, reorder_level: null, archived_at: null, image_path: null,
  updated_at: '2026-11-20T00:00:00Z', row_version: 3,
  product_units: [{ id: '60000000-0000-4000-8000-000000000001', unit_id: PCS, factor: '1.000000', is_base: true, barcode: BARCODE, sale_price: '35.0000', is_sale_unit: true, is_purchase_unit: true }],
};
const FIXTURE_UNIT = { id: PCS, org_id: null, code: 'pcs', name_en: 'Piece', name_ar: 'حبة', name_bn: null, dimension: 'count', ratio_to_dimension_base: '1', allow_fraction: false, decimal_places: 0, is_active: true };
const FIXTURE_WAREHOUSE = { id: WH, branch_id: BRANCH, code: 'RUH', name_en: 'Riyadh', name_ar: 'الرياض', name_bn: null, is_active: true, row_version: 1 };

const ROLE_PERMISSIONS = {
  owner: ['org.manage', 'branch.manage', 'users.manage', 'audit.read', 'catalog.read', 'catalog.write', 'catalog.price_write', 'catalog.archive',
    'warehouse.manage', 'inventory.read', 'inventory.move', 'inventory.adjust', 'sales.read', 'sales.create', 'sales.discount', 'sales.price_override',
    'sales.credit', 'sales.void', 'customers.manage', 'suppliers.read', 'suppliers.manage', 'suppliers.adjust', 'purchase.read', 'purchase.create',
    'purchase.approve', 'purchase.void', 'purchase.cost_view'],
  cashier: ['catalog.read', 'inventory.read', 'sales.read', 'sales.create'],
  storekeeper: ['catalog.read', 'catalog.write', 'inventory.read', 'inventory.move', 'suppliers.read', 'purchase.read'],
};

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

function rpcAnswer(name, body, recorded) {
  switch (name) {
    case 'dashboard_inventory_summary': return { stock_value: '0.00', stock_positions: 1, out_of_stock_count: 0, low_stock_count: 0, product_count: 1 };
    case 'search_products': {
      const q = (body.p_query || '').toLowerCase();
      const hit = !q || FIXTURE_PRODUCT.sku.toLowerCase().includes(q) || FIXTURE_PRODUCT.name_en.toLowerCase().includes(q)
        || FIXTURE_PRODUCT.product_units.some((u) => u.barcode === body.p_query);
      return hit ? [FIXTURE_PRODUCT] : [];
    }
    case 'list_stock_levels': return [{ product_id: HAMMER_ID, sku: FIXTURE_PRODUCT.sku, name_en: FIXTURE_PRODUCT.name_en, name_ar: FIXTURE_PRODUCT.name_ar, name_bn: null, base_unit_id: PCS, quantity: '10', average_cost: '20', reorder_level: null, last_movement_at: null, is_low: false }];
    case 'apply_stock_movements': {
      recorded.push(...body.p_movements);
      return body.p_movements.map((m) => ({ client_id: m.client_id, status: 'applied', movement_id: 'mv-fixture', balance_after: '12', average_cost_after: '20', warnings: [] }));
    }
    case 'list_stock_movements': return [];
    default: return [];
  }
}

/** Opens the app as a role. Returns { browser, context, page, recorded } where `recorded` lists every write sent. */
async function openApp({ role = 'owner', viewport = { width: 390, height: 844 }, locale = 'en', userAgent, colorScheme = 'dark' } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport, locale: locale === 'ar' ? 'ar-SA' : 'en-US', colorScheme,
    isMobile: viewport.width < 600, hasTouch: viewport.width < 900, ...(userAgent ? { userAgent } : {}),
    serviceWorkers: 'allow',
  });
  const recorded = [];
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: 'e2e-access', token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'e2e-refresh',
    user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' } };
  await ctx.addInitScript(([key, value, loc]) => {
    try {
      if (!sessionStorage.getItem('e2e-seeded')) {
        localStorage.setItem(key, value);
        localStorage.setItem('erp.locale', loc);
        sessionStorage.setItem('e2e-seeded', '1');
      }
    } catch { /* storage unavailable */ }
  }, ['sb-example-auth-token', JSON.stringify(session), locale]);
  await ctx.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    let body;
    const payload = req.postDataJSON?.() ?? {};
    if (url.pathname === '/auth/v1/user') body = session.user;
    else if (url.pathname === '/auth/v1/health') body = { status: 'ok' };
    else if (url.pathname === '/auth/v1/logout') body = {};
    else if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.replace('/rest/v1/rpc/', '');
      body = name === 'get_my_context' ? context(role) : rpcAnswer(name, payload, recorded);
    } else if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.replace('/rest/v1/', '');
      body = table === 'warehouses' ? [FIXTURE_WAREHOUSE] : table === 'units' ? [FIXTURE_UNIT] : table === 'organizations' ? [{ allow_negative_stock: true }] : [];
    } else body = {};
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  });
  const page = await ctx.newPage();
  return { browser, context: ctx, page, recorded };
}

/** Horizontal overflow in CSS pixels: how much wider the page is than the viewport. */
async function overflowOf(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overflow: Math.max(0, doc.scrollWidth - doc.clientWidth) };
  });
}

/** Creates the legacy offline database the earlier build used, with the given outbox rows (test data only). */
async function seedLegacyOutbox(page, rows) {
  await page.evaluate((entries) => new Promise((resolve, reject) => {
    const open = indexedDB.open('erp-offline', 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
      outbox.createIndex('byOrg', 'orgId');
      db.createObjectStore('cache');
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('outbox', 'readwrite');
      for (const e of entries) tx.objectStore('outbox').put(e);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  }), rows);
}

async function legacyDatabaseExists(page) {
  return page.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'erp-offline'));
}

module.exports = { ORIGIN, BASE, ORG, BARCODE, HAMMER_ID, openApp, overflowOf, seedLegacyOutbox, legacyDatabaseExists, ROLE_PERMISSIONS };
