import type { NextConfig } from 'next';

const config: NextConfig = {
  // The public page reads Postgres directly through the SELECT-only role, which
  // the edge runtime cannot do. Node everywhere, deliberately.
  serverExternalPackages: ['@prisma/client'],
  // Every package in this workspace (this file included) imports its sibling
  // TypeScript modules with a .js extension, per tsconfig.base.json's
  // verbatimModuleSyntax/Bundler resolution. Vitest/Vite resolve that pattern
  // out of the box; webpack does not unless told to also try .ts/.tsx for a
  // literal .js specifier.
  experimental: {
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
};

export default config;
