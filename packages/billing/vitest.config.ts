import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../../vitest.setup.ts'],
    // grant.test.ts (Task 5) truncates the shared "Account" table. Files in one
    // package run in parallel by default, and two truncating the same table race.
    fileParallelism: false,
  },
});
