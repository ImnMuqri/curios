import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ADMIN_COOKIE, INGEST_QUEUE } from '@curios/core';
import { buildApp } from '../../app.js';
import { hashPassword } from '../auth/password.service.js';
import { createAdminSession } from './admin-session.service.js';
import { retryFailedSources } from './admin-sources.service.js';

let app: FastifyInstance;
let previousOrigin: string | undefined;
let adminId: string;
let cookie: string;
let pageId: string;
let handle: string;
let accountId: string;
// The app's queue has `add` stubbed with a recorder: no Redis job is ever created.
const add = vi.fn(async (..._args: unknown[]) => ({ id: 'job' }));
let addSpy: { mockRestore(): void };

beforeAll(async () => {
  previousOrigin = process.env.ADMIN_ORIGIN;
  process.env.ADMIN_ORIGIN = 'http://localhost:3002';
  app = await buildApp({ admin: { store: null, privateFiles: null } });
  await app.ready();
  addSpy = vi.spyOn(app.ingestQueue, 'add').mockImplementation(add as never);
  const admin = await app.prisma.adminUser.create({
    data: { email: `admin-${randomUUID()}@example.com`, name: 'Test Admin', passwordHash: await hashPassword('a-long-enough-passphrase') },
  });
  adminId = admin.id;
  cookie = await createAdminSession(app.prisma, admin.id, '127.0.0.1');
  const slug = randomUUID().slice(0, 8);
  handle = `as-${slug}`;
  const account = await app.prisma.account.create({
    data: { email: `as-${randomUUID()}@example.com`, pages: { create: { handle, skeleton: handle, displayName: 'S' } } },
    select: { id: true, pages: { select: { id: true } } },
  });
  accountId = account.id;
  pageId = account.pages[0]!.id;
});

// SystemSetting is reached by no truncate cascade: this suite empties its own switch row, before each test and after the last.
async function clean() {
  await app.prisma.systemSetting.deleteMany({ where: { key: 'switch.reading' } });
  await app.prisma.adminAction.deleteMany({ where: { adminUserId: adminId } });
  await app.prisma.ingestion.deleteMany({ where: { pageId } });
  app.settings.clear();
  add.mockReset();
  add.mockImplementation(async () => ({ id: 'job' }));
}

afterAll(async () => {
  await clean();
  addSpy.mockRestore();
  await app.prisma.adminUser.deleteMany({ where: { id: adminId } });
  await app.prisma.account.deleteMany({ where: { id: accountId } });
  if (previousOrigin === undefined) delete process.env.ADMIN_ORIGIN;
  else process.env.ADMIN_ORIGIN = previousOrigin;
  await app.close();
});

beforeEach(clean);

const post = (url: string, payload?: object, withCookie: string | null = cookie) =>
  app.inject({ method: 'POST', url, payload, cookies: withCookie ? { [ADMIN_COOKIE]: withCookie } : undefined });
const actions = () => app.prisma.adminAction.findMany({ where: { adminUserId: adminId }, orderBy: { createdAt: 'asc' } });
const source = (data: { status: 'FAILED' | 'SUCCEEDED' | 'RUNNING' | 'QUEUED'; sourceUrl?: string | null; pastedText?: string }) =>
  app.prisma.ingestion.create({ data: { pageId, error: data.status === 'FAILED' ? 'boom' : null, ...data } });
const readingOff = async () => {
  await app.prisma.systemSetting.create({ data: { key: 'switch.reading', value: false } });
  app.settings.clear();
};

describe('POST /admin/sources/:id/retry', () => {
  it('needs an admin and a reason', async () => {
    const s = await source({ status: 'FAILED', sourceUrl: 'https://s.example/' });
    expect((await post(`/admin/sources/${s.id}/retry`, { reason: 'x' }, null)).statusCode).toBe(401);
    expect((await post(`/admin/sources/${s.id}/retry`, {})).statusCode).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it('queues a failed URL source again, claimed, with a fresh job id, and writes the audit row', async () => {
    const s = await source({ status: 'FAILED', sourceUrl: 'https://s.example/' });
    const res = await post(`/admin/sources/${s.id}/retry`, { reason: '  Site was down  ' });
    expect(res.statusCode).toBe(204);
    const row = await app.prisma.ingestion.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ status: 'QUEUED', error: null, extractedCount: 0, progress: 0, tracked: true });
    const [name, data, options] = add.mock.calls[0]! as [string, Record<string, unknown>, { jobId: string; attempts: number }];
    expect(name).toBe(INGEST_QUEUE);
    expect(data).toMatchObject({ ingestionId: s.id, pageId, sourceUrl: 'https://s.example/' });
    expect(options.jobId).toMatch(new RegExp(`^${s.id}-recheck-\\d+$`));
    expect(options.attempts).toBe(3);
    const rows = await actions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'RETRIED_SOURCE', targetType: 'Page', targetId: pageId, targetLabel: handle, reason: 'Site was down' });
  });

  it('queues a failed pasted source, whose job carries no address', async () => {
    const s = await source({ status: 'FAILED', pastedText: 'About us.' });
    expect((await post(`/admin/sources/${s.id}/retry`, { reason: 'Again' })).statusCode).toBe(204);
    const [, data] = add.mock.calls[0]! as [string, Record<string, unknown>];
    expect(data).toMatchObject({ ingestionId: s.id, pageId });
    expect(data).not.toHaveProperty('sourceUrl');
  });

  it.each(['SUCCEEDED', 'RUNNING', 'QUEUED'] as const)('refuses a %s source with 409 SOURCE_STATE', async (status) => {
    const s = await source({ status, sourceUrl: 'https://s.example/' });
    const res = await post(`/admin/sources/${s.id}/retry`, { reason: 'Try' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SOURCE_STATE');
    expect(add).not.toHaveBeenCalled();
    expect(await actions()).toHaveLength(0);
  });

  it('refuses a walled source', async () => {
    const s = await source({ status: 'FAILED', sourceUrl: 'https://www.instagram.com/shop' });
    const res = await post(`/admin/sources/${s.id}/retry`, { reason: 'Try' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SOURCE_STATE');
    expect(add).not.toHaveBeenCalled();
  });

  it('is a 404 for a source that does not exist', async () => {
    expect((await post('/admin/sources/nope/retry', { reason: 'Try' })).statusCode).toBe(404);
  });

  it('is 409 READING_OFF while reading is off, and changes nothing', async () => {
    const s = await source({ status: 'FAILED', sourceUrl: 'https://s.example/' });
    await readingOff();
    const res = await post(`/admin/sources/${s.id}/retry`, { reason: 'Try' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('READING_OFF');
    expect((await app.prisma.ingestion.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('FAILED');
    expect(add).not.toHaveBeenCalled();
    expect(await actions()).toHaveLength(0);
  });

  it('marks the source FAILED again when the queue will not take it, and answers the error', async () => {
    const s = await source({ status: 'FAILED', sourceUrl: 'https://s.example/' });
    add.mockImplementationOnce(async () => {
      throw new Error('redis down');
    });
    const res = await post(`/admin/sources/${s.id}/retry`, { reason: 'Try' });
    expect(res.statusCode).toBe(500);
    const row = await app.prisma.ingestion.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ status: 'FAILED', error: 'We could not start reading it. Try again.' });
  });
});

describe('POST /admin/sources/retry-failed', () => {
  it('queues every failed source of the last 7 days, skips walled ones, and writes one audit row', async () => {
    const a = await source({ status: 'FAILED', sourceUrl: 'https://a.example/' });
    const b = await source({ status: 'FAILED', pastedText: 'Menu' });
    await source({ status: 'FAILED', sourceUrl: 'https://instagram.com/shop' });
    await source({ status: 'SUCCEEDED', sourceUrl: 'https://ok.example/' });
    const old = await source({ status: 'FAILED', sourceUrl: 'https://old.example/' });
    await app.prisma.$executeRaw`UPDATE "Ingestion" SET "updatedAt" = now() - interval '8 days' WHERE id = ${old.id}`;

    const res = await post('/admin/sources/retry-failed', { reason: 'Outage over' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ queued: 2, skipped: 1 });
    expect(add).toHaveBeenCalledTimes(2);
    for (const id of [a.id, b.id]) expect((await app.prisma.ingestion.findUniqueOrThrow({ where: { id } })).status).toBe('QUEUED');
    expect((await app.prisma.ingestion.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('FAILED');
    const rows = await actions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'RETRIED_FAILED_SOURCES', targetLabel: 'everyone', reason: 'Outage over', metadata: { queued: 2, skipped: 1 } });
  });

  it('counts a source the queue refused as skipped and carries on', async () => {
    await source({ status: 'FAILED', sourceUrl: 'https://a.example/' });
    await source({ status: 'FAILED', sourceUrl: 'https://b.example/' });
    add.mockImplementationOnce(async () => {
      throw new Error('redis down');
    });
    const res = await post('/admin/sources/retry-failed', { reason: 'Again' });
    expect(res.json()).toEqual({ queued: 1, skipped: 1 });
    expect(add).toHaveBeenCalledTimes(2);
    expect(await app.prisma.ingestion.count({ where: { pageId, status: 'FAILED' } })).toBe(1);
  });

  it('logs a source the queue refused, by id and error name', async () => {
    const s = await source({ status: 'FAILED', sourceUrl: 'https://a.example/' });
    class RedisDown extends Error {
      override name = 'RedisDown';
    }
    const log = { warn: vi.fn() };
    const queue = { add: vi.fn(async () => Promise.reject(new RedisDown('connection refused'))) };
    const result = await retryFailedSources(
      { prisma: app.prisma, queue: queue as never, settings: await app.settings.get(), log },
      { adminId, ip: '127.0.0.1' },
      'Again',
    );
    expect(result).toEqual({ queued: 0, skipped: 1 });
    expect(log.warn).toHaveBeenCalledWith({ ingestionId: s.id, err: 'RedisDown' }, 'retry all failed: the queue would not take a source');
  });

  it('is 409 READING_OFF while reading is off', async () => {
    await source({ status: 'FAILED', sourceUrl: 'https://a.example/' });
    await readingOff();
    const res = await post('/admin/sources/retry-failed', { reason: 'Try' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('READING_OFF');
    expect(add).not.toHaveBeenCalled();
    expect(await actions()).toHaveLength(0);
  });
});
