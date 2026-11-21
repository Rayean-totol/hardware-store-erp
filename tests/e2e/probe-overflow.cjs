const { openApp, ORIGIN, BASE } = require('./harness.cjs');
(async () => {
  const path = process.argv[2] || '/dashboard/';
  const { browser, page } = await openApp({ role: 'owner', viewport: { width: 320, height: 844 } });
  await page.goto(`${ORIGIN}${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(500);
  const culprits = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 0.5 && r.width > 0) {
        out.push({ tag: el.tagName.toLowerCase(), cls: (el.className?.toString() || '').slice(0, 120), right: Math.round(r.right), width: Math.round(r.width), text: (el.textContent || '').trim().slice(0, 40) });
      }
    }
    return out.slice(0, 12);
  });
  console.log(JSON.stringify(culprits, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
