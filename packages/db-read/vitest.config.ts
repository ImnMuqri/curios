import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../../vitest.setup.ts', './vitest.setup.ts'],
    // page.query.test.ts truncates the shared "Account" table in beforeAll.
    // Vitest runs files in this package in parallel by default, and that
    // truncate races the inserts session.query.test.ts and
    // review.query.test.ts make in their own beforeAll, occasionally
    // deleting a row out from under them (FK violation). Same fix and same
    // reasoning as apps/api/vitest.config.ts.
    fileParallelism: false,
  },
});
