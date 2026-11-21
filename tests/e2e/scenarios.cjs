/* End-to-end scenarios for the mobile / PWA upgrade. Run through run.cjs against the production build. */
const assert = require('node:assert/strict');
const { ORIGIN, BASE, ORG, BARCODE, openApp, overflowOf, seedLegacyOutbox, legacyDatabaseExists } = require('./harness.cjs');

const url = (path) => `${ORIGIN}${BASE}${path}`;
const bottomNav = (page) => page.getByRole('navigation', { name: /^(Primary navigation|التنقل الرئيسي)$/ });
const sidebar = (page) => page.locator('aside').first();

async function openPage(page, path) {
  await page.goto(url(path), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main h1, main h2', { timeout: 20000 });
}

async function waitOnline(page) {
  await page.getByRole('button', { name: /Connection: Online/ }).waitFor({ timeout: 20000 });
}

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('phone: bottom navigation, More sheet, Android back closes the sheet first', async () => {
  const { browser, page } = await openApp({ role: 'owner', viewport: { width: 390, height: 844 } });
  try {
    await openPage(page, '/dashboard/');
    assert.ok(await bottomNav(page).isVisible(), 'bottom navigation is visible on a phone');
    assert.equal(await sidebar(page).isVisible(), false, 'desktop sidebar is hidden on a phone');
    for (const label of ['Dashboard', 'Products', 'Inventory', 'POS / Sales', 'More']) {
      assert.ok(await bottomNav(page).getByText(label, { exact: true }).isVisible(), `tab ${label}`);
    }
    await bottomNav(page).getByRole('button', { name: 'More' }).click();
    const sheet = page.getByRole('dialog', { name: 'More' });
    await sheet.waitFor();
    // Back button: closes the sheet and stays on the same page.
    await page.goBack();
    await sheet.waitFor({ state: 'detached' });
    assert.ok(page.url().endsWith('/dashboard/'), `still on dashboard after back, got ${page.url()}`);
    // Open again and navigate from the sheet.
    await bottomNav(page).getByRole('button', { name: 'More' }).click();
    await page.getByRole('dialog', { name: 'More' }).getByRole('link', { name: 'Products', exact: true }).click();
    await page.waitForURL(/\/products\/$/);
    assert.ok(page.url().endsWith('/products/'));
    await page.goBack();
    await page.waitForURL(/\/dashboard\/$/, { timeout: 5000 });
  } finally {
    await browser.close();
  }
});

scenario('phone: a role without sales.read has no POS tab', async () => {
  const { browser, page } = await openApp({ role: 'storekeeper', viewport: { width: 390, height: 844 } });
  try {
    await openPage(page, '/dashboard/');
    assert.ok(await bottomNav(page).getByText('Products', { exact: true }).isVisible());
    assert.equal(await bottomNav(page).getByText('POS / Sales', { exact: true }).count(), 0);
  } finally {
    await browser.close();
  }
});

scenario('desktop: sidebar shows, bottom bar hidden, collapse works', async () => {
  const { browser, page } = await openApp({ role: 'owner', viewport: { width: 1440, height: 900 } });
  try {
    await openPage(page, '/dashboard/');
    assert.ok(await sidebar(page).isVisible());
    assert.equal(await bottomNav(page).isVisible(), false);
    const before = (await sidebar(page).boundingBox()).width;
    await sidebar(page).getByRole('button', { name: 'Collapse sidebar' }).click();
    await page.waitForTimeout(300);
    const after = (await sidebar(page).boundingBox()).width;
    assert.ok(after < before, `sidebar narrower after collapse (${before} → ${after})`);
  } finally {
    await browser.close();
  }
});

scenario('connection: indicator reports Online after the server check', async () => {
  const { browser, page } = await openApp({ role: 'owner', viewport: { width: 390, height: 844 } });
  try {
    await openPage(page, '/dashboard/');
    await waitOnline(page);
  } finally {
    await browser.close();
  }
});

scenario('offline: searching and recording are refused and nothing is sent', async () => {
  const { browser, page, recorded, context } = await openApp({ role: 'owner', viewport: { width: 1024, height: 800 } });
  try {
    await openPage(page, '/inventory/move/?type=stock_in');
    await waitOnline(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: /Connection: Offline/ }).waitFor({ timeout: 10000 });
    assert.ok(await page.getByText('You are offline.', { exact: false }).first().isVisible(), 'offline banner shown');
    await page.getByLabel('Barcode or SKU').fill(BARCODE);
    await page.getByLabel('Barcode or SKU').press('Enter');
    await page.getByText('Product search needs a connection to the server.').waitFor({ timeout: 10000 });
    assert.equal(recorded.length, 0, 'no movement was sent while offline');
    await context.setOffline(false);
    await waitOnline(page);
  } finally {
    await browser.close();
  }
});

scenario('offline: the product form Save button is disabled once the device goes offline', async () => {
  const { browser, page, recorded, context } = await openApp({ role: 'owner', viewport: { width: 1024, height: 800 } });
  try {
    // Open the form while online first, then go offline without reloading (a reload offline shows the offline page).
    await openPage(page, '/products/new/');
    await waitOnline(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: /Connection: Offline/ }).waitFor({ timeout: 10000 });
    assert.ok(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), 'product Save disabled offline');
    assert.equal(recorded.length, 0);
    await context.setOffline(false);
  } finally {
    await browser.close();
  }
});

scenario('offline: the supplier form Save button is disabled once the device goes offline', async () => {
  const { browser, page, recorded, context } = await openApp({ role: 'owner', viewport: { width: 1024, height: 800 } });
  try {
    await openPage(page, '/suppliers/new/');
    await waitOnline(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: /Connection: Offline/ }).waitFor({ timeout: 10000 });
    assert.ok(await page.getByRole('button', { name: 'Save supplier', exact: true }).isDisabled(), 'supplier Save disabled offline');
    assert.equal(recorded.length, 0);
    await context.setOffline(false);
  } finally {
    await browser.close();
  }
});

scenario('stock: a receipt is sent once with a client key, after the product is found on the server', async () => {
  const { browser, page, recorded } = await openApp({ role: 'owner', viewport: { width: 1440, height: 900 } });
  try {
    await openPage(page, '/inventory/move/?type=stock_in');
    await waitOnline(page);
    await page.getByLabel('Barcode or SKU').fill(BARCODE);
    await page.getByLabel('Barcode or SKU').press('Enter');
    await page.getByText('Claw hammer').first().waitFor({ timeout: 10000 });
    await page.getByLabel(/^Quantity/).fill('2');
    await page.getByLabel(/Cost per unit/).fill('25');
    await page.getByRole('button', { name: 'Record movement' }).click();
    await page.getByText('Movement recorded.').waitFor({ timeout: 10000 });
    assert.equal(recorded.length, 1);
    assert.match(recorded[0].client_id, /^[0-9a-f-]{36}$/);
    assert.equal(recorded[0].product_id, '50000000-0000-4000-8000-000000000001');
  } finally {
    await browser.close();
  }
});

scenario('POS on a phone: scan adds a line, review bar appears, checkout is refused offline', async () => {
  const { browser, page, context } = await openApp({ role: 'owner', viewport: { width: 390, height: 844 } });
  try {
    await openPage(page, '/pos/');
    await waitOnline(page);
    await page.getByRole('searchbox').fill(BARCODE);
    await page.getByRole('searchbox').press('Enter');
    await page.getByRole('button', { name: 'Review & pay' }).waitFor({ timeout: 10000 });
    await context.setOffline(true);
    await page.getByRole('button', { name: /Connection: Offline/ }).waitFor({ timeout: 10000 });
    await page.getByText('You are offline. Sales are saved only after the server confirms them.').waitFor({ timeout: 10000 });
    const checkout = page.getByRole('button', { name: /Complete sale/ });
    assert.ok(await checkout.isDisabled(), 'checkout disabled offline');
    await context.setOffline(false);
  } finally {
    await browser.close();
  }
});

scenario('PWA: service worker registers in production and serves manifest, icons and sign-in page', async () => {
  const { browser, page } = await openApp({ role: 'owner', viewport: { width: 390, height: 844 } });
  try {
    await page.goto(url('/login/'), { waitUntil: 'domcontentloaded' });
    const scope = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return reg.scope;
    });
    assert.ok(scope.endsWith('/hardware-store-erp/'), `scope ${scope}`);
    const manifest = await page.evaluate(async () => (await fetch('/hardware-store-erp/manifest.webmanifest')).json());
    assert.equal(manifest.name, 'Al Qureshi Hardware ERP Pro');
    assert.equal(manifest.display, 'standalone');
    for (const icon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
      const status = await page.evaluate(async (p) => (await fetch(p)).status, `/hardware-store-erp/icons/${icon}`);
      assert.equal(status, 200, icon);
    }
  } finally {
    await browser.close();
  }
});

scenario('PWA: offline navigation shows the offline page, and only static assets are cached', async () => {
  const { browser, page, context } = await openApp({ role: 'owner', viewport: { width: 390, height: 844 } });
  try {
    await page.goto(url('/login/'), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('erp-static-')), null, { timeout: 15000 });
    const cached = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((k) => k.startsWith('erp-static-'));
      const urls = [];
      for (const name of names) for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
      return urls;
    });
    assert.ok(cached.length > 0, 'something is cached');
    for (const p of cached) {
      const safe = p.startsWith('/hardware-store-erp/_next/static/') || /\/(offline\.html|manifest\.webmanifest|icons\/[a-z0-9-]+\.png)$/.test(p);
      assert.ok(safe, `unexpected cached path ${p}`);
    }
    await context.setOffline(true);
    await page.goto(url('/pos/'), { waitUntil: 'domcontentloaded' });
    assert.ok(await page.getByText('You are offline', { exact: false }).first().isVisible({ timeout: 10000 }), 'offline page shown');
    await context.setOffline(false);
  } finally {
    await browser.close();
  }
});

scenario('PWA: a new version waits, shows the update prompt, and activates only when the user chooses', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  if (!process.env.E2E_SITE) throw new Error('set E2E_SITE to the folder that serves the build (it contains hardware-store-erp/)');
  const swPath = path.join(process.env.E2E_SITE, 'hardware-store-erp', 'sw.js');
  const original = fs.readFileSync(swPath, 'utf8');
  const { browser, page } = await openApp({ role: 'owner', viewport: { width: 390, height: 844 } });
  try {
    await page.goto(url('/login/'), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    // A first visit is not controlled by its worker until the next load.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    // Serve a second worker version (a different cache name) from the copy on disk, then reload.
    fs.writeFileSync(swPath, original.replace(/var BUILD_ID = '[^']+';/, "var BUILD_ID = 'e2e-second-version';"));
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      const banner = page.getByRole('status').filter({ hasText: 'A new version is ready' });
      await banner.waitFor({ timeout: 20000 });
      // The new worker waits; the page is not reloaded until the user chooses.
      assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting), true, 'a worker is waiting');
      await page.evaluate(() => { window.__beforeUpdate = true; });
      await banner.getByRole('button', { name: 'Update now' }).click();
      await page.waitForFunction(() => window.__beforeUpdate === undefined, null, { timeout: 20000 });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
      assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting), false, 'nothing left waiting');
    } finally {
      fs.writeFileSync(swPath, original);
    }
  } finally {
    await browser.close();
  }
});

scenario('iPhone: More sheet explains how to add the app to the home screen', async () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const { browser, page } = await openApp({ role: 'owner', viewport: { width: 390, height: 844 }, userAgent: iphone });
  try {
    await openPage(page, '/dashboard/');
    await bottomNav(page).getByRole('button', { name: 'More' }).click();
    await page.getByText('On iPhone or iPad', { exact: false }).first().waitFor({ timeout: 10000 });
  } finally {
    await browser.close();
  }
});

scenario('legacy data: unsent changes are listed, sign-out asks first and keeps data on cancel', async () => {
  const { browser, page } = await openApp({ role: 'owner', viewport: { width: 1440, height: 900 } });
  try {
    await openPage(page, '/dashboard/');
    await seedLegacyOutbox(page, [{
      id: 'legacy-1', orgId: ORG, seq: 1, warehouseId: '70000000-0000-4000-8000-000000000001', factor: '1',
      payload: { clientId: 'legacy-1', warehouseId: '70000000-0000-4000-8000-000000000001', productId: '50000000-0000-4000-8000-000000000001', unitId: '10000000-0000-4000-8000-000000000001', movementType: 'stock_in', quantity: '3', unitCost: '5', reasonCode: null, note: null, reference: null, occurredAt: '2026-11-20T00:00:00Z' },
      status: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null, createdAt: '2026-11-20T00:00:00Z',
    }]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openPage(page, '/dashboard/');
    assert.ok(await page.getByText('unsent stock change', { exact: false }).first().isVisible({ timeout: 10000 }), 'banner shows unsent changes');
    await sidebar(page).getByRole('button', { name: 'Sign out' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sign out and delete local data?' });
    await dialog.waitFor();
    await dialog.getByText('still holds 1 item', { exact: false }).waitFor({ timeout: 10000 });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.ok(page.url().endsWith('/dashboard/'), 'still signed in after cancel');
    assert.equal(await legacyDatabaseExists(page), true, 'pending data kept after cancel');
    await sidebar(page).getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('dialog', { name: 'Sign out and delete local data?' }).getByRole('button', { name: 'Delete and sign out' }).click();
    await page.waitForURL(/\/login\/?$/, { timeout: 15000 });
    await page.waitForFunction(async () => !(await indexedDB.databases()).some((d) => d.name === 'erp-offline'), null, { timeout: 10000 });
  } finally {
    await browser.close();
  }
});

scenario('legacy data: when nothing is unsent, the old offline database is removed on load', async () => {
  const { browser, page } = await openApp({ role: 'owner', viewport: { width: 1440, height: 900 } });
  try {
    await openPage(page, '/dashboard/');
    await seedLegacyOutbox(page, [{ id: 'acked-1', orgId: ORG, seq: 1, warehouseId: 'w', factor: '1', payload: { movementType: 'stock_in', productId: 'p', quantity: '1' }, status: 'acked', attempts: 1, nextAttemptAt: 0, lastError: null, createdAt: '2026-11-20T00:00:00Z' }]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openPage(page, '/dashboard/');
    await page.waitForFunction(async () => !(await indexedDB.databases()).some((d) => d.name === 'erp-offline'), null, { timeout: 10000 });
    assert.equal(await page.getByText('unsent stock change', { exact: false }).count(), 0);
  } finally {
    await browser.close();
  }
});

scenario('Arabic on a phone: right-to-left, bottom tabs translated, no horizontal scroll at 320 px', async () => {
  const { browser, page } = await openApp({ role: 'owner', viewport: { width: 320, height: 700 }, locale: 'ar' });
  try {
    await openPage(page, '/dashboard/');
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    await bottomNav(page).getByText('المزيد', { exact: true }).waitFor({ timeout: 10000 });
    assert.equal((await overflowOf(page)).overflow, 0, 'no horizontal scroll');
  } finally {
    await browser.close();
  }
});

module.exports = { scenarios };
