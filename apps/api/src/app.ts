import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { errorsPlugin } from './plugins/errors.js';
import { prismaPlugin } from './plugins/prisma.js';
import { queuePlugin } from './plugins/queue.js';
import { ingestRoutes } from './modules/ingest/ingest.routes.js';

export async function buildApp() {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie, { secret: process.env.SESSION_SECRET ?? 'dev-secret' });
  await app.register(errorsPlugin);
  await app.register(prismaPlugin);
  await app.register(queuePlugin);

  app.get('/health', async () => ({ ok: true }));

  await app.register(ingestRoutes);

  return app;
}
