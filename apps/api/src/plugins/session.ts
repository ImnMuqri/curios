import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { SESSION_COOKIE, validateSession } from '../modules/auth/session.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    account: { id: string } | null;
  }
}

export class UnauthenticatedError extends Error {
  readonly statusCode = 401;
  readonly code = 'UNAUTHENTICATED';

  constructor() {
    super('Sign in to continue.');
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Resolves the session for every request and leaves the decision to the route.
 *
 * Resolving is not authorising: a populated `request.account` means a cookie
 * checked out, nothing more. A route that needs an owner says so with
 * `requireSession`, so an unprotected route is visibly unprotected rather than
 * protected by an accident of hook ordering.
 */
export const sessionPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('account', null);

  app.addHook('onRequest', async (request) => {
    const value = request.cookies[SESSION_COOKIE];
    if (!value) return;

    const session = await validateSession(app.prisma, value);
    if (session) request.account = { id: session.accountId };
  });
});

export async function requireSession(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.account) throw new UnauthenticatedError();
}
