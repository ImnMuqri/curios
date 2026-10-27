import { currentPeriod } from '@curios/core';
import { prismaRead } from '../client.js';
import { getSettings } from '../settings.query.js';
import { malaysiaMidnight } from './days.js';
import { PERIOD_DAYS, type Period } from './overview.query.js';

export type AiJob = 'chat' | 'reading' | 'grouping';

export interface AiUsage {
  /** Model calls in the period. */
  calls: number;
  /** Milliseconds a visitor waited for an answer: successful chat calls only. Null with none. */
  answerMs: { median: number; p95: number } | null;
  /** Thousandths of a US cent per conversation (rounded), this period and the one before it. */
  perConversation: { milliCents: number; previousMilliCents: number };
  /** `notSure`: answers that said so; `recorded`: answers that were recorded either way. */
  unsure: { notSure: number; recorded: number };
  /** `share` is 0 to 1; 0 with no calls. */
  failed: { count: number; share: number };
  /** Always the three jobs, in this order. `model` is the most used one, '—' with no calls. */
  jobs: { job: AiJob; model: string; calls: number; avgMs: number; failed: number; milliCents: number }[];
  /** The 10 newest "I'm not sure" questions, whatever the period. No reply, no visitor id. */
  unsureLatest: { question: string; handle: string; askedAt: Date }[];
  /** Pages at 75% or more of this month's cap, fullest first, at most 10. */
  nearCap: { pageId: string; displayName: string; handle: string; used: number; cap: number }[];
}

interface JobRow {
  job: AiJob;
  model: string;
  calls: bigint;
  latency: number | null;
  failed: bigint;
  cost: bigint | null;
}

const JOBS: AiJob[] = ['chat', 'reading', 'grouping'];

/**
 * AI & usage. Period windows are those of the Overview. Grouping calls carry only a page id
 * (apps/workers/src/grouping/group.job.ts), so a call with no conversation and no ingestion is grouping.
 */
export async function getAiUsage(period: Period, now: Date): Promise<AiUsage> {
  const days = PERIOD_DAYS[period];
  const start = malaysiaMidnight(now, days - 1);
  const previousStart = malaysiaMidnight(now, 2 * days - 1);
  const { cap } = await getSettings();
  const threshold = Math.ceil(0.75 * cap);

  const [callGroups, latency, cost, previousCost, conversations, previousConversations, notSure, recorded, jobRows, latest, counters] =
    await Promise.all([
      prismaRead.modelCall.groupBy({ by: ['ok'], where: { createdAt: { gte: start, lte: now } }, _count: { _all: true } }),
      prismaRead.$queryRaw<{ median: number | null; p95: number | null }[]>`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS median,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS p95
        FROM "ModelCall"
        WHERE "conversationId" IS NOT NULL AND "ok" = true AND "createdAt" >= ${start} AND "createdAt" <= ${now}`,
      prismaRead.modelCall.aggregate({ _sum: { costMilliCents: true }, where: { createdAt: { gte: start, lte: now } } }),
      prismaRead.modelCall.aggregate({ _sum: { costMilliCents: true }, where: { createdAt: { gte: previousStart, lt: start } } }),
      prismaRead.conversation.count({ where: { createdAt: { gte: start, lte: now } } }),
      prismaRead.conversation.count({ where: { createdAt: { gte: previousStart, lt: start } } }),
      prismaRead.questionAsk.count({ where: { askedAt: { gte: start, lte: now }, answered: false } }),
      prismaRead.questionAsk.count({ where: { askedAt: { gte: start, lte: now }, answered: { not: null } } }),
      prismaRead.$queryRaw<JobRow[]>`
        SELECT CASE WHEN "conversationId" IS NOT NULL THEN 'chat' WHEN "ingestionId" IS NOT NULL THEN 'reading' ELSE 'grouping' END AS job,
               "model" AS model,
               COUNT(*) AS calls,
               AVG("latencyMs")::float8 AS latency,
               COUNT(*) FILTER (WHERE NOT "ok") AS failed,
               SUM("costMilliCents") AS cost
        FROM "ModelCall"
        WHERE "createdAt" >= ${start} AND "createdAt" <= ${now}
        GROUP BY 1, 2`,
      prismaRead.questionAsk.findMany({
        where: { answered: false },
        orderBy: { askedAt: 'desc' },
        take: 10,
        select: { askedAt: true, question: { select: { text: true, page: { select: { handle: true } } } } },
      }),
      prismaRead.usageCounter.findMany({
        where: { period: currentPeriod(now), count: { gte: threshold } },
        orderBy: { count: 'desc' },
        take: 10,
        select: { pageId: true, count: true, page: { select: { displayName: true, handle: true } } },
      }),
    ]);

  const failedCount = callGroups.find((group) => !group.ok)?._count._all ?? 0;
  const calls = callGroups.reduce((sum, group) => sum + group._count._all, 0);
  const milliCents = cost._sum.costMilliCents ?? 0;
  const previousMilliCents = previousCost._sum.costMilliCents ?? 0;
  const per = (total: number, count: number) => (count > 0 ? Math.round(total / count) : 0);

  const jobs = JOBS.map((job) => {
    const rows = jobRows.filter((row) => row.job === job);
    const total = rows.reduce((sum, row) => sum + Number(row.calls), 0);
    const top = rows.reduce<JobRow | null>((best, row) => (best === null || row.calls > best.calls ? row : best), null);
    const weighted = rows.reduce((sum, row) => sum + (row.latency ?? 0) * Number(row.calls), 0);
    return {
      job,
      model: top?.model ?? '—',
      calls: total,
      avgMs: total > 0 ? Math.round(weighted / total) : 0,
      failed: rows.reduce((sum, row) => sum + Number(row.failed), 0),
      milliCents: rows.reduce((sum, row) => sum + Number(row.cost ?? 0), 0),
    };
  });

  const answer = latency[0];
  return {
    calls,
    answerMs: answer && answer.median !== null && answer.p95 !== null ? { median: Math.round(answer.median), p95: Math.round(answer.p95) } : null,
    perConversation: { milliCents: per(milliCents, conversations), previousMilliCents: per(previousMilliCents, previousConversations) },
    unsure: { notSure, recorded },
    failed: { count: failedCount, share: calls > 0 ? failedCount / calls : 0 },
    jobs,
    unsureLatest: latest.map((row) => ({ question: row.question.text, handle: row.question.page.handle, askedAt: row.askedAt })),
    nearCap: counters.map((row) => ({ pageId: row.pageId, displayName: row.page.displayName, handle: row.page.handle, used: row.count, cap })),
  };
}
