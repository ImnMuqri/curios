import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';

let app: FastifyInstance;
const madeAccounts: string[] = [];

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.115.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp();
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

  it('works without details', async () => {
    const page = await aPage();
    expect((await report(page.handle, { reason: 'OTHER' })).statusCode).toBe(204);
  });

  it.each([
    ['missing', undefined],
    ['unpublished', { published: false }],
    ['suspended', { suspendedAt: new Date() }],
  ])('404s a %s page and stores nothing', async (_name, data) => {
    const page = await aPage(data);
    const handle = _name === 'missing' ? `nope-${randomUUID().slice(0, 8)}` : page.handle;
    const res = await report(handle, { reason: 'SCAM' });
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

  it('refuses the 6th report in an hour from one address', async () => {
    const page = await aPage();
    const ip = '198.51.100.201';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await report(page.handle, { reason: 'OTHER' }, ip)).statusCode);
    expect(statuses.slice(0, 5)).toEqual([204, 204, 204, 204, 204]);
    expect(statuses[5]).toBe(429);
  });
});
