import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api-int',
    environment: 'node',
    include: ['test/**/*.int.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
