import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getNavCounts } from './nav.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const NOW = new Date('2026-10-21T02:00:00.000Z');

async function aPage(): Promise<string> {
  const handle = `nv-${randomUUID().slice(0, 8)}`;
  const account = await write.account.create({
    data: { email: `${handle}@example.com`, pages: { create: { handle, skeleton: handle, displayName: handle } } },
    select: { pages: { select: { id: true } } },
  });
  return account.pages[0]!.id;
}

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

afterAll(async () => {
  await write.$disconnect();
});

describe('getNavCounts', () => {
  it('is zero with nothing reported', async () => {
    expect(await getNavCounts(NOW)).toEqual({ failedSources: 0, failedWebhooks: 0, openReports: 0 });
  });

  it('counts pages with open reports, not reports, and not closed ones', async () => {
    const [a, b, c] = [await aPage(), await aPage(), await aPage()] as [string, string, string];
    const make = (pageId: string, status: 'OPEN' | 'DISMISSED' = 'OPEN') =>
      write.report.create({ data: { pageId, reason: 'SCAM', reporterIpHash: 'h', status } });
    await make(a);
    await make(a);
    await make(b);
    await make(c, 'DISMISSED');
    expect((await getNavCounts(NOW)).openReports).toBe(2);
  });
});
