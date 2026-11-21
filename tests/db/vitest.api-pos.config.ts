import { defineConfig } from 'vitest/config';

// The POS and supplier API tests commit rows, so they get their own disposable database and PostgREST.
process.env.TEST_PG_DATABASE ??= 'erp_test_api_pos';

export default defineConfig({
  test: {
    include: ['src/api/pos-rpc.test.ts', 'src/api/suppliers-rpc.test.ts'],
    globalSetup: ['src/api-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
