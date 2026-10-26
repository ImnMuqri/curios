import { prismaRead } from '../client.js';

export interface NavCounts {
  /** Sources that failed today. Task 13 fills it; 0 until then. */
  failedSources: number;
  /** Failed webhooks in the last 24 hours. Task 13 fills it; 0 until then. */
  failedWebhooks: number;
  /** Pages with an open report (not reports: a page counts once). */
  openReports: number;
}

/** The sidebar's counts, each hidden at 0. */
export async function getNavCounts(now: Date): Promise<NavCounts> {
  void now;
  const pages = await prismaRead.report.groupBy({ by: ['pageId'], where: { status: 'OPEN' } });
  return { failedSources: 0, failedWebhooks: 0, openReports: pages.length };
}
