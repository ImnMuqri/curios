import { isWalledSource } from '@curios/core';
import type { Prisma } from '@prisma/client';
import { prismaRead } from '../client.js';
import { DAY_MS, malaysiaMidnight } from './days.js';

export type SourceFilter = 'all' | 'running' | 'failed' | 'done';
export type SourceStatus = 'Queued' | 'Reading' | 'Done' | 'Failed' | 'Walled';

export interface SourceRow {
  id: string;
  pageId: string;
  displayName: string;
  handle: string;
  /** The URL's host and path, `Pasted text`, or the file's name. */
  source: string;
  /** Walled is a FAILED read of a site that refuses readers (`isWalledSource`). */
  status: SourceStatus;
  error: string | null;
  facts: number;
  startedAt: Date;
}

export interface SourceStats {
  waiting: number;
  reading: number;
  /** FAILED, last updated on today's Malaysian day. */
  failedToday: number;
  /** Median milliseconds for URL reads that succeeded in the last 7 days; null with none. */
  typicalMs: number | null;
  counts: Record<SourceFilter, number>;
}

const FILTERS: Record<SourceFilter, Prisma.IngestionWhereInput> = {
  all: {},
  running: { status: { in: ['QUEUED', 'RUNNING'] } },
  failed: { status: 'FAILED' },
  done: { status: 'SUCCEEDED' },
};

function sourceLabel(row: { sourceUrl: string | null; fileName: string | null }): string {
  if (row.fileName) return row.fileName;
  if (row.sourceUrl) {
    try {
      const url = new URL(row.sourceUrl);
      return url.pathname === '/' ? url.host : `${url.host}${url.pathname}`;
    } catch {
      return row.sourceUrl;
    }
  }
  return 'Pasted text';
}

/** The newest reads first. The pasted text itself is never selected. */
export async function listSources({ filter, limit = 50 }: { filter: SourceFilter; limit?: number }): Promise<SourceRow[]> {
  const rows = await prismaRead.ingestion.findMany({
    where: FILTERS[filter],
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: {
      id: true,
      pageId: true,
      sourceUrl: true,
      fileName: true,
      status: true,
      extractedCount: true,
      error: true,
      createdAt: true,
      page: { select: { displayName: true, handle: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    pageId: row.pageId,
    displayName: row.page.displayName,
    handle: row.page.handle,
    source: sourceLabel(row),
    status:
      row.status === 'QUEUED' ? 'Queued' : row.status === 'RUNNING' ? 'Reading' : row.status === 'SUCCEEDED' ? 'Done' : isWalledSource(row.sourceUrl) ? 'Walled' : 'Failed',
    error: row.error,
    facts: row.extractedCount,
    startedAt: row.createdAt,
  }));
}

export async function getSourceStats(now: Date): Promise<SourceStats> {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const [waiting, reading, failedToday, typical, all, running, failed, done] = await Promise.all([
    prismaRead.ingestion.count({ where: { status: 'QUEUED' } }),
    prismaRead.ingestion.count({ where: { status: 'RUNNING' } }),
    prismaRead.ingestion.count({ where: { status: 'FAILED', updatedAt: { gte: malaysiaMidnight(now), lte: now } } }),
    prismaRead.$queryRaw<{ median: number | null }[]>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) * 1000) AS median
      FROM "Ingestion"
      WHERE "status" = 'SUCCEEDED' AND "sourceUrl" IS NOT NULL AND "updatedAt" >= ${weekAgo} AND "updatedAt" <= ${now}`,
    prismaRead.ingestion.count({ where: FILTERS.all }),
    prismaRead.ingestion.count({ where: FILTERS.running }),
    prismaRead.ingestion.count({ where: FILTERS.failed }),
    prismaRead.ingestion.count({ where: FILTERS.done }),
  ]);
  const median = typical[0]?.median ?? null;
  return { waiting, reading, failedToday, typicalMs: median === null ? null : Math.round(median), counts: { all, running, failed, done } };
}
