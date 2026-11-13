import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import webpush from 'web-push';
import { PUSH_QUEUE, type PushJobData } from '@curios/core';
import { QUEUE_CONCURRENCY } from '../queues.js';

export interface PushDevice {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Where the devices are kept: the PushSubscription table in production, a list in the tests. */
export interface PushDevices {
  list: (accountId: string, endpoint?: string) => Promise<PushDevice[]>;
  remove: (endpoint: string) => Promise<void>;
}

export interface PushSender {
  send: (device: PushDevice, payload: string) => Promise<void>;
}

type PushLog = { info?: (details: object, message: string) => void; warn?: (details: object, message: string) => void };

/** The push service's answer for an address that will never work again. */
const isGone = (error: unknown) => {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return status === 404 || status === 410;
};

/**
 * One notification to every device of an account (or the one device of a Settings test).
 *
 * A device whose address is gone is forgotten. Anything else is logged, and the job throws for a
 * retry only when not one device was reached: a retry sends to all of them again, which the tag
 * makes harmless (the second copy replaces the first), but there is no need for it once one landed.
 */
export async function sendPushJob(deps: { devices: PushDevices; sender: PushSender; log?: PushLog }, data: PushJobData): Promise<void> {
  const devices = await deps.devices.list(data.accountId, data.endpoint);
  if (devices.length === 0) return;

  const payload = JSON.stringify({ title: data.title, body: data.body, url: data.url, ...(data.tag ? { tag: data.tag } : {}) });
  let reached = 0;
  let failed: unknown = null;
  for (const device of devices) {
    try {
      await deps.sender.send(device, payload);
      reached += 1;
    } catch (error) {
      if (isGone(error)) {
        await deps.devices.remove(device.endpoint);
        deps.log?.info?.({ accountId: data.accountId }, 'push device gone; removed');
      } else {
        failed = error;
        deps.log?.warn?.({ accountId: data.accountId, status: (error as { statusCode?: number }).statusCode, err: error instanceof Error ? error.message : String(error) }, 'push send failed');
      }
    }
  }
  if (reached === 0 && failed) throw failed instanceof Error ? failed : new Error('push send failed');
}

export function prismaPushDevices(prisma: PrismaClient): PushDevices {
  return {
    list: (accountId, endpoint) =>
      prisma.pushSubscription.findMany({ where: { accountId, ...(endpoint ? { endpoint } : {}) }, select: { endpoint: true, p256dh: true, auth: true } }),
    // deleteMany: the owner may have turned it off meanwhile, and a missing row is not an error.
    remove: async (endpoint) => void (await prisma.pushSubscription.deleteMany({ where: { endpoint } })),
  };
}

/** The VAPID keys, from the environment; null (push off) when they are not all set. */
export function pushKeysFromEnv(env: NodeJS.ProcessEnv = process.env): { publicKey: string; privateKey: string; subject: string } | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

export function createWebPushSender(keys: { publicKey: string; privateKey: string; subject: string }): PushSender {
  return {
    send: async (device, payload) => {
      await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, payload, {
        vapidDetails: keys,
        // An order a day late is still worth knowing about; one older than that, the email covers.
        TTL: 60 * 60 * 24,
        urgency: 'high',
      });
    },
  };
}

export function createPushWorker(deps: { connection: IORedis; prisma: PrismaClient; sender: PushSender; log?: PushLog }): Worker<PushJobData> {
  const devices = prismaPushDevices(deps.prisma);
  return new Worker<PushJobData>(PUSH_QUEUE, async (job) => sendPushJob({ devices, sender: deps.sender, log: deps.log }, job.data), {
    connection: deps.connection,
    concurrency: QUEUE_CONCURRENCY.push,
  });
}
