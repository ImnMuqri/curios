import type { NextConfig } from 'next';

// Next only ever loads .env* files from its own project directory (this one),
// never the monorepo root -- so DATABASE_URL_READONLY and NEXT_PUBLIC_API_URL
// are both invisible to `next dev`/`next build` by default. The fix lives in
// package.json's scripts (`node --env-file=../../.env ...`), not here: Next's
// dev server hands page rendering to a separate worker thread, which takes
// its own snapshot of process.env at creation time. Calling @next/env's
// loadEnvConfig() from this file only ever populates the env of whichever
// process parses next.config.ts, which is not reliably the same one that
// later serves a request -- confirmed by testing it directly, DB reads still
// failed with the root .env's values invisible to the render path. Setting
// the vars via node's own --env-file before Next starts at all avoids that
// race entirely, since every worker it spawns inherits process.env as it
// existed at that point.
const config: NextConfig = {
  // `next build` and the running `next dev` both write to .next, so a build can
  // break a dev server. Builds from agents and scripts set NEXT_DIST_DIR (to
  // .next-build) to keep out of its way; everyone else gets the default.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // The public page reads Postgres directly through the SELECT-only role, which
  // the edge runtime cannot do. Node everywhere, deliberately.
  serverExternalPackages: ['@prisma/client'],
  // packages/ui ships CSS Modules as source, which Next must compile rather
  // than treat as a pre-built dependency.
  transpilePackages: ['@curios/ui'],
  // Every package in this workspace (this file included) imports its sibling
  // TypeScript modules with a .js extension, per tsconfig.base.json's
  // verbatimModuleSyntax/Bundler resolution. Vitest/Vite resolve that pattern
  // out of the box; webpack does not unless told to also try .ts/.tsx for a
  // literal .js specifier.
  experimental: {
    // Inline the stylesheets into the HTML so no CSS request blocks the first
    // paint. They are small (about 15 KB for the landing page); measured on
    // the landing page, it removed Lighthouse's render-blocking finding.
    inlineCss: true,
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
    // How long a screen the dashboard's sidebar prefetched on hover may be shown as it was. The
    // default is five minutes, too long for an inbox; 30 seconds is the least Next allows. Any
    // change an owner makes calls router.refresh(), which drops these at once.
    staleTimes: { static: 30 },
  },
};

export default config;
