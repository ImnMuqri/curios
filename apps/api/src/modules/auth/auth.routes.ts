import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createMailer, type Mailer } from '../../lib/mailer.js';
import type { Fetcher } from './password.service.js';
import { requireSession } from '../../plugins/session.js';
import { signInWithPassword, signUpWithPassword } from './auth.service.js';
import {
  ABSOLUTE_TTL_MS,
  createSession,
  revokeSession,
  SESSION_COOKIE,
} from './session.service.js';

const credentials = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

export interface AuthRouteOptions {
  /** Tests pass a recording mailer; production leaves it undefined. */
  mailer?: Mailer;
  /** Tests pass a stub so no request reaches Have I Been Pwned. */
  fetcher?: Fetcher;
}

export const authRoutes: FastifyPluginAsyncZod<AuthRouteOptions> = async (app, options) => {
  const mailer = options.mailer ?? createMailer();
  const fetcher = options.fetcher;

  app.post('/auth/signup', { schema: { body: credentials } }, async (request, reply) => {
    await signUpWithPassword({ prisma: app.prisma, mailer, fetcher }, request.body);
    // 202, not 200: the account is not usable until the address is confirmed.
    return reply.status(202).send({ status: 'check_your_email' });
  });

  app.post('/auth/login', { schema: { body: credentials } }, async (request, reply) => {
    const { accountId } = await signInWithPassword(app.prisma, request.body);
    const { value } = await createSession(app.prisma, accountId);

    return reply
      .setCookie(SESSION_COOKIE, value, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: ABSOLUTE_TTL_MS / 1000,
        domain: process.env.COOKIE_DOMAIN,
      })
      .send({ accountId });
  });

  app.post('/auth/logout', async (request, reply) => {
    const value = request.cookies[SESSION_COOKIE];
    if (value) await revokeSession(app.prisma, value);

    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ status: 'signed_out' });
  });

  app.get('/auth/me', { preHandler: requireSession }, async (request) => ({
    accountId: request.account?.id,
  }));
};
