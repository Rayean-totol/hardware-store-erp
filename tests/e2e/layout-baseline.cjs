const { openApp, overflowOf, ORIGIN, BASE } = require('./harness.cjs');
const PAGES = ['/dashboard/', '/products/', '/inventory/', '/pos/', '/suppliers/', '/warehouses/', '/purchase-orders/', '/team/'];
const WIDTHS = [320, 390, 430, 768, 1024, 1440];
(async () => {
  const rows = [];
  for (const w of WIDTHS) {
    const { browser, page } = await openApp({ role: 'owner', viewport: { width: w, height: 844 } });
    for (const p of PAGES) {
      await page.goto(`${ORIGIN}${BASE}${p}`, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(400);
      const o = await overflowOf(page);
      rows.push(`${w}\t${p}\tscroll=${o.scrollWidth}\tclient=${o.clientWidth}\t${o.overflow > 0 ? 'OVERFLOW ' + o.overflow + 'px' : 'ok'}`);
    }
    await browser.close();
  }
  console.log(rows.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
