import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { hashSessionValue } from '@curios/core';
import type { PrismaClient } from '@curios/db';
import { PageUnavailableError } from '../pages/page-unavailable.js';
import { StorageNotConfiguredError } from '../pages/page.routes.js';
import { resolvePrivateFiles, type PrivateFiles } from '../store/private-files.js';
import { DownloadExpiredError, DownloadUsedUpError, OrderNotFoundError, OrderNotPaidError } from './order.errors.js';

export interface DownloadRouteOptions {
  /** As StoreRouteOptions.privateFiles: undefined builds from the environment, null is off, tests pass a disk store. */
  privateFiles?: PrivateFiles | null;
}

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const params = z.object({ token: z.string().min(1).max(128) });

/** The order the token opens, which must be paid and not cancelled. The token is the credential, so it is hashed and looked up. */
async function paidOrder(prisma: PrismaClient, token: string): Promise<{ id: string }> {
  const order = await prisma.order.findUnique({
    where: { tokenHash: hashSessionValue(token) },
    select: { id: true, status: true, page: { select: { suspendedAt: true } } },
  });
  if (!order) throw new OrderNotFoundError();
  if (order.page.suspendedAt !== null) throw new PageUnavailableError();
  if (order.status !== 'PAID' && order.status !== 'COMPLETED') throw new OrderNotPaidError();
  return order;
}

/**
 * What a buyer opens from their order page or email: a counted download of a
 * file they bought, and the link they bought. Anonymous (the order token is
 * the credential) under its own per-IP budget (app.ts).
 */
export const downloadRoutes: FastifyPluginAsyncZod<DownloadRouteOptions> = async (app, options) => {
  const files = resolvePrivateFiles(options.privateFiles);

  app.get(
    '/store/orders/:token/files/:grantId',
    {
      schema: {
        params: params.extend({ grantId: z.string().min(1).max(64) }),
        response: { 404: errorSchema, 410: errorSchema, 503: errorSchema },
      },
    },
    async (request, reply) => {
      const now = new Date();
      const order = await paidOrder(app.prisma, request.params.token);
      // The grant by its id, and only if it belongs to this order: another order's id is a 404.
      const grant = await app.prisma.downloadGrant.findFirst({
        where: { id: request.params.grantId, orderLine: { orderId: order.id } },
        select: { id: true, fileName: true, usesLeft: true, expiresAt: true, file: { select: { key: true, contentType: true, sizeBytes: true } } },
      });
      if (!grant) throw new OrderNotFoundError();
      if (grant.expiresAt.getTime() <= now.getTime()) throw new DownloadExpiredError();
      if (grant.usesLeft <= 0) throw new DownloadUsedUpError();
      // The owner removed the file after the sale: nothing to give, and no use is spent.
      if (!grant.file) throw new OrderNotFoundError();
      if (!files) throw new StorageNotConfiguredError();

      // One conditional update spends the use: six at once, or a replay, cannot get a sixth.
      const spent = await app.prisma.downloadGrant.updateMany({
        where: { id: grant.id, usesLeft: { gt: 0 }, expiresAt: { gt: now } },
        data: { usesLeft: { decrement: 1 }, lastUsedAt: now },
      });
      if (spent.count === 0) {
        const again = await app.prisma.downloadGrant.findUnique({ where: { id: grant.id }, select: { expiresAt: true } });
        throw again && again.expiresAt.getTime() <= now.getTime() ? new DownloadExpiredError() : new DownloadUsedUpError();
      }

      let delivery;
      try {
        delivery = await files.deliver(grant.file.key, grant.fileName);
      } catch (error) {
        // A download that never started is not a use.
        await app.prisma.downloadGrant.update({ where: { id: grant.id }, data: { usesLeft: { increment: 1 } } }).catch(() => undefined);
        throw error;
      }
      request.log.info({ orderId: order.id }, 'order file downloaded');
      reply.header('Cache-Control', 'private, no-store');
      if ('redirect' in delivery) return reply.redirect(delivery.redirect, 302);
      return reply
        .header('Content-Type', delivery.contentType)
        .header('Content-Disposition', delivery.disposition)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Length', String(grant.file.sizeBytes))
        .send(delivery.stream as never);
    },
  );

  app.get(
    '/store/orders/:token/link/:lineId',
    {
      schema: {
        params: params.extend({ lineId: z.string().min(1).max(64) }),
        response: { 404: errorSchema, 410: errorSchema },
      },
    },
    async (request, reply) => {
      const now = new Date();
      const order = await paidOrder(app.prisma, request.params.token);
      // What was sold, as it stood: the line's own copy of the link, never the live item.
      const line = await app.prisma.orderLine.findFirst({
        where: { id: request.params.lineId, orderId: order.id, kind: 'DIGITAL', delivery: 'LINK' },
        select: { id: true, accessUrl: true },
      });
      if (!line || !line.accessUrl || !line.accessUrl.startsWith('https://')) throw new OrderNotFoundError();
      await app.prisma.orderLine.updateMany({ where: { id: line.id, linkOpenedAt: null }, data: { linkOpenedAt: now } });
      return reply.header('Cache-Control', 'private, no-store').header('Referrer-Policy', 'no-referrer').redirect(line.accessUrl, 302);
    },
  );
};
