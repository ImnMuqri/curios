import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The root setup loads .env, the same way every other package does.
    setupFiles: ['../../vitest.setup.ts'],
  },
});
