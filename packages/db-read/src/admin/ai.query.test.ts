import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getAiUsage } from './ai.query.js';
import { clearSettingsCache } from '../settings.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

// Wednesday 2026-10-21, 10:00 in Malaysia. Malaysia midnight today is 2026-10-20T16:00Z.
const NOW = new Date('2026-10-21T02:00:00.000Z');
const MIDNIGHT = new Date('2026-10-20T16:00:00.000Z');
const DAY = 86_400_000;
const ids: Record<string, string> = {};

async function aPage(key: string): Promise<string> {
  const handle = `ai-${randomUUID().slice(0, 8)}`;
  const account = await write.account.create({
    data: { email: `${handle}@example.com`, pages: { create: { handle, skeleton: handle, displayName: key } } },
    select: { pages: { select: { id: true } } },
  });
  ids[key] = account.pages[0]!.id;
  return ids[key];
}

const call = (data: Record<string, unknown>) =>
  write.modelCall.create({
    data: { model: 'haiku', inputTokens: 1, outputTokens: 1, costMilliCents: 100, priceVersion: 'v', latencyMs: 100, ok: true, createdAt: NOW, ...data } as never,
  });

async function withSetting(key: string, value: number, run: () => Promise<void>) {
  await write.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  clearSettingsCache();
  try {
    await run();
  } finally {
    await write.systemSetting.deleteMany({ where: { key } });
    clearSettingsCache();
  }
}

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  await write.$executeRawUnsafe('TRUNCATE "ModelCall"');
  await aPage('Alpha');
  await aPage('Beta');
  const conv = async (pageId: string, createdAt: Date) => (await write.conversation.create({ data: { pageId, createdAt }, select: { id: true } })).id;
  const c1 = await conv(ids.Alpha!, NOW);
  const c2 = await conv(ids.Alpha!, NOW);
  const old = await conv(ids.Alpha!, new Date(NOW.getTime() - 10 * DAY));
  const ing = await write.ingestion.create({ data: { pageId: ids.Alpha!, pastedText: 'p' }, select: { id: true } });

  // Chat: ok latencies 100..500 (median 300), plus a failed 9000 that must not count toward the answer time.
  for (const [i, ms] of [100, 200, 300, 400, 500].entries()) await call({ conversationId: i % 2 ? c1 : c2, pageId: ids.Alpha!, latencyMs: ms, costMilliCents: 1000 });
  await call({ conversationId: c1, latencyMs: 9000, ok: false, costMilliCents: 0 });
  // Reading: two on one model, one on another.
  await call({ ingestionId: ing.id, model: 'sonnet', latencyMs: 2000, costMilliCents: 5000 });
  await call({ ingestionId: ing.id, model: 'sonnet', latencyMs: 4000, costMilliCents: 5000 });
  await call({ ingestionId: ing.id, model: 'opus', latencyMs: 6000, costMilliCents: 5000, ok: false });
  // Grouping: a page id only.
  await call({ pageId: ids.Alpha!, latencyMs: 50, costMilliCents: 10 });
  // Before the 7 day window: 2 conversations in the previous window? one conversation, 4000 milli-cents.
  await call({ conversationId: old, createdAt: new Date(NOW.getTime() - 10 * DAY), costMilliCents: 4000 });

  const topic = await write.topic.create({ data: { pageId: ids.Alpha!, title: 'Hours' } });
  const ask = async (text: string, asks: { answered: boolean | null; askedAt?: Date }[]) => {
    const q = await write.question.create({ data: { pageId: ids.Alpha!, text, normalizedQuestion: text, topicId: topic.id } });
    await write.questionAsk.createMany({ data: asks.map((a) => ({ questionId: q.id, answered: a.answered, askedAt: a.askedAt ?? NOW })) });
  };
  await ask('open on sunday?', [{ answered: false }, { answered: true }]);
  await ask('do you deliver?', [{ answered: false }, { answered: null }]);
  await ask('very old one', [{ answered: false, askedAt: new Date(NOW.getTime() - 40 * DAY) }]);
  for (let i = 0; i < 10; i++) await ask(`filler ${i}`, [{ answered: false, askedAt: new Date(NOW.getTime() - (i + 1) * 60_000) }]);

  await write.usageCounter.createMany({
    data: [
      { pageId: ids.Alpha!, period: '2026-10', count: 160 },
      { pageId: ids.Beta!, period: '2026-10', count: 149 },
    ],
  });
});

afterAll(async () => {
  await write.$disconnect();
});

describe('getAiUsage', () => {
  it('counts calls and the failures among them', async () => {
    const u = await getAiUsage('7d', NOW);
    expect(u.calls).toBe(10);
    expect(u.failed.count).toBe(2);
    expect(u.failed.share).toBeCloseTo(0.2);
  });

  it('reports the median and p95 of successful chat calls only', async () => {
    const u = await getAiUsage('7d', NOW);
    expect(u.answerMs).toEqual({ median: 300, p95: 480 });
  });

  it('has no answer time when there were no chat calls', async () => {
    expect((await getAiUsage('today', new Date(NOW.getTime() - 30 * DAY))).answerMs).toBeNull();
  });

  it('splits the jobs by the ids a call carries, with the most used model', async () => {
    const u = await getAiUsage('7d', NOW);
    expect(u.jobs.map((j) => j.job)).toEqual(['chat', 'reading', 'grouping']);
    expect(u.jobs[0]).toEqual({ job: 'chat', model: 'haiku', calls: 6, avgMs: 1750, failed: 1, milliCents: 5000 });
    expect(u.jobs[1]).toEqual({ job: 'reading', model: 'sonnet', calls: 3, avgMs: 4000, failed: 1, milliCents: 15000 });
    expect(u.jobs[2]).toEqual({ job: 'grouping', model: 'haiku', calls: 1, avgMs: 50, failed: 0, milliCents: 10 });
  });

  it('gives the cost per conversation for this period and the one before', async () => {
    const u = await getAiUsage('7d', NOW);
    // 20010 over 2 conversations; the previous window held one conversation and 4000.
    expect(u.perConversation).toEqual({ milliCents: 10005, previousMilliCents: 4000 });
  });

  it('counts the I am not sure answers over the recorded ones', async () => {
    const u = await getAiUsage('7d', NOW);
    // open on sunday (false, true), do you deliver (false, null), ten fillers (false); the old one is out of the period.
    expect(u.unsure).toEqual({ notSure: 12, recorded: 13 });
  });

  it('lists the ten newest unsure questions with only the text, the handle and the time', async () => {
    const u = await getAiUsage('7d', NOW);
    expect(u.unsureLatest).toHaveLength(10);
    expect(Object.keys(u.unsureLatest[0]!).sort()).toEqual(['askedAt', 'handle', 'question']);
    expect(u.unsureLatest.map((q) => q.question).slice(0, 2).sort()).toEqual(['do you deliver?', 'open on sunday?']);
    expect(u.unsureLatest.every((q) => q.question !== 'very old one')).toBe(true);
  });

  it('lists pages at 75 percent of the cap, fullest first', async () => {
    const u = await getAiUsage('7d', NOW);
    // The default cap is 200, so 150 is the line: Alpha (160) is in, Beta (149) is not.
    expect(u.nearCap).toEqual([{ pageId: ids.Alpha, displayName: 'Alpha', handle: expect.any(String), used: 160, cap: 200 }]);
  });

  it('uses the cap the admin set', async () => {
    await withSetting('cap', 100, async () => {
      const u = await getAiUsage('7d', NOW);
      expect(u.nearCap.map((p) => [p.displayName, p.used, p.cap])).toEqual([['Alpha', 160, 100], ['Beta', 149, 100]]);
    });
    await withSetting('cap', 198, async () => {
      expect((await getAiUsage('7d', NOW)).nearCap.map((p) => p.displayName)).toEqual(['Alpha', 'Beta']);
    });
  });

  it('keeps today to Malaysia midnight', async () => {
    const u = await getAiUsage('today', NOW);
    expect(u.calls).toBe(10);
    const early = await getAiUsage('today', new Date(MIDNIGHT.getTime() - 1000));
    expect(early.calls).toBe(0);
  });
});
