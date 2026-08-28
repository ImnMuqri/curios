import { join } from 'node:path';
import { config } from 'dotenv';

// Loaded by every package's vitest.config.ts. The path is resolved from this
// file's own location, not the cwd, because each package runs vitest from its
// own directory.
config({ path: join(import.meta.dirname, '.env') });
