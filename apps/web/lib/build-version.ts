import { readFileSync } from 'node:fs';
import path from 'node:path';

let cached: string | undefined;

/**
 * Which build is running: Next's own build id, the one `next build` writes to <distDir>/BUILD_ID.
 *
 * It is the right source for the standalone image (Dockerfile.web): the file is part of the traced
 * output and sits at the server's working directory (/app/apps/web/.next), so no environment
 * variable has to be plumbed through turbo or Railway, and it changes with every build, which a
 * deploy is. Under `next dev`, in tests, or with no build on disk it is "development", which the
 * new-version toast treats as "never ask". Read once per process: a deploy starts a new one.
 */
export function buildVersion(): string {
  if (cached !== undefined) return cached;
  let version = 'development';
  if (process.env.NODE_ENV === 'production') {
    try {
      const id = readFileSync(path.join(process.cwd(), process.env.NEXT_DIST_DIR ?? '.next', 'BUILD_ID'), 'utf8').trim();
      if (id) version = id;
    } catch {
      // Not a built server: keep "development".
    }
  }
  cached = version;
  return version;
}
