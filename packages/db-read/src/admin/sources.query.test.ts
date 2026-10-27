import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getSourceStats, listSources } from './sources.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

// Wednesday 2026-10-21, 10:00 in Malaysia. Malaysia midnight today is 2026-10-20T16:00Z.
const NOW = new Date('2026-10-21T02:00:00.000Z');
const MIDNIGHT = new Date('2026-10-20T16:00:00.000Z');
const DAY = 86_400_000;
let pageId = '';
let handle = '';

const read = (data: Record<string, unknown>) => write.ingestion.create({ data: { pageId, ...data } as never });

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  handle = `src-${randomUUID().slice(0, 8)}`;
  const account = await write.account.create({
    data: { email: `${handle}@example.com`, pages: { create: { handle, skeleton: handle, displayName: 'Kedai Src' } } },
    select: { pages: { select: { id: true } } },
  });
  pageId = account.pages[0]!.id;

  const at = (ago: number) => new Date(NOW.getTime() - ago);
  await read({ sourceUrl: 'https://example.com/menu?lang=ms&page=2', status: 'SUCCEEDED', extractedCount: 12, createdAt: at(6 * DAY), updatedAt: new Date(at(6 * DAY).getTime() + 10_000) });
  await read({ sourceUrl: 'https://example.com/', status: 'SUCCEEDED', extractedCount: 4, createdAt: at(5 * DAY), updatedAt: new Date(at(5 * DAY).getTime() + 30_000) });
  // A URL read that succeeded outside the 7 days, and a pasted one: neither is "typical".
  await read({ sourceUrl: 'https://example.com/old', status: 'SUCCEEDED', createdAt: at(9 * DAY), updatedAt: new Date(at(9 * DAY).getTime() + 900_000) });
  await read({ pastedText: 'hello', status: 'SUCCEEDED', createdAt: at(3 * DAY), updatedAt: new Date(at(3 * DAY).getTime() + 900_000) });
  await read({ pastedText: 'a resume', fileName: 'cv.pdf', status: 'SUCCEEDED', createdAt: at(4 * DAY), updatedAt: at(4 * DAY) });
  await read({ sourceUrl: 'https://www.instagram.com/kedai', status: 'FAILED', error: 'walled', createdAt: at(2 * DAY), updatedAt: new Date(MIDNIGHT.getTime() + 60_000) });
  await read({ sourceUrl: 'https://example.com/broken', status: 'FAILED', error: 'timeout', createdAt: at(1 * DAY), updatedAt: new Date(MIDNIGHT.getTime() - 1000) });
  await read({ sourceUrl: 'https://example.com/queued', status: 'QUEUED', createdAt: at(120_000) });
  await read({ sourceUrl: 'https://example.com/busy', status: 'RUNNING', createdAt: at(60_000) });
});

afterAll(async () => {
  await write.$disconnect();
});

describe('listSources', () => {
  it('labels the source and the status, newest first', async () => {
    const rows = await listSources({ filter: 'all' });
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({ source: 'example.com/busy', status: 'Reading', displayName: 'Kedai Src', handle, pageId, error: null });
    expect(rows[1]).toMatchObject({ source: 'example.com/queued', status: 'Queued' });
    expect(rows.find((r) => r.source === 'example.com/broken')).toMatchObject({ status: 'Failed', error: 'timeout' });
    expect(rows.find((r) => r.source === 'Pasted text')).toMatchObject({ status: 'Done' });
    expect(rows.find((r) => r.source === 'cv.pdf')).toMatchObject({ status: 'Done' });
    expect(rows.find((r) => r.source === 'example.com')).toMatchObject({ facts: 4 });
    // The query string stays: it is part of what was read.
    expect(rows.find((r) => r.source === 'example.com/menu?lang=ms&page=2')).toMatchObject({ facts: 12 });
  });

  it('reads a failed Instagram link as Walled', async () => {
    const rows = await listSources({ filter: 'failed' });
    expect(rows.map((r) => [r.source, r.status])).toEqual([
      ['example.com/broken', 'Failed'],
      ['www.instagram.com/kedai', 'Walled'],
    ]);
  });

  it('filters running and done, and limits', async () => {
    expect((await listSources({ filter: 'running' })).map((r) => r.status)).toEqual(['Reading', 'Queued']);
    expect(await listSources({ filter: 'done' })).toHaveLength(5);
    expect(await listSources({ filter: 'all', limit: 3 })).toHaveLength(3);
  });
});

describe('getSourceStats', () => {
  it('counts what waits, reads and failed today by the Malaysia day', async () => {
    const s = await getSourceStats(NOW);
    expect(s.waiting).toBe(1);
    expect(s.reading).toBe(1);
    // The walled read failed at 16:01Z (today in Malaysia); the broken one a second before midnight there.
    expect(s.failedToday).toBe(1);
    // Of the two failed reads, the Instagram one is walled: only the broken one can be retried.
    expect(s.retryable).toBe(1);
    expect(s.counts).toEqual({ all: 9, running: 2, failed: 2, done: 5 });
  });

  it('takes the median of URL reads that succeeded in the last 7 days', async () => {
    expect((await getSourceStats(NOW)).typicalMs).toBe(20_000);
  });

  it('has no typical time without such reads', async () => {
    expect((await getSourceStats(new Date(NOW.getTime() + 30 * DAY))).typicalMs).toBeNull();
  });
});
