import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ADMIN_COOKIE } from '@curios/core';
import { buildApp } from '../../app.js';
import { hashPassword } from '../auth/password.service.js';
import { createAdminSession } from './admin-session.service.js';

let app: FastifyInstance;
let previousOrigin: string | undefined;
let adminId: string;
let cookie: string;

beforeAll(async () => {
  previousOrigin = process.env.ADMIN_ORIGIN;
  process.env.ADMIN_ORIGIN = 'http://localhost:3002';
  app = await buildApp({ admin: { store: null, privateFiles: null } });
  await app.ready();
  const admin = await app.prisma.adminUser.create({
    data: { email: `admin-${randomUUID()}@example.com`, name: 'Test Admin', passwordHash: await hashPassword('a-long-enough-passphrase') },
  });
  adminId = admin.id;
  cookie = await createAdminSession(app.prisma, admin.id, '127.0.0.1');
});

// SystemSetting is not reached by any truncate cascade, so this suite empties it itself, before each
// test and after the last.
async function clean() {
  await app.prisma.systemSetting.deleteMany();
  await app.prisma.adminAction.deleteMany({ where: { adminUserId: adminId } });
  app.settings.clear();
}

afterAll(async () => {
  await clean();
  await app.ingestQueue.resume();
  await app.prisma.adminUser.deleteMany({ where: { id: adminId } });
  if (previousOrigin === undefined) delete process.env.ADMIN_ORIGIN;
  else process.env.ADMIN_ORIGIN = previousOrigin;
  await app.close();
});

beforeEach(async () => {
  await clean();
  await app.ingestQueue.resume();
});

const put = (url: string, payload?: object, withCookie: string | null = cookie) =>
  app.inject({ method: 'PUT', url, payload, cookies: withCookie ? { [ADMIN_COOKIE]: withCookie } : undefined });
const actions = () => app.prisma.adminAction.findMany({ where: { adminUserId: adminId }, orderBy: { createdAt: 'asc' } });

const limits = { cap: 200, freeLeads: 3, freeOrders: 3, monthlyRm: 49, yearlyRm: 490, reason: 'Review' };

describe('switches', () => {
  it('needs a reason to turn off', async () => {
    const res = await put('/admin/settings/switches/chat', { on: false });
    expect(res.statusCode).toBe(400);
    expect(await actions()).toHaveLength(0);
  });

  it('turns off with a reason, shows at once, and refuses a repeat', async () => {
    const res = await put('/admin/settings/switches/chat', { on: false, reason: '  Model outage  ' });
    expect(res.statusCode).toBe(204);
    expect((await app.settings.get()).switches.chat).toBe(false);
    const rows = await actions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'TURNED_OFF', targetType: 'Setting', targetId: 'chat', targetLabel: 'everyone', reason: 'Model outage' });
    const stored = await app.prisma.systemSetting.findUnique({ where: { key: 'switch.chat' } });
    expect(stored).toMatchObject({ value: false, updatedById: adminId });

    const again = await put('/admin/settings/switches/chat', { on: false, reason: 'Again' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('SWITCH_STATE');
    expect(await actions()).toHaveLength(1);
  });

  it('turns back on with no reason, storing a default', async () => {
    await put('/admin/settings/switches/signups', { on: false, reason: 'Spam' });
    const res = await put('/admin/settings/switches/signups', { on: true });
    expect(res.statusCode).toBe(204);
    expect((await app.settings.get()).switches.signups).toBe(true);
    const rows = await actions();
    expect(rows[1]).toMatchObject({ action: 'TURNED_ON', reason: 'Turned back on' });
    expect((await put('/admin/settings/switches/signups', { on: true })).statusCode).toBe(409);
  });

  it('refuses an unknown switch', async () => {
    expect((await put('/admin/settings/switches/nope', { on: false, reason: 'x' })).statusCode).toBe(400);
  });

  it('pauses and resumes the ingest queue for reading', async () => {
    expect((await put('/admin/settings/switches/reading', { on: false, reason: 'Queue backed up' })).statusCode).toBe(204);
    expect(await app.ingestQueue.isPaused()).toBe(true);
    expect((await put('/admin/settings/switches/reading', { on: true })).statusCode).toBe(204);
    expect(await app.ingestQueue.isPaused()).toBe(false);
  });
});

describe('limits', () => {
  it('saves changes, stores prices as sen, and audits only the changed keys in RM', async () => {
    const res = await put('/admin/settings/limits', { ...limits, cap: 80, monthlyRm: 59 });
    expect(res.statusCode).toBe(204);
    const s = await app.settings.get();
    expect(s.cap).toBe(80);
    expect(s.prices.MONTHLY).toBe(5900);
    const rows = await actions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'CHANGED_LIMITS', targetType: 'Setting', targetLabel: 'everyone', reason: 'Review' });
    expect(rows[0]!.metadata).toEqual({ from: { cap: 200, monthlyRm: 49 }, to: { cap: 80, monthlyRm: 59 } });
  });

  it('asks for confirmation on a big price change', async () => {
    const res = await put('/admin/settings/limits', { ...limits, monthlyRm: 79 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('BIG_CHANGE');
    expect(res.json().error.fields).toEqual(['monthly']);
    expect(await actions()).toHaveLength(0);
    const ok = await put('/admin/settings/limits', { ...limits, monthlyRm: 79, confirmBig: true });
    expect(ok.statusCode).toBe(204);
    expect((await app.settings.get()).prices.MONTHLY).toBe(7900);
  });

  it('refuses a cap of 0 and non-whole prices', async () => {
    expect((await put('/admin/settings/limits', { ...limits, cap: 0 })).statusCode).toBe(400);
    expect((await put('/admin/settings/limits', { ...limits, monthlyRm: 49.5 })).statusCode).toBe(400);
    expect((await put('/admin/settings/limits', { ...limits, reason: ' ' })).statusCode).toBe(400);
  });

  it('refuses a save that changes nothing', async () => {
    const now = await app.settings.get();
    const res = await put('/admin/settings/limits', {
      ...limits,
      cap: now.cap,
      freeLeads: now.freeLeads,
      freeOrders: now.freeOrders,
      monthlyRm: now.prices.MONTHLY / 100,
      yearlyRm: now.prices.ANNUAL / 100,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_CHANGE');
  });
});

describe('banner', () => {
  it('refuses 161 characters', async () => {
    expect((await put('/admin/settings/banner', { text: 'a'.repeat(161) })).statusCode).toBe(400);
  });

  it('shows with the text as the reason, then takes down', async () => {
    expect((await put('/admin/settings/banner', { text: '  Maintenance tonight  ' })).statusCode).toBe(204);
    expect((await app.settings.get()).banner).toBe('Maintenance tonight');
    expect((await put('/admin/settings/banner', { text: null })).statusCode).toBe(204);
    expect((await app.settings.get()).banner).toBeNull();
    const rows = await actions();
    expect(rows.map((r) => r.action)).toEqual(['SHOWED_BANNER', 'TOOK_BANNER_DOWN']);
    expect(rows[0]).toMatchObject({ reason: 'Maintenance tonight', targetId: 'banner' });
    expect(rows[1]!.reason).toBe('Taken down');
  });
});

describe('without an admin', () => {
  it('answers 401 on every route', async () => {
    expect((await put('/admin/settings/switches/chat', { on: false, reason: 'x' }, null)).statusCode).toBe(401);
    expect((await put('/admin/settings/limits', limits, null)).statusCode).toBe(401);
    expect((await put('/admin/settings/banner', { text: null }, null)).statusCode).toBe(401);
  });
});
