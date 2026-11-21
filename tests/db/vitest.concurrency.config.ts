import { defineConfig } from 'vitest/config';

// These tests COMMIT rows (real concurrency needs committed transactions). They get a separate
// disposable database, so the committed data cannot change the counts asserted by the other suites.
process.env.TEST_PG_DATABASE ??= 'erp_test_concurrency';

export default defineConfig({
  test: {
    include: ['src/db/pos-concurrency.test.ts', 'src/db/suppliers-concurrency.test.ts', 'src/db/purchase-orders-concurrency.test.ts'],
    globalSetup: ['src/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
