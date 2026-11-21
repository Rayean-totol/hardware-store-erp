const { openApp, ORIGIN, BASE } = require('./harness.cjs');
(async () => {
  const { browser, page } = await openApp({ role: 'owner', viewport: { width: 390, height: 844 } });
  for (const p of ['/dashboard/', '/products/', '/pos/']) {
    await page.goto(`${ORIGIN}${BASE}${p}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => ({ url: location.pathname, h1: document.querySelector('h1,h2')?.textContent?.trim()?.slice(0, 60) ?? null, hasSignIn: !!document.querySelector('input[type=password]'), nav: document.querySelectorAll('nav a').length }));
    console.log(p, JSON.stringify(info));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
