import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SOURCE_LABEL_MAX } from '@curios/core';
import { getKnowledge, sourceLabel } from './knowledge.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let mine = '';
let theirs = '';
let sourceId = '';
let failedSourceId = '';
const failedSourceCreatedAt = new Date('2026-02-01T00:00:00Z');
let orderTestAccountId = '';
let neverSayTestAccountId = '';
const fixtureFactIds: Map<string, string> = new Map(); // claim -> id

async function anOwnerWithAPage() {
  const slug = randomUUID().slice(0, 8);
  const account = await write.account.create({
    data: { email: `kq-${randomUUID()}@example.com`, pages: { create: { handle: `kq-${slug}`, skeleton: `kq-${slug}`, displayName: 'K' } } },
    select: { id: true, pages: { select: { id: true } } },
  });
  return { accountId: account.id, pageId: account.pages[0]?.id ?? '' };
}

const fact = (pageId: string, claim: string, extra: Record<string, unknown> = {}) =>
  write.fact.create({ data: { pageId, category: 'PRICE', claim, normalizedClaim: `${claim}-${randomUUID()}`, confidence: 0.9, ...extra } });

beforeAll(async () => {
  const a = await anOwnerWithAPage();
  const b = await anOwnerWithAPage();
  const orderTest = await anOwnerWithAPage();
  const neverSayTest = await anOwnerWithAPage();

  mine = a.accountId;
  theirs = b.accountId;
  orderTestAccountId = orderTest.accountId;
  neverSayTestAccountId = neverSayTest.accountId;

  // Main fixture for basic tests
  const source = await write.ingestion.create({
    data: { pageId: a.pageId, sourceUrl: 'https://nadia.example/', status: 'SUCCEEDED' }
  });
  sourceId = source.id;

  // Create a failed source with error and explicit createdAt
  const failedSource = await write.ingestion.create({
    data: { pageId: a.pageId, sourceUrl: 'https://broken.example/', status: 'FAILED', error: 'Network timeout', createdAt: failedSourceCreatedAt }
  });
  failedSourceId = failedSource.id;

  fixtureFactIds.set('from the site', (await fact(a.pageId, 'from the site', { ingestionId: source.id, verified: true })).id);
  await fact(a.pageId, 'pending from the site', { ingestionId: source.id });
  await fact(a.pageId, 'rejected from the site', { ingestionId: source.id, rejectedAt: new Date() });
  fixtureFactIds.set('typed by the owner', (await fact(a.pageId, 'typed by the owner', { origin: 'OWNER', verified: true, category: 'HOURS' })).id);
  fixtureFactIds.set('from before', (await fact(a.pageId, 'from before', { origin: 'UNTRACKED', verified: true })).id);

  await write.ingestion.create({
    data: { pageId: a.pageId, pastedText: '\n\n  About Nadia Bakes\nMore.', status: 'SUCCEEDED', tracked: false }
  });

  await write.topic.create({ data: { pageId: a.pageId, title: 'Berapa harga kek?', answer: 'RM95.', askCount: 3 } });

  // Asked about a lot but unanswered: not pinned.
  await write.topic.create({ data: { pageId: a.pageId, title: 'No answer here?', askCount: 9 } });

  // Another owner's answered topic.
  await write.topic.create({ data: { pageId: b.pageId, title: 'Their question?', answer: 'Theirs.', askCount: 50 } });

  await write.neverSay.create({
    data: { pageId: a.pageId, phrase: 'halal certified' }
  });

  await fact(b.pageId, 'someone else', { verified: true });

  // ===== ORDERING TESTS FIXTURE (separate owner) =====

  // Source ordering: create older first, newer last - should be returned newest first.
  // Explicit, distinct createdAt: back-to-back default timestamps can share a millisecond.
  await write.ingestion.create({
    data: { pageId: orderTest.pageId, sourceUrl: 'https://old.example/', status: 'SUCCEEDED', createdAt: new Date('2026-01-01T00:00:00Z') }
  });

  await write.ingestion.create({
    data: { pageId: orderTest.pageId, sourceUrl: 'https://new.example/', status: 'SUCCEEDED', createdAt: new Date('2026-01-05T00:00:00Z') }
  });

  // Facts ordering: FactCategory enum declared as [PRICE, HOURS, LOCATION, ...] so PRICE < HOURS
  // Create in order: (a) HOURS late, (b) HOURS early, (c) PRICE mid
  // Insertion order: ['hours late', 'hours early', 'price']
  // Sorted by [category asc, createdAt asc]: ['price', 'hours early', 'hours late']
  // Insertion order ≠ sorted order, so deleteOrderBy must fail
  await fact(orderTest.pageId, 'hours late', { verified: true, category: 'HOURS', createdAt: new Date('2026-01-03') });
  await fact(orderTest.pageId, 'hours early', { verified: true, category: 'HOURS', createdAt: new Date('2026-01-01') });
  await fact(orderTest.pageId, 'price', { verified: true, category: 'PRICE', createdAt: new Date('2026-01-02') });

  // Topics ordering: lower askCount FIRST, then higher; a tie broken by lastAskedAt.
  await write.topic.create({ data: { pageId: orderTest.pageId, title: 'Asked 5 times?', answer: 'Five.', askCount: 5 } });
  await write.topic.create({ data: { pageId: orderTest.pageId, title: 'Asked 20 times?', answer: 'Twenty.', askCount: 20 } });
  await write.topic.create({ data: { pageId: orderTest.pageId, title: 'Tie older?', answer: 'Older.', askCount: 1, lastAskedAt: new Date('2026-01-01T00:00:00Z') } });
  await write.topic.create({ data: { pageId: orderTest.pageId, title: 'Tie newer?', answer: 'Newer.', askCount: 1, lastAskedAt: new Date('2026-02-01T00:00:00Z') } });

  // ===== NEVER-SAY ORDERING FIXTURE (separate owner) =====

  // Create two never-say entries to test id ordering
  await write.neverSay.create({
    data: { pageId: neverSayTest.pageId, phrase: 'alpha phrase' }
  });

  await write.neverSay.create({
    data: { pageId: neverSayTest.pageId, phrase: 'beta phrase' }
  });
});

afterAll(async () => {
  await write.$disconnect();
});

describe('getKnowledge', () => {
  it('is null for an owner with no page', async () => {
    const account = await write.account.create({ data: { email: `kq-np-${randomUUID()}@example.com` } });
    expect(await getKnowledge(account.id)).toBeNull();
  });

  it('lists accepted facts only, each labelled by where it came from', async () => {
    const k = await getKnowledge(mine);
    expect(k?.facts.map((f) => [f.claim, f.origin, f.sourceLabel]).sort()).toEqual(
      [
        ['from before', 'UNTRACKED', null],
        ['from the site', 'EXTRACTED', 'https://nadia.example/'],
        ['typed by the owner', 'OWNER', null],
      ].sort(),
    );
  });

  it("counts a source's facts the way removing it would", async () => {
    const k = await getKnowledge(mine);
    const site = k?.sources.find((s) => s.id === sourceId);
    // Accepted and pending go with the source; the rejected one stays behind.
    expect(site).toMatchObject({ label: 'https://nadia.example/', tracked: true, factCount: 2 });
  });

  // Review Focus 4.
  it('labels pasted text by its first non-empty line, and never ships the text', async () => {
    const k = await getKnowledge(mine);
    const pasted = k?.sources.find((s) => s.sourceUrl === null);
    expect(pasted).toMatchObject({ label: 'About Nadia Bakes', tracked: false });
    expect(JSON.stringify(k)).not.toContain('More.');
  });

  it('lists answered topics as pinned answers, not unanswered ones', async () => {
    const k = await getKnowledge(mine);
    expect(k?.pinned).toEqual([{ topicId: expect.any(String), question: 'Berapa harga kek?', answer: 'RM95.' }]);
    expect(JSON.stringify(k?.pinned)).not.toContain('No answer here?');
    expect(JSON.stringify(k?.pinned)).not.toContain('Their question?');
  });

  it("carries the topic's id", async () => {
    const topic = await write.topic.findFirstOrThrow({ where: { title: 'Berapa harga kek?', page: { accountId: mine } } });
    expect((await getKnowledge(mine))?.pinned[0]?.topicId).toBe(topic.id);
  });

  it('lists never-say entries', async () => {
    expect((await getKnowledge(mine))?.neverSay.map((n) => n.phrase)).toEqual(['halal certified']);
  });

  it("never shows another owner's knowledge", async () => {
    const k = await getKnowledge(theirs);
    expect(k?.facts.map((f) => f.claim)).toEqual(['someone else']);
    expect(JSON.stringify(await getKnowledge(mine))).not.toContain('someone else');
  });

  it('orders sources by createdAt descending (newest first)', async () => {
    const k = await getKnowledge(orderTestAccountId);
    // Created old then new; newest first. These are the owner's only sources.
    expect(k?.sources.map((s) => s.sourceUrl)).toEqual(['https://new.example/', 'https://old.example/']);
  });

  it('returns facts in category then createdAt order', async () => {
    const k = await getKnowledge(orderTestAccountId);
    const facts = k?.facts ?? [];
    // Created insertion order: ['hours late', 'hours early', 'price']
    // Sorted by [category asc, createdAt asc] (PRICE < HOURS): ['price', 'hours early', 'hours late']
    expect(facts.map((f) => f.claim)).toEqual(['price', 'hours early', 'hours late']);
  });

  it('orders pinned answers by askCount descending, then most recently asked', async () => {
    const k = await getKnowledge(orderTestAccountId);
    expect(k?.pinned.map((p) => p.question)).toEqual(['Asked 20 times?', 'Asked 5 times?', 'Tie newer?', 'Tie older?']);
  });

  it('passes through source status, error, createdAt, and fact ids with exact values', async () => {
    const k = await getKnowledge(mine);
    const failedSource = k?.sources.find((s) => s.id === failedSourceId);
    expect(failedSource).toMatchObject({
      id: failedSourceId,
      status: 'FAILED',
      error: 'Network timeout',
      createdAt: failedSourceCreatedAt,
    });
    // Verify fact ids match fixture ids by value
    const facts = k?.facts ?? [];
    expect(facts.length).toBeGreaterThan(0);
    const claimToId = new Map(facts.map((f) => [f.claim, f.id]));
    fixtureFactIds.forEach((expectedId, claim) => {
      const returnedId = claimToId.get(claim);
      expect(returnedId).toBe(expectedId);
    });
  });

  it('orders never-say entries by id ascending', async () => {
    const k = await getKnowledge(neverSayTestAccountId);
    const neverSay = k?.neverSay ?? [];
    // Created two entries: they should be in id order
    expect(neverSay.length).toBe(2);
    expect(neverSay[0]!.id <= neverSay[1]!.id).toBe(true);
    expect(neverSay.map((n) => n.phrase)).toEqual(['alpha phrase', 'beta phrase']);
  });
});

describe('sourceLabel', () => {
  it('cuts a long line with an ellipsis, counting characters', () => {
    const label = sourceLabel(null, '🎂'.repeat(200));
    expect([...label]).toHaveLength(SOURCE_LABEL_MAX);
    expect(label.endsWith('…')).toBe(true);
  });

  it('names a source read from a file by its file, not by the text inside it', () => {
    expect(sourceLabel(null, 'Iman Muqri\nSoftware developer', 'Iman-resume.pdf')).toBe('Iman-resume.pdf');
  });

  it('never returns an empty label', () => {
    expect(sourceLabel(null, '\n \n')).toBe('Pasted text');
  });
});
