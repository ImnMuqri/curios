import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createQueueMailer, type Mailer } from '../../lib/mailer.js';
import type { Fetcher } from './password.service.js';
import { requireSession } from '../../plugins/session.js';
import {
  findOrCreateAccountForGoogle,
  requestPasswordReset,
  resetPassword,
  signInWithPassword,
  signUpWithPassword,
  verifyEmail,
} from './auth.service.js';
import {
  beginGoogleSignIn,
  exchangeGoogleCode,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  type CodeExchange,
} from './oauth.service.js';
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
  /** Tests pass a stub so no request reaches Google's token endpoint. */
  exchange?: CodeExchange;
}

export const authRoutes: FastifyPluginAsyncZod<AuthRouteOptions> = async (app, options) => {
  const mailer = options.mailer ?? createQueueMailer(app.mailQueue);
  const fetcher = options.fetcher;
  const exchange = options.exchange;

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

  app.post(
    '/auth/verify-email',
    { schema: { body: z.object({ token: z.string().min(1).max(200) }) } },
    async (request, reply) => {
      await verifyEmail(app.prisma, request.body.token);
      return reply.send({ status: 'verified' });
    },
  );

  app.post(
    '/auth/forgot-password',
    { schema: { body: z.object({ email: z.string().email().max(320) }) } },
    async (request, reply) => {
      await requestPasswordReset({ prisma: app.prisma, mailer }, request.body.email);
      return reply.send({ status: 'check_your_email' });
    },
  );

  app.post(
    '/auth/reset-password',
    {
      schema: {
        body: z.object({ token: z.string().min(1).max(200), password: z.string().min(1).max(200) }),
      },
    },
    async (request, reply) => {
      await resetPassword(app.prisma, request.body, fetcher);
      return reply.send({ status: 'password_changed' });
    },
  );

  app.get('/auth/google', async (_request, reply) => {
    const { url, state, verifier } = beginGoogleSignIn();
    const options = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    };

    return reply
      .setCookie(OAUTH_STATE_COOKIE, state, options)
      .setCookie(OAUTH_VERIFIER_COOKIE, verifier, options)
      .redirect(url);
  });

  app.get(
    '/auth/google/callback',
    { schema: { querystring: z.object({ code: z.string().min(1), state: z.string().min(1) }) } },
    async (request, reply) => {
      const profile = await exchangeGoogleCode(
        {
          code: request.query.code,
          state: request.query.state,
          cookieState: request.cookies[OAUTH_STATE_COOKIE],
          verifier: request.cookies[OAUTH_VERIFIER_COOKIE] ?? '',
        },
        exchange,
      );

      const { accountId } = await findOrCreateAccountForGoogle(app.prisma, profile);
      const { value } = await createSession(app.prisma, accountId);

      return reply
        .clearCookie(OAUTH_STATE_COOKIE, { path: '/' })
        .clearCookie(OAUTH_VERIFIER_COOKIE, { path: '/' })
        .setCookie(SESSION_COOKIE, value, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: ABSOLUTE_TTL_MS / 1000,
          domain: process.env.COOKIE_DOMAIN,
        })
        .redirect(`${process.env.APP_URL ?? 'http://localhost:3000'}/app`);
    },
  );
};

/**
 * The two routes that carry no credential, kept out of the credential
 * limiters deliberately.
 *
 * Those limiters exist for credential stuffing -- many addresses from one
 * source, or one address from many. Neither shape applies here: /auth/me
 * proves nothing but a cookie the caller already holds, and /auth/logout
 * only destroys one. Sitting them behind a 20-per-15-minutes budget spends
 * it on ordinary browsing, because a dashboard checks the session on every
 * navigation, and signs people out for using the product.
 */
export const sessionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/auth/logout', async (request, reply) => {
    const value = request.cookies[SESSION_COOKIE];
    if (value) await revokeSession(app.prisma, value);

    return reply
      .clearCookie(SESSION_COOKIE, {
        path: '/',
        // Must match the attributes the cookie was set with. A clear with no
        // Domain does not replace one scoped to a domain, so in production the
        // browser would keep sending the old value.
        domain: process.env.COOKIE_DOMAIN,
      })
      .send({ status: 'signed_out' });
  });

  app.get('/auth/me', { preHandler: requireSession }, async (request) => ({
    accountId: request.account?.id,
  }));
};
