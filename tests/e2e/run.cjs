/* Runs every scenario in scenarios.cjs and layout.cjs, prints PASS/FAIL and writes a JSON report. */
const fs = require('node:fs');
const path = require('node:path');
const { scenarios } = require('./scenarios.cjs');
const { layoutScenarios } = require('./layout.cjs');

(async () => {
  const all = [...scenarios, ...layoutScenarios];
  const only = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
  const results = [];
  for (const s of all) {
    if (only && !only.test(s.name)) continue;
    const started = Date.now();
    try {
      await s.fn();
      results.push({ name: s.name, status: 'passed', ms: Date.now() - started });
      console.log(`PASS  ${s.name} (${Date.now() - started} ms)`);
    } catch (error) {
      results.push({ name: s.name, status: 'failed', ms: Date.now() - started, error: String(error && error.message || error).split('\n').slice(0, 6).join(' | ') });
      console.log(`FAIL  ${s.name}\n      ${String(error && error.message || error).split('\n').slice(0, 4).join('\n      ')}`);
    }
  }
  const passed = results.filter((r) => r.status === 'passed').length;
  console.log(`\n${passed}/${results.length} end-to-end scenarios passed`);
  const out = process.env.E2E_REPORT || path.join(__dirname, 'e2e-report.json');
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
})();
