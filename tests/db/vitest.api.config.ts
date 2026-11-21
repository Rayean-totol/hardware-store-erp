import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/api/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'src/api/pos-rpc.test.ts', 'src/api/suppliers-rpc.test.ts'],
    globalSetup: ['src/api-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
