import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/db/**/*.test.ts', 'src/migrations/**/*.test.ts'],
    globalSetup: ['src/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
