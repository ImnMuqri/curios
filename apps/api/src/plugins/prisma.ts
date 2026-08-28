import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { prisma, type PrismaClient } from '@curios/db';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export const prismaPlugin = fp(async (app: FastifyInstance) => {
  app.decorate('prisma', prisma);
  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});
