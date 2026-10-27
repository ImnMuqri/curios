import { prismaRead } from '../client.js';
import { DAY_MS, malaysiaMidnight } from './days.js';

export interface NavCounts {
  /** Sources that failed today (Malaysia). */
  failedSources: number;
  /** Failed webhooks in the last 24 hours. */
  failedWebhooks: number;
  /** Pages with an open report (not reports: a page counts once). */
  openReports: number;
}

/** The sidebar's counts, each hidden at 0. */
export async function getNavCounts(now: Date): Promise<NavCounts> {
  const [failedSources, failedWebhooks, pages] = await Promise.all([
    prismaRead.ingestion.count({ where: { status: 'FAILED', updatedAt: { gte: malaysiaMidnight(now), lte: now } } }),
    prismaRead.chipWebhookEvent.count({ where: { outcome: 'failed', lastAttemptAt: { gte: new Date(now.getTime() - DAY_MS), lte: now } } }),
    prismaRead.report.groupBy({ by: ['pageId'], where: { status: 'OPEN' } }),
  ]);
  return { failedSources, failedWebhooks, openReports: pages.length };
}
