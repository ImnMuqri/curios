import { PrismaClient } from '@prisma/client';

const globalForRead = globalThis as unknown as { prismaRead?: PrismaClient };

function create(): PrismaClient {
  const url = process.env.DATABASE_URL_READONLY;
  if (!url) throw new Error('DATABASE_URL_READONLY is not set');
  return new PrismaClient({ datasources: { db: { url } } });
}

export const prismaRead = globalForRead.prismaRead ?? create();

if (process.env.NODE_ENV !== 'production') globalForRead.prismaRead = prismaRead;
