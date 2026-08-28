import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../../vitest.setup.ts'],
    // Both test files here truncate the shared "Account" table in beforeEach.
    // Vitest runs files in this package in parallel by default, and two files
    // truncating the same table concurrently race each other. Run them one
    // at a time instead, same reasoning as the workspace `--concurrency=1`.
    fileParallelism: false,
  },
});
