import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ADMIN_ACTIONS, ADMIN_COOKIE, ADMIN_SESSION_TTL_MS } from '@curios/core';
import { requireAdmin } from '../../plugins/admin-session.js';
import { burnTime, verifyPassword } from '../auth/password.service.js';
import { writeAudit } from './audit.js';
import {
  createAdminSession,
  revokeAdminSession,
} from './admin-session.service.js';

class AdminSigninFailedError extends Error {
  readonly statusCode = 401;
  readonly code = 'ADMIN_SIGNIN_FAILED';

  constructor() {
    super('Wrong email or password.');
    this.name = 'AdminSigninFailedError';
  }
}

const credentials = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  domain: process.env.COOKIE_DOMAIN,
};

/** Sign-in alone: app.ts puts the IP limiter over this scope and nothing else. */
export const adminSigninRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/admin/signin', { schema: { body: credentials } }, async (request, reply) => {
    const admin = await app.prisma.adminUser.findUnique({
      where: { email: request.body.email.toLowerCase() },
    });

    if (!admin) {
      // Same time as a real verification, so the answer is not an oracle.
      await burnTime();
      throw new AdminSigninFailedError();
    }

    const ok = await verifyPassword(admin.passwordHash, request.body.password);
    if (!ok || admin.disabledAt) throw new AdminSigninFailedError();

    const value = await createAdminSession(app.prisma, admin.id, request.ip);
    await app.prisma.$transaction(async (tx) => {
      await tx.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
      await writeAudit(tx, {
        adminUserId: admin.id,
        action: ADMIN_ACTIONS.SIGNED_IN,
        targetType: 'AdminUser',
        targetId: admin.id,
        targetLabel: admin.email,
        reason: 'Signed in',
        ip: request.ip,
      });
    });

    return reply
      .setCookie(ADMIN_COOKIE, value, { ...cookieOptions, maxAge: ADMIN_SESSION_TTL_MS / 1000 })
      .status(204)
      .send();
  });
};

export const adminSessionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/admin/signout', async (request, reply) => {
    const value = request.cookies[ADMIN_COOKIE];
    if (value) await revokeAdminSession(app.prisma, value);

    // Attributes must match those it was set with, or the browser keeps the old one.
    return reply
      .clearCookie(ADMIN_COOKIE, { path: '/', domain: process.env.COOKIE_DOMAIN })
      .status(204)
      .send();
  });

  app.get('/admin/me', { preHandler: requireAdmin }, async (request) => {
    const admin = await app.prisma.adminUser.findUniqueOrThrow({
      where: { id: request.admin!.id },
      select: { id: true, name: true, email: true },
    });
    return admin;
  });
};
