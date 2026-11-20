import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/api/**/*.test.ts'],
    globalSetup: ['src/api-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
