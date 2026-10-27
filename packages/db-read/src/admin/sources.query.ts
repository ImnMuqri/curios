import { isWalledSource, RETRY_WINDOW_MS } from '@curios/core';
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
  /** FAILED reads Retry all would queue: failed and not walled. */
  retryable: number;
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

/** The row ellipsises long labels in CSS; this only keeps a pathological URL from filling the payload. */
const LABEL_MAX = 200;

/** A query value that may be a secret or a person's address: the key stays, the value goes. */
const SENSITIVE_KEY = /token|key|sig|secret|auth|pass|code|email|session/i;

function maskQuery(search: string): string {
  if (!search.startsWith('?')) return search;
  return (
    '?' +
    search
      .slice(1)
      .split('&')
      .map((pair) => {
        const eq = pair.indexOf('=');
        if (eq < 0) return pair;
        let key = pair.slice(0, eq);
        try {
          key = decodeURIComponent(key);
        } catch {
          // a key that does not decode is matched as written
        }
        return SENSITIVE_KEY.test(key) ? `${pair.slice(0, eq)}=…` : pair;
      })
      .join('&')
  );
}

function sourceLabel(row: { sourceUrl: string | null; fileName: string | null }): string {
  if (row.fileName) return row.fileName;
  if (row.sourceUrl) {
    try {
      const url = new URL(row.sourceUrl);
      // Host, path and query: two reads of one page with different queries must not look alike.
      const label = `${url.host}${url.pathname === '/' ? '' : url.pathname}${maskQuery(url.search)}`;
      return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label;
    } catch {
      const q = row.sourceUrl.indexOf('?');
      return q < 0 ? row.sourceUrl : row.sourceUrl.slice(0, q) + maskQuery(row.sourceUrl.slice(q));
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
  const [waiting, reading, failedToday, typical, all, running, failed, done, failedUrls] = await Promise.all([
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
    // Only what "Retry all failed" would look at: failed within its window, and just the address.
    prismaRead.ingestion.findMany({ where: { status: 'FAILED', updatedAt: { gte: new Date(now.getTime() - RETRY_WINDOW_MS) } }, select: { sourceUrl: true } }),
  ]);
  const retryable = failedUrls.filter((r) => !isWalledSource(r.sourceUrl)).length;
  const median = typical[0]?.median ?? null;
  return { waiting, reading, failedToday, retryable, typicalMs: median === null ? null : Math.round(median), counts: { all, running, failed, done } };
}
