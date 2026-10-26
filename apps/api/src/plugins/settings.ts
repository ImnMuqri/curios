import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createSettingsReader } from '@curios/db';

declare module 'fastify' {
  interface FastifyInstance {
    /** The admin's switches, limits, prices and banner, cached for 30 s; a writer calls `clear()` after it commits. */
    settings: ReturnType<typeof createSettingsReader>;
  }
}

export const settingsPlugin = fp(async (app: FastifyInstance) => {
  app.decorate('settings', createSettingsReader(app.prisma, { log: app.log }));
});
