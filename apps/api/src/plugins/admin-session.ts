import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ADMIN_COOKIE } from '@curios/core';
import { validateAdminSession } from '../modules/admin/admin-session.service.js';
import { UnauthenticatedError } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    admin: { id: string; name: string } | null;
  }
}

/**
 * The admin twin of `sessionPlugin`: resolves `curios_admin` and nothing else,
 * and leaves the decision to `requireAdmin`. It never reads `curios_session`,
 * and the owner plugin never reads this cookie, so neither credential opens
 * the other's routes.
 */
export const adminSessionPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('admin', null);

  app.addHook('onRequest', async (request) => {
    const value = request.cookies[ADMIN_COOKIE];
    if (!value) return;

    const session = await validateAdminSession(app.prisma, value);
    if (session) request.admin = { id: session.adminUserId, name: session.name };
  });
});

export async function requireAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.admin) throw new UnauthenticatedError();
}
