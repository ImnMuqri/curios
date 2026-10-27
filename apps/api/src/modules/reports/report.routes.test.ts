import { createHash, createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { REPORT_REASONS } from '@curios/core';
import { buildApp } from '../../app.js';
import { DEV_REPORT_IP_SECRET, REPORT_IP_SECRET_PLACEHOLDER, resolveReportIpSecret } from './report.routes.js';

const IP_SECRET = 'report-ip-secret-for-tests';

let app: FastifyInstance;
const madeAccounts: string[] = [];

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.115.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp({ reports: { ipSecret: IP_SECRET } });
  await app.ready();
});

afterAll(async () => {
  // Report cascades from Page, which cascades from Account.
  await app.prisma.account.deleteMany({ where: { id: { in: madeAccounts } } });
  await app.close();
});

async function aPage(data: { published?: boolean; suspendedAt?: Date | null } = {}) {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `report-${randomUUID()}@example.com`,
      pages: { create: { handle: `rp-${slug}`, skeleton: `rp-${slug}`, displayName: 'RP', published: true, ...data } },
    },
    select: { id: true, pages: { select: { id: true, handle: true } } },
  });
  madeAccounts.push(account.id);
  return account.pages[0]!;
}

const report = (handle: string, payload: object, remoteAddress = from()) =>
  app.inject({ method: 'POST', url: `/pages/${handle}/report`, remoteAddress, payload });

describe('POST /pages/:handle/report', () => {
  it('stores an open report with a hashed address', async () => {
    const page = await aPage();
    const res = await report(page.handle, { reason: 'SCAM', details: 'Took my money' }, '198.51.100.77');
    expect(res.statusCode).toBe(204);

    const rows = await app.prisma.report.findMany({ where: { pageId: page.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'SCAM', details: 'Took my money', status: 'OPEN' });
    expect(rows[0]!.reporterIpHash).not.toContain('198.51.100.77');
    expect(rows[0]!.reporterIpHash.length).toBeGreaterThan(10);
  });

  it('keys the address hash with the server secret, so it is not the plain SHA-256', async () => {
    const page = await aPage();
    const ip = '198.51.100.78';
    expect((await report(page.handle, { reason: 'SCAM' }, ip)).statusCode).toBe(204);
    const row = await app.prisma.report.findFirstOrThrow({ where: { pageId: page.id } });
    expect(row.reporterIpHash).toBe(createHmac('sha256', IP_SECRET).update(ip).digest('hex'));
    expect(row.reporterIpHash).not.toBe(createHash('sha256').update(ip).digest('hex'));
  });

  it('takes every reason the form offers', async () => {
    for (const reason of Object.keys(REPORT_REASONS)) {
      const page = await aPage();
      expect((await report(page.handle, { reason })).statusCode).toBe(204);
      expect(await app.prisma.report.findFirstOrThrow({ where: { pageId: page.id } })).toMatchObject({ reason });
    }
  });

  it('works without details', async () => {
    const page = await aPage();
    expect((await report(page.handle, { reason: 'OTHER' })).statusCode).toBe(204);
  });

  it('404s a missing page and stores nothing', async () => {
    const handle = `nope-${randomUUID().slice(0, 8)}`;
    const res = await report(handle, { reason: 'SCAM' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('PAGE_NOT_FOUND');
    expect(await app.prisma.report.count({ where: { page: { handle } } })).toBe(0);
  });

  it.each([
    ['unpublished', { published: false }],
    ['suspended', { suspendedAt: new Date() }],
  ])('404s a %s page and stores nothing', async (_name, data) => {
    const page = await aPage(data);
    const res = await report(page.handle, { reason: 'SCAM' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('PAGE_NOT_FOUND');
    expect(await app.prisma.report.count({ where: { pageId: page.id } })).toBe(0);
  });

  it('refuses details over 500 characters and an unknown reason', async () => {
    const page = await aPage();
    expect((await report(page.handle, { reason: 'SCAM', details: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await report(page.handle, { reason: 'RUDE' })).statusCode).toBe(400);
    expect(await app.prisma.report.count({ where: { pageId: page.id } })).toBe(0);
  });

  it('keeps one open report per address per page: a repeat is a quiet 204', async () => {
    const page = await aPage();
    const ip = '198.51.100.90';
    expect((await report(page.handle, { reason: 'SCAM' }, ip)).statusCode).toBe(204);
    expect((await report(page.handle, { reason: 'OFFENSIVE', details: 'again' }, ip)).statusCode).toBe(204);
    expect(await app.prisma.report.count({ where: { pageId: page.id } })).toBe(1);
    expect((await app.prisma.report.findFirstOrThrow({ where: { pageId: page.id } })).reason).toBe('SCAM');
  });

  it('keeps one when the same address reports a page twice at once', async () => {
    const page = await aPage();
    const ip = '198.51.100.91';
    const statuses = await Promise.all([1, 2, 3].map(() => report(page.handle, { reason: 'SCAM' }, ip).then((r) => r.statusCode)));
    expect(statuses).toEqual([204, 204, 204]);
    expect(await app.prisma.report.count({ where: { pageId: page.id } })).toBe(1);
  });

  it('takes the index refusing a duplicate as the same quiet 204', async () => {
    const page = await aPage();
    const ip = '198.51.100.95';
    await report(page.handle, { reason: 'SCAM' }, ip);
    // The check before the insert misses the open report, as it would in a race: the index decides.
    const delegate = app.prisma.report as unknown as Record<string, unknown>;
    const original = delegate.findFirst;
    Object.defineProperty(delegate, 'findFirst', { value: async () => null, writable: true, configurable: true, enumerable: true });
    let res;
    try {
      res = await report(page.handle, { reason: 'SCAM' }, ip);
    } finally {
      Object.defineProperty(delegate, 'findFirst', { value: original, writable: true, configurable: true, enumerable: true });
    }
    expect(res.statusCode).toBe(204);
    expect(await app.prisma.report.count({ where: { pageId: page.id } })).toBe(1);
  });

  it('counts one address on two pages, and two addresses on one page', async () => {
    const a = await aPage();
    const b = await aPage();
    await report(a.handle, { reason: 'SCAM' }, '198.51.100.92');
    await report(b.handle, { reason: 'SCAM' }, '198.51.100.92');
    await report(a.handle, { reason: 'SCAM' }, '198.51.100.93');
    expect(await app.prisma.report.count({ where: { pageId: a.id } })).toBe(2);
    expect(await app.prisma.report.count({ where: { pageId: b.id } })).toBe(1);
  });

  it('takes a new report once the earlier one was dismissed', async () => {
    const page = await aPage();
    const ip = '198.51.100.94';
    await report(page.handle, { reason: 'SCAM' }, ip);
    await app.prisma.report.updateMany({ where: { pageId: page.id }, data: { status: 'DISMISSED', decidedAt: new Date() } });
    expect((await report(page.handle, { reason: 'SCAM' }, ip)).statusCode).toBe(204);
    expect(await app.prisma.report.count({ where: { pageId: page.id, status: 'OPEN' } })).toBe(1);
    expect(await app.prisma.report.count({ where: { pageId: page.id } })).toBe(2);
  });

  it('refuses the 6th report in an hour from one address', async () => {
    const page = await aPage();
    const ip = '198.51.100.201';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await report(page.handle, { reason: 'OTHER' }, ip)).statusCode);
    expect(statuses.slice(0, 5)).toEqual([204, 204, 204, 204, 204]);
    expect(statuses[5]).toBe(429);
  });
});

describe('resolveReportIpSecret', () => {
  it('takes the configured secret', () => {
    expect(resolveReportIpSecret({ ipSecret: 'set' }, false, { warn: vi.fn() })).toBe('set');
    expect(resolveReportIpSecret({ ipSecret: 'k'.repeat(32) }, true, { warn: vi.fn() })).toBe('k'.repeat(32));
  });

  it('refuses the .env.example placeholder, and anything under 32 characters, in production', () => {
    expect(() => resolveReportIpSecret({ ipSecret: REPORT_IP_SECRET_PLACEHOLDER }, true, { warn: vi.fn() })).toThrow(/not the .env.example placeholder/);
    expect(() => resolveReportIpSecret({ ipSecret: 'k'.repeat(31) }, true, { warn: vi.fn() })).toThrow(/at least 32 characters/);
  });

  it('refuses to start in production without one', () => {
    expect(() => resolveReportIpSecret({ ipSecret: '' }, true, { warn: vi.fn() })).toThrow('REPORT_IP_SECRET is not set');
  });

  it('falls back to a fixed dev value with a warning outside production', () => {
    const warn = vi.fn();
    expect(resolveReportIpSecret({ ipSecret: '' }, false, { warn })).toBe(DEV_REPORT_IP_SECRET);
    expect(warn).toHaveBeenCalledOnce();
  });
});
