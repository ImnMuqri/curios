import { buildVersion } from '../../../lib/build-version.js';

// Per request: the running server's build, read at call time rather than frozen into the build.
export const dynamic = 'force-dynamic';

/** What the open dashboard asks to learn that a newer build is live (app/app/_ui/new-version.tsx). */
export function GET() {
  return Response.json({ version: buildVersion() }, { headers: { 'cache-control': 'no-store' } });
}
