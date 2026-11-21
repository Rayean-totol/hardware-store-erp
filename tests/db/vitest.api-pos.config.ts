import { defineConfig } from 'vitest/config';

// The POS API test commits sales and stock, so it gets its own disposable database and PostgREST.
process.env.TEST_PG_DATABASE ??= 'erp_test_api_pos';

export default defineConfig({
  test: {
    include: ['src/api/pos-rpc.test.ts'],
    globalSetup: ['src/api-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
