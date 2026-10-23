import type { NextConfig } from 'next';

// Env comes from package.json's `node --env-file=../../.env` (see apps/web/next.config.ts
// for why it cannot be loaded from here).
const config: NextConfig = {
  // Builds from agents and scripts set NEXT_DIST_DIR so they stay out of a running dev server's way.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  serverExternalPackages: ['@prisma/client'],
  transpilePackages: [],
  // Sibling modules are imported with a .js extension; webpack needs telling to try .ts/.tsx.
  experimental: {
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
};

export default config;
