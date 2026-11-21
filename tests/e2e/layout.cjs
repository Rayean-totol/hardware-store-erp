/* Overflow matrix: every signed-in page at phone, tablet and desktop widths. */
const { openApp, overflowOf, ORIGIN, BASE } = require('./harness.cjs');
const assert = require('node:assert/strict');

const PAGES = ['/dashboard/', '/products/', '/products/new/', '/inventory/', '/inventory/move/?type=stock_in', '/inventory/history/', '/products/import/', '/products/images/',
  '/pos/', '/warehouses/', '/team/', '/catalog/', '/labels/'];
const WIDTHS = [320, 390, 430, 600, 768, 1024, 1440];

const layoutScenarios = [{
  name: `layout: no horizontal scroll on ${PAGES.length} pages at ${WIDTHS.join(', ')} px`,
  fn: async () => {
    const failures = [];
    for (const width of WIDTHS) {
      const { browser, page } = await openApp({ role: 'owner', viewport: { width, height: 844 } });
      try {
        for (const p of PAGES) {
          await page.goto(`${ORIGIN}${BASE}${p}`, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('main', { timeout: 20000 });
          await page.waitForTimeout(250);
          const o = await overflowOf(page);
          if (o.overflow > 0) failures.push(`${width}px ${p} overflows by ${o.overflow}px`);
        }
      } finally {
        await browser.close();
      }
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  },
}];

module.exports = { layoutScenarios };
