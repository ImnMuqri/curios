import { PrismaClient } from '@prisma/client';

const globalForRead = globalThis as unknown as { prismaRead?: PrismaClient };

function create(): PrismaClient {
  const url = process.env.DATABASE_URL_READONLY;
  if (!url) throw new Error('DATABASE_URL_READONLY is not set');
  return new PrismaClient({ datasources: { db: { url } } });
}

function client(): PrismaClient {
  if (globalForRead.prismaRead) return globalForRead.prismaRead;
  // On globalThis, so `next dev` reloading this module does not open a new pool on every edit.
  globalForRead.prismaRead = create();
  return globalForRead.prismaRead;
}

/**
 * The read-only client, made on first use rather than when this module loads. `next build` loads
 * every route's code to collect its page data without reading anything, and the build machine
 * (Railway's included) has no database to point at: a client made at import failed that build on
 * a missing DATABASE_URL_READONLY. A read still fails, at once and by name, when the URL is unset.
 */
export const prismaRead = new Proxy({} as PrismaClient, {
  get(_target, property): unknown {
    const real = client();
    const value: unknown = Reflect.get(real, property, real);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});
