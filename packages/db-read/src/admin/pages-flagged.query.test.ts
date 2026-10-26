import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getAdminPage, listAdminPages } from './pages.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const NOW = new Date('2026-10-21T02:00:00.000Z');

const ids: Record<string, string> = {};

async function aPage(key: string, open: number, page: Record<string, unknown> = {}): Promise<void> {
  const handle = `fl-${randomUUID().slice(0, 8)}`;
  const account = await write.account.create({
    data: { email: `${handle}@example.com`, pages: { create: { handle, skeleton: handle, displayName: key, published: true, ...page } } },
    select: { pages: { select: { id: true } } },
  });
  const pageId = (ids[key] = account.pages[0]!.id);
  await write.report.createMany({ data: Array.from({ length: open }, () => ({ pageId, reason: 'SCAM' as const, reporterIpHash: 'h' })) });
}

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  await aPage('Six', 6);
  await aPage('Five', 5);
  await aPage('Clean', 0);
  await aPage('Held', 0, { suspendedAt: new Date('2026-10-10T00:00:00Z') });
  // Suspended and over the line: Suspended wins.
  await aPage('HeldSix', 7, { suspendedAt: new Date('2026-10-10T00:00:00Z') });
  // Six reports, but five of them closed: not flagged.
  await aPage('Closed', 1);
  await write.report.createMany({
    data: Array.from({ length: 5 }, () => ({ pageId: ids.Closed!, reason: 'SCAM' as const, reporterIpHash: 'h', status: 'DISMISSED' as const })),
  });
});

afterAll(async () => {
  await write.$disconnect();
});

describe('flagged pages', () => {
  it('a page with 6 open reports is Flagged and one with 5 is not', async () => {
    const rows = await listAdminPages({ now: NOW });
    const status = Object.fromEntries(rows.map((r) => [r.displayName, r.status]));
    expect(status.Six).toBe('Flagged');
    expect(status.Five).toBe('Live');
    expect(status.Closed).toBe('Live');
    expect(status.HeldSix).toBe('Suspended');
  });

  it('the flagged filter lists suspended and flagged pages', async () => {
    const rows = await listAdminPages({ filter: 'flagged', now: NOW });
    expect(rows.map((r) => r.displayName).sort()).toEqual(['Held', 'HeldSix', 'Six']);
  });

  it('the flagged filter still narrows by search', async () => {
    const rows = await listAdminPages({ filter: 'flagged', q: 'six', now: NOW });
    expect(rows.map((r) => r.displayName).sort()).toEqual(['HeldSix', 'Six']);
  });

  it('the panel carries the open report count and the same status', async () => {
    const six = await getAdminPage(ids.Six!, NOW);
    expect(six).toMatchObject({ status: 'Flagged', openReports: 6 });
    expect(await getAdminPage(ids.Closed!, NOW)).toMatchObject({ status: 'Live', openReports: 1 });
    expect(await getAdminPage(ids.Clean!, NOW)).toMatchObject({ openReports: 0 });
  });
});
