import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createQueueMailer, type Mailer } from '../../lib/mailer.js';
import type { Fetcher } from './password.service.js';
import { requireSession, UnauthenticatedError } from '../../plugins/session.js';
import { DOMAIN_ERROR_CODES } from '../../plugins/errors.js';
import {
  addPassword,
  findOrCreateAccountForGoogle,
  linkGoogleIdentity,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  signInWithPassword,
  signUpWithPassword,
  verifyEmail,
} from './auth.service.js';
import {
  beginGoogleSignIn,
  exchangeGoogleCode,
  OAUTH_LINK_COOKIE,
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

const token = z.string().min(1).max(200);

export interface AuthRouteOptions {
  /** Tests pass a recording mailer; production leaves it undefined. */
  mailer?: Mailer;
  /** Tests pass a stub so no request reaches Have I Been Pwned. */
  fetcher?: Fetcher;
  /** Tests pass a stub so no request reaches Google's token endpoint. */
  exchange?: CodeExchange;
}

const sessionCookie = (value: string) =>
  ({
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ABSOLUTE_TTL_MS / 1000,
    domain: process.env.COOKIE_DOMAIN,
    value,
  }) as const;

/**
 * Turns a thrown error into the lower-cased, underscored code the callback's
 * redirect carries in its query string -- C2.
 *
 * Reuses `errorsPlugin`'s own `DOMAIN_ERROR_CODES` rather than keeping a
 * second, hand-maintained allow-list here. There used to be one -- this
 * function's previous body had its own `CALLBACK_ERROR_CODES` set -- and it
 * disagreed with `errorsPlugin` about `OAUTH_EXCHANGE_FAILED`, which is how a
 * deliberate 502 server fault ended up reading as a specific, reassuring
 * "try again in a moment".
 *
 * The `statusCode < 500` check is what makes that mistake structurally
 * harder to repeat: `OAuthExchangeError` (oauth.service.ts) is a 502 by
 * design, precisely so a misconfigured client secret or redirect URI is
 * logged and surfaced generically instead of dressed up as something the
 * user can fix by trying again. `DOMAIN_ERROR_CODES` doesn't encode status
 * codes at all, so without this check any *future* code added there with a
 * 5xx status would leak the same way `OAUTH_EXCHANGE_FAILED` did. Everything
 * that fails either test -- a 5xx, an unlisted code, a raw Prisma code, a
 * thrown string -- becomes `internal_error`.
 */
function callbackErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  const isClientFacing =
    typeof code === 'string' &&
    DOMAIN_ERROR_CODES.has(code) &&
    typeof statusCode === 'number' &&
    statusCode < 500;

  return isClientFacing ? code.toLowerCase() : 'internal_error';
}

/**
 * The routes that carry an email address in their body.
 *
 * Kept separate from `authFlowRoutes` because only these can be limited per
 * address. The per-email limiter falls back to the caller's address when the
 * body has no email, which on a bodyless route silently becomes a second and
 * stricter per-IP limiter -- half the intended budget, shared by everyone
 * behind one NAT. So the limiter is registered over these routes only, and
 * app.ts is where that split is applied.
 */
export const authRoutes: FastifyPluginAsyncZod<AuthRouteOptions> = async (app, options) => {
  const mailer = options.mailer ?? createQueueMailer(app.mailQueue);
  const fetcher = options.fetcher;

  app.post('/auth/signup', { schema: { body: credentials } }, async (request, reply) => {
    await signUpWithPassword({ prisma: app.prisma, mailer, fetcher }, request.body);
    // 202, not 200: the account is not usable until the address is confirmed.
    return reply.status(202).send({ status: 'check_your_email' });
  });

  app.post('/auth/login', { schema: { body: credentials } }, async (request, reply) => {
    const { accountId } = await signInWithPassword(app.prisma, request.body);
    const { value, ...cookie } = sessionCookie((await createSession(app.prisma, accountId)).value);

    return reply.setCookie(SESSION_COOKIE, value, cookie).send({ accountId });
  });

  app.post(
    '/auth/forgot-password',
    { schema: { body: z.object({ email: z.string().email().max(320) }) } },
    async (request, reply) => {
      await requestPasswordReset({ prisma: app.prisma, mailer }, request.body.email);
      return reply.send({ status: 'check_your_email' });
    },
  );
};

/**
 * The routes reached by following something rather than by submitting an
 * address: a link from an inbox, or a redirect from Google.
 *
 * None of them carries an email, so the per-email limiter has nothing to key
 * on and is deliberately not registered over them -- see `authRoutes` above.
 * The per-IP limiter still applies, and it is the right one here: what these
 * routes accept is a one-time secret, and guessing a 43-character token or an
 * unguessable state value is not the attack a per-address budget defends.
 */
export const authFlowRoutes: FastifyPluginAsyncZod<AuthRouteOptions> = async (app, options) => {
  const mailer = options.mailer ?? createQueueMailer(app.mailQueue);
  const fetcher = options.fetcher;
  const exchange = options.exchange;

  app.post(
    '/auth/verify-email',
    { schema: { body: z.object({ token }) } },
    async (request, reply) => {
      await verifyEmail(app.prisma, request.body.token);
      return reply.send({ status: 'verified' });
    },
  );

  app.post(
    '/auth/verify-email/resend',
    { schema: { body: z.object({ token }) } },
    async (request, reply) => {
      await resendVerification({ prisma: app.prisma, mailer }, request.body.token);
      return reply.send({ status: 'check_your_email' });
    },
  );

  app.post(
    '/auth/reset-password',
    { schema: { body: z.object({ token, password: z.string().min(1).max(200) }) } },
    async (request, reply) => {
      const { accountId } = await resetPassword(app.prisma, request.body, fetcher);
      // Every other session has just ended; this device, which proved the
      // inbox, stays signed in ("You'll stay signed in on this device").
      const { value, ...cookie } = sessionCookie((await createSession(app.prisma, accountId)).value);
      return reply.setCookie(SESSION_COOKIE, value, cookie).send({ status: 'password_changed' });
    },
  );

  app.post(
    '/auth/password',
    { schema: { body: z.object({ password: z.string().min(1).max(200) }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await addPassword({ prisma: app.prisma, fetcher }, request.account.id, request.body.password);
      return reply.send({ status: 'password_set' });
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
      // Signed, so that planting a cookie is not enough to forge one. A
      // subdomain XSS or takeover can write cookies on the parent domain but
      // cannot produce this server's signature, and without that a chosen
      // state plus a matching cookie logs a victim in as the attacker.
      signed: true,
    };

    return reply
      .setCookie(OAUTH_STATE_COOKIE, state, options)
      .setCookie(OAUTH_VERIFIER_COOKIE, verifier, options)
      .redirect(url);
  });

  app.get('/auth/google/link', async (request, reply) => {
    // Requires a session here as well as at the callback. Beginning a link
    // while signed out would set an intent cookie that outlives the reason
    // for it.
    if (!request.account) throw new UnauthenticatedError();

    const { url, state, verifier } = beginGoogleSignIn();
    const options = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
      signed: true,
    };

    return reply
      .setCookie(OAUTH_STATE_COOKIE, state, options)
      .setCookie(OAUTH_VERIFIER_COOKIE, verifier, options)
      .setCookie(OAUTH_LINK_COOKIE, '1', options)
      .redirect(url);
  });

  app.get(
    '/auth/google/callback',
    {
      schema: {
        querystring: z.object({
          // All optional, because this endpoint is a redirect target rather
          // than a form post: Google sends `error` instead of `code` when
          // someone clicks Cancel, and answering that with a validation error
          // on the API origin is a dead end with no way back.
          code: z.string().min(1).max(2048).optional(),
          state: z.string().min(1).max(512).optional(),
          error: z.string().min(1).max(200).optional(),
        }),
      },
    },
    async (request, reply) => {
      // Spent up front, so they are gone on every path out of here rather than
      // only the one that succeeds. A failed attempt otherwise leaves a usable
      // state and verifier in the browser for the rest of their ten minutes.
      reply
        .clearCookie(OAUTH_STATE_COOKIE, { path: '/' })
        .clearCookie(OAUTH_VERIFIER_COOKIE, { path: '/' })
        .clearCookie(OAUTH_LINK_COOKIE, { path: '/' });

      const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
      if (request.query.error || !request.query.code || !request.query.state) {
        return reply.redirect(`${appUrl}/signin?cancelled=1`);
      }

      // Only a value this server signed counts as one this browser was given.
      const unsigned = (raw: string | undefined): string | undefined => {
        if (!raw) return undefined;
        const result = request.unsignCookie(raw);
        return result.valid ? (result.value ?? undefined) : undefined;
      };

      // Read BEFORE the exchange, not after (C2): the exchange is the first
      // thing that can fail, and every failure below needs to know whether
      // this was a link attempt to pick the right place to send the browser
      // back to.
      const linking = unsigned(request.cookies[OAUTH_LINK_COOKIE]) === '1';
      const failureUrl = linking ? `${appUrl}/app/settings` : `${appUrl}/signin`;

      try {
        const profile = await exchangeGoogleCode(
          {
            code: request.query.code,
            state: request.query.state,
            cookieState: unsigned(request.cookies[OAUTH_STATE_COOKIE]),
            verifier: unsigned(request.cookies[OAUTH_VERIFIER_COOKIE]) ?? '',
          },
          exchange,
        );

        // One branch, stated plainly, in the one place that can see both the
        // intent cookie and the session.
        if (linking) {
          // A link intent with nothing to link to must not quietly become a
          // signup -- that is where "explicit and authenticated" would be lost.
          if (!request.account) throw new UnauthenticatedError();

          await linkGoogleIdentity(app.prisma, request.account.id, profile);
          return reply.redirect(`${appUrl}/app/settings?linked=google`);
        }

        const { accountId } = await findOrCreateAccountForGoogle(app.prisma, profile);
        const { value, ...cookie } = sessionCookie((await createSession(app.prisma, accountId)).value);

        return reply.setCookie(SESSION_COOKIE, value, cookie).redirect(`${appUrl}/app`);
      } catch (error) {
        // C2: the browser is mid-redirect-chain here, having just come back
        // from Google. A thrown error would otherwise render as raw JSON on
        // the API origin -- no navigation, no way back, the exact failure
        // mode the cancel case above exists to avoid. That reasoning applies
        // to every way out of this handler, not only the cancel case, so
        // every failure ends in a redirect and never a JSON body. The real
        // error still goes to the log; only the code reaching the browser is
        // filtered through the allow-list above.
        request.log.error({ err: error }, 'google oauth callback failed');
        return reply.redirect(`${failureUrl}?error=${callbackErrorCode(error)}`);
      }
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
