import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../../vitest.setup.ts'],
    // fact-embedding.test.ts truncates the shared "Account" table in
    // beforeEach and schema.test.ts truncates it too. Vitest runs a
    // package's test files in parallel by default, and two files truncating
    // the same table concurrently race each other. Same fix and same
    // reasoning as apps/api and packages/db-read.
    fileParallelism: false,
  },
});
