import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PUSH_QUEUE } from '@curios/core';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';
import { PUSH_DEVICES_MAX } from './push.routes.js';

const queue = { add: vi.fn(async () => ({ id: 'push-1' })) };
let app: FastifyInstance;
let off: FastifyInstance;
let nth = 0;
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp({ push: { publicKey: 'BPublicKeyForTests', queue, appUrl: 'https://curios.my' } });
  off = await buildApp({ push: { publicKey: null, queue } });
  await Promise.all([app.ready(), off.ready()]);
});
afterAll(async () => {
  await Promise.all([app.close(), off.close()]);
});
beforeEach(() => queue.add.mockClear());

async function anOwner() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: { email: `push-${randomUUID()}@example.com`, emailVerifiedAt: new Date(), pages: { create: { handle: `pu-${slug}`, skeleton: `pu-${slug}`, displayName: 'Lina' } } },
    select: { id: true },
  });
  return { id: account.id, cookie: (await createSession(app.prisma, account.id)).value };
}

const address = () => `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
const aDevice = (endpoint = address()) => ({ endpoint, keys: { p256dh: 'BKeyP256', auth: 'authSecret' }, userAgent: 'Android Chrome' });

const call = (on: FastifyInstance, method: 'GET' | 'PUT' | 'DELETE' | 'POST', url: string, cookie?: string, payload?: object) =>
  on.inject({ method, url, remoteAddress: from(), cookies: cookie ? { [SESSION_COOKIE]: cookie } : {}, ...(payload ? { payload } : {}) });

describe('the push routes', () => {
  it('give the key to a signed-in owner, and null where push is off', async () => {
    const owner = await anOwner();
    expect((await call(app, 'GET', '/push/key', owner.cookie)).json()).toEqual({ publicKey: 'BPublicKeyForTests' });
    expect((await call(off, 'GET', '/push/key', owner.cookie)).json()).toEqual({ publicKey: null });
    expect((await call(app, 'GET', '/push/key')).statusCode).toBe(401);
  });

  it('save a device once, however often the browser sends it', async () => {
    const owner = await anOwner();
    const device = aDevice();
    expect((await call(app, 'PUT', '/push/devices', owner.cookie, device)).statusCode).toBe(204);
    expect((await call(app, 'PUT', '/push/devices', owner.cookie, device)).statusCode).toBe(204);
    expect(await app.prisma.pushSubscription.count({ where: { accountId: owner.id } })).toBe(1);
  });

  it('move a shared phone to whoever signed in last', async () => {
    const [first, second] = [await anOwner(), await anOwner()];
    const device = aDevice();
    await call(app, 'PUT', '/push/devices', first.cookie, device);
    await call(app, 'PUT', '/push/devices', second.cookie, device);
    const row = await app.prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: device.endpoint } });
    expect(row.accountId).toBe(second.id);
  });

  it(`keep the newest ${PUSH_DEVICES_MAX} devices`, async () => {
    const owner = await anOwner();
    for (let i = 0; i <= PUSH_DEVICES_MAX; i += 1) await call(app, 'PUT', '/push/devices', owner.cookie, aDevice());
    expect(await app.prisma.pushSubscription.count({ where: { accountId: owner.id } })).toBe(PUSH_DEVICES_MAX);
  });

  it('refuse an address that is not a push service’s https one', async () => {
    const owner = await anOwner();
    expect((await call(app, 'PUT', '/push/devices', owner.cookie, aDevice('http://example.com/x'))).statusCode).toBe(400);
  });

  it('remove only the owner’s own device', async () => {
    const [owner, other] = [await anOwner(), await anOwner()];
    const device = aDevice();
    await call(app, 'PUT', '/push/devices', owner.cookie, device);
    await call(app, 'DELETE', '/push/devices', other.cookie, { endpoint: device.endpoint });
    expect(await app.prisma.pushSubscription.count({ where: { endpoint: device.endpoint } })).toBe(1);
    await call(app, 'DELETE', '/push/devices', owner.cookie, { endpoint: device.endpoint });
    expect(await app.prisma.pushSubscription.count({ where: { endpoint: device.endpoint } })).toBe(0);
  });

  it('send a test to that device only, and refuse one it does not know', async () => {
    const owner = await anOwner();
    const device = aDevice();
    await call(app, 'PUT', '/push/devices', owner.cookie, device);
    expect((await call(app, 'POST', '/push/test', owner.cookie, { endpoint: device.endpoint })).statusCode).toBe(202);
    expect(queue.add).toHaveBeenCalledWith(
      PUSH_QUEUE,
      expect.objectContaining({ accountId: owner.id, endpoint: device.endpoint, title: 'Notifications are on', url: 'https://curios.my/app/settings?tab=notifications' }),
      expect.anything(),
    );
    expect((await call(app, 'POST', '/push/test', owner.cookie, { endpoint: address() })).statusCode).toBe(404);
  });

  it('save nothing where push is off', async () => {
    const owner = await anOwner();
    const res = await call(off, 'PUT', '/push/devices', owner.cookie, aDevice());
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'PUSH_OFF' } });
  });
});
