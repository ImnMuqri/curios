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
  await write.$executeRawUnsafe('TRUNCATE "ChipWebhookEvent"');
});

afterAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "ChipWebhookEvent"');
  await write.$disconnect();
});

describe('getNavCounts', () => {
  it('is zero with nothing reported', async () => {
    expect(await getNavCounts(NOW)).toEqual({ failedSources: 0, failedWebhooks: 0, openReports: 0 });
  });

  it('counts pages with open reports, not reports, and not closed ones', async () => {
    const [a, b, c] = [await aPage(), await aPage(), await aPage()] as [string, string, string];
    // Each its own address: one address keeps one open report per page.
    let n = 0;
    const make = (pageId: string, status: 'OPEN' | 'DISMISSED' = 'OPEN') =>
      write.report.create({ data: { pageId, reason: 'SCAM', reporterIpHash: `h${n++}`, status } });
    await make(a);
    await make(a);
    await make(b);
    await make(c, 'DISMISSED');
    expect((await getNavCounts(NOW)).openReports).toBe(2);
  });

  it('counts sources that failed today (Malaysia) and webhooks that failed in the last 24 hours', async () => {
    const pageId = await aPage();
    const midnight = new Date('2026-10-20T16:00:00.000Z');
    const failed = (updatedAt: Date, status: 'FAILED' | 'SUCCEEDED' = 'FAILED') =>
      write.ingestion.create({ data: { pageId, pastedText: 'p', status, updatedAt } });
    await failed(new Date(midnight.getTime() + 1000));
    await failed(new Date(midnight.getTime() - 1000));
    await failed(new Date(midnight.getTime() + 1000), 'SUCCEEDED');
    const hook = (purchaseId: string, outcome: string, ago: number) => ({
      source: 'webhook', eventType: 'purchase.paid', purchaseId, body: '{}', outcome, lastAttemptAt: new Date(NOW.getTime() - ago),
    });
    await write.chipWebhookEvent.createMany({
      data: [hook('a', 'failed', 60_000), hook('b', 'failed', 23 * 3_600_000), hook('c', 'failed', 25 * 3_600_000), hook('d', 'ok', 60_000)],
    });
    const counts = await getNavCounts(NOW);
    expect(counts.failedSources).toBe(1);
    expect(counts.failedWebhooks).toBe(2);
  });
});
