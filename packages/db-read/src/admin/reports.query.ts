import { ADMIN_ACTIONS } from '@curios/core/admin';
import type { ReportReasonKey } from '@curios/core/report';
import { prismaRead } from '../client.js';
import { DAY_MS, malaysiaMidnight } from './days.js';

export type ReportOutcome = 'Dismissed' | 'Owner emailed' | 'Page suspended';

export interface ReportGroup {
  pageId: string;
  displayName: string;
  handle: string;
  /** The most common reason in the group; a tie goes to the reason of the newest report. */
  reason: ReportReasonKey;
  count: number;
  /** How many of them came in on today's Malaysian calendar day. */
  countToday: number;
  /** When the newest report in the group was made. */
  latestAt: Date;
  /** Closed groups only: when the latest report in the group was decided. */
  decidedAt: Date | null;
  /** The newest note a visitor wrote, or null when none wrote one. */
  quote: string | null;
  /** Closed groups only: what was done, from the latest decision and the audit row behind it. */
  outcome: ReportOutcome | null;
}

/** Closed reports stay on the Closed tab for this long after they were decided. */
const CLOSED_DAYS = 30;
const CLOSED_MAX = 50;
/** How far from a decision its audit row may fall: they are written in one transaction. */
const AUDIT_WINDOW_MS = 60_000;

const closedWhere = (now: Date) => ({ status: { not: 'OPEN' as const }, decidedAt: { gte: new Date(now.getTime() - CLOSED_DAYS * DAY_MS), lte: now } });

/** The audit actions that close reports as ACTED, and the words for each. */
const ACTED_OUTCOME: Record<string, ReportOutcome> = {
  [ADMIN_ACTIONS.EMAILED_OWNER]: 'Owner emailed',
  [ADMIN_ACTIONS.SUSPENDED_PAGE]: 'Page suspended',
};

interface Row {
  pageId: string;
  reason: ReportReasonKey;
  details: string | null;
  status: 'OPEN' | 'DISMISSED' | 'ACTED';
  decidedAt: Date | null;
  createdAt: Date;
  page: { displayName: string; handle: string };
}

/**
 * One group per page, as the Reports screen shows it. Open: every page with an
 * OPEN report, most reports first, then the newest. Closed: reports decided in
 * the last 30 days, newest decision first, at most 50 pages.
 */
export async function listReportGroups(options: { status: 'open' | 'closed'; now: Date }): Promise<ReportGroup[]> {
  const { now } = options;
  const open = options.status === 'open';
  const rows: Row[] = await prismaRead.report.findMany({
    where: open ? { status: 'OPEN' } : closedWhere(now),
    select: {
      pageId: true,
      reason: true,
      details: true,
      status: true,
      decidedAt: true,
      createdAt: true,
      page: { select: { displayName: true, handle: true } },
    },
  });

  const byPage = new Map<string, Row[]>();
  for (const row of rows) byPage.set(row.pageId, [...(byPage.get(row.pageId) ?? []), row]);

  const today = malaysiaMidnight(now);
  const groups = Array.from(byPage.values()).map((group) => ({ group, decided: latestDecidedAt(group) }));

  if (!open) {
    groups.sort((a, b) => (b.decided?.getTime() ?? 0) - (a.decided?.getTime() ?? 0));
    groups.splice(CLOSED_MAX);
  }

  const outcomes = open ? new Map<string, ReportOutcome>() : await outcomesOf(groups.map((g) => ({ pageId: g.group[0]!.pageId, decided: g.decided, status: latestOf(g.group).status })));

  const out = groups.map(({ group, decided }): ReportGroup => {
    const newest = [...group].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const reason = commonReason(group);
    const first = group[0]!;
    return {
      pageId: first.pageId,
      displayName: first.page.displayName,
      handle: first.page.handle,
      reason,
      count: group.length,
      countToday: group.filter((r) => r.createdAt >= today && r.createdAt <= now).length,
      latestAt: newest[0]!.createdAt,
      decidedAt: open ? null : decided,
      quote: newest.find((r) => r.details && r.details.trim())?.details ?? null,
      outcome: open ? null : (outcomes.get(first.pageId) ?? null),
    };
  });

  if (open) out.sort((a, b) => b.count - a.count || b.latestAt.getTime() - a.latestAt.getTime());
  return out;
}

/** The most common reason; a tie goes to the reason of the newest report. At least one report. */
export function commonReason(reports: { reason: ReportReasonKey; createdAt: Date }[]): ReportReasonKey {
  const tally = new Map<ReportReasonKey, { n: number; at: number }>();
  for (const r of [...reports].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const seen = tally.get(r.reason);
    tally.set(r.reason, { n: (seen?.n ?? 0) + 1, at: seen?.at ?? r.createdAt.getTime() });
  }
  return Array.from(tally.entries()).sort((a, b) => b[1].n - a[1].n || b[1].at - a[1].at)[0]![0];
}

/** When the newest decision in the group was made; null when none in it was decided. */
export function latestDecidedAt(group: { decidedAt: Date | null }[]): Date | null {
  let latest: Date | null = null;
  for (const row of group) if (row.decidedAt && (!latest || row.decidedAt > latest)) latest = row.decidedAt;
  return latest;
}

/** How many pages have reports decided in the last 30 days: the Closed tab's count, whatever the list shows. */
export async function countClosedReportGroups(now: Date): Promise<number> {
  return (await prismaRead.report.groupBy({ by: ['pageId'], where: closedWhere(now) })).length;
}

function latestOf(group: Row[]): Row {
  return group.reduce((a, b) => ((b.decidedAt?.getTime() ?? 0) > (a.decidedAt?.getTime() ?? 0) ? b : a));
}

/**
 * Dismissed is the report's own status. Acted is told apart by the audit row
 * written in the same transaction: the one nearest the decision.
 */
async function outcomesOf(decisions: { pageId: string; decided: Date | null; status: Row['status'] }[]): Promise<Map<string, ReportOutcome>> {
  const out = new Map<string, ReportOutcome>();
  const acted = decisions.filter((d): d is { pageId: string; decided: Date; status: Row['status'] } => d.status === 'ACTED' && d.decided !== null);
  for (const d of decisions) if (d.status === 'DISMISSED') out.set(d.pageId, 'Dismissed');
  if (acted.length === 0) return out;

  const audits = await prismaRead.adminAction.findMany({
    // Only an audit row within a minute of the decision is its own: an older warning or suspension is not.
    where: {
      targetType: 'Page',
      action: { in: Object.keys(ACTED_OUTCOME) },
      OR: acted.map((d) => ({
        targetId: d.pageId,
        createdAt: { gte: new Date(d.decided.getTime() - AUDIT_WINDOW_MS), lte: new Date(d.decided.getTime() + AUDIT_WINDOW_MS) },
      })),
    },
    select: { targetId: true, action: true, createdAt: true },
  });
  for (const d of acted) {
    const nearest = audits
      .filter((a) => a.targetId === d.pageId)
      .sort((a, b) => Math.abs(a.createdAt.getTime() - d.decided.getTime()) - Math.abs(b.createdAt.getTime() - d.decided.getTime()))[0];
    if (nearest) out.set(d.pageId, ACTED_OUTCOME[nearest.action]!);
  }
  return out;
}
