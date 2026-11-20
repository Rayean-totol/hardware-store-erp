import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/db/**/*.test.ts', 'src/migrations/**/*.test.ts'],
    // Committed-transaction concurrency tests run in their own database (see vitest.concurrency.config.ts).
    exclude: [...configDefaults.exclude, 'src/db/pos-concurrency.test.ts'],
    globalSetup: ['src/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
