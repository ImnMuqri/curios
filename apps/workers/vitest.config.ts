import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../../vitest.setup.ts'],
    // extract.service.test.ts and lead.worker.test.ts both truncate the shared
    // "Account" table in beforeEach. Vitest runs files in a package in
    // parallel by default, and two files truncating the same table
    // concurrently wipe each other's fixtures mid-test. Same fix and same
    // reasoning as apps/api, which hit this first.
    fileParallelism: false,
  },
});
