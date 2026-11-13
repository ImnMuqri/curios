import { PUSH_QUEUE, testPush, type PushJobData } from '@curios/core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthenticatedError } from '../../plugins/session.js';

export interface PushQueueLike {
  add(name: string, data: PushJobData, opts?: unknown): Promise<unknown>;
}

export interface PushRouteOptions {
  /** The VAPID public key; `undefined` reads VAPID_PUBLIC_KEY. Null or empty means push is off here. */
  publicKey?: string | null;
  /** Tests pass a stub; production uses the app's push queue. */
  queue?: PushQueueLike;
  /** The dashboard's address, for the test notification's link. */
  appUrl?: string;
}

/** Enough for every phone, tablet and computer an owner could have; the oldest go past it. */
export const PUSH_DEVICES_MAX = 10;

export class PushOffError extends Error {
  readonly statusCode = 503;
  readonly code = 'PUSH_OFF';
  constructor() {
    super('Notifications are switched off here.');
    this.name = 'PushOffError';
  }
}

export class PushDeviceUnknownError extends Error {
  readonly statusCode = 404;
  readonly code = 'PUSH_DEVICE_UNKNOWN';
  constructor() {
    super('This device is not set up for notifications. Turn them on again.');
    this.name = 'PushDeviceUnknownError';
  }
}

// A browser's PushSubscription, as `toJSON()` gives it. The endpoint is the push service's address
// for this device: https, and never ours to choose (web-push posts to it).
const endpoint = z.string().url().max(1000).refine((value) => value.startsWith('https://'), { message: 'Not a push address.' });
const device = z
  .object({
    endpoint,
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
    userAgent: z.string().max(300).optional(),
  })
  .strip();

/**
 * Settings, "Notifications on this device": the key a browser subscribes with, saving and removing
 * this device, and a test notification to it. Owners only (the session scope in app.ts).
 */
export const pushRoutes: FastifyPluginAsyncZod<PushRouteOptions> = async (app, options) => {
  const publicKey = (options.publicKey === undefined ? process.env.VAPID_PUBLIC_KEY : options.publicKey) || null;
  const queue = options.queue ?? app.pushQueue;
  const appUrl = (options.appUrl ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

  app.get('/push/key', async (request) => {
    if (!request.account) throw new UnauthenticatedError();
    return { publicKey };
  });

  app.put('/push/devices', { schema: { body: device } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    if (!publicKey) throw new PushOffError();
    const accountId = request.account.id;
    const { endpoint: address, keys, userAgent } = request.body;
    // One browser, one row: signing in as someone else on the same phone moves it to them, so
    // a shared phone never notifies the account that left.
    await app.prisma.pushSubscription.upsert({
      where: { endpoint: address },
      create: { accountId, endpoint: address, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null },
      update: { accountId, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null },
    });
    const extra = await app.prisma.pushSubscription.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      skip: PUSH_DEVICES_MAX,
      select: { id: true },
    });
    if (extra.length > 0) await app.prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((row) => row.id) } } });
    return reply.code(204).send();
  });

  app.delete('/push/devices', { schema: { body: z.object({ endpoint }).strip() } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    // Only the owner's own: an address someone else saved is not theirs to remove.
    await app.prisma.pushSubscription.deleteMany({ where: { accountId: request.account.id, endpoint: request.body.endpoint } });
    return reply.code(204).send();
  });

  app.post('/push/test', { schema: { body: z.object({ endpoint }).strip() } }, async (request, reply) => {
    if (!request.account) throw new UnauthenticatedError();
    if (!publicKey) throw new PushOffError();
    const accountId = request.account.id;
    const found = await app.prisma.pushSubscription.findFirst({ where: { accountId, endpoint: request.body.endpoint }, select: { id: true } });
    if (!found) throw new PushDeviceUnknownError();
    await queue.add(PUSH_QUEUE, { accountId, endpoint: request.body.endpoint, ...testPush(`${appUrl}/app/settings`) }, { attempts: 2, removeOnComplete: true, removeOnFail: 100 });
    return reply.code(202).send();
  });
};
