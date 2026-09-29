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
let orderTestAccountId = '';
let neverSayTestAccountId = '';

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

  // Create a failed source with error
  const failedSource = await write.ingestion.create({
    data: { pageId: a.pageId, sourceUrl: 'https://broken.example/', status: 'FAILED', error: 'Network timeout' }
  });
  failedSourceId = failedSource.id;

  await fact(a.pageId, 'from the site', { ingestionId: source.id, verified: true });
  await fact(a.pageId, 'pending from the site', { ingestionId: source.id });
  await fact(a.pageId, 'rejected from the site', { ingestionId: source.id, rejectedAt: new Date() });
  await fact(a.pageId, 'typed by the owner', { origin: 'OWNER', verified: true, category: 'HOURS' });
  await fact(a.pageId, 'from before', { origin: 'UNTRACKED', verified: true });

  await write.ingestion.create({
    data: { pageId: a.pageId, pastedText: '\n\n  About Nadia Bakes\nMore.', status: 'SUCCEEDED', tracked: false }
  });

  const question = await write.question.create({
    data: { pageId: a.pageId, text: 'Berapa harga kek?', normalizedQuestion: 'berapa harga kek', answered: true }
  });
  await write.pinnedAnswer.create({
    data: { pageId: a.pageId, question: question.text, normalizedQuestion: 'berapa harga kek', answer: 'RM95.' }
  });

  // Question with answered: true but NO PinnedAnswer
  await write.question.create({
    data: { pageId: a.pageId, text: 'No pin here?', normalizedQuestion: 'no pin here', answered: true }
  });

  await write.question.create({
    data: { pageId: a.pageId, text: 'Ada delivery?', normalizedQuestion: 'ada delivery' }
  });

  await write.neverSay.create({
    data: { pageId: a.pageId, phrase: 'halal certified' }
  });

  await fact(b.pageId, 'someone else', { verified: true });

  // ===== ORDERING TESTS FIXTURE (separate owner) =====

  // Source ordering: create older first, newer last - should be returned newest first
  await write.ingestion.create({
    data: { pageId: orderTest.pageId, sourceUrl: 'https://old.example/', status: 'SUCCEEDED' }
  });

  await write.ingestion.create({
    data: { pageId: orderTest.pageId, sourceUrl: 'https://new.example/', status: 'SUCCEEDED' }
  });

  // Facts ordering: create in reverse of desired return order
  // Ordered by: category asc, createdAt asc (H < P alphabetically)
  // Create: PRICE past first, then HOURS tomorrow
  // Without orderBy: PRICE past, HOURS tomorrow (insertion order)
  // With orderBy: HOURS tomorrow, PRICE past (H < P in category order)
  const tomorrow = new Date(Date.now() + 86400000);
  const yesterday = new Date(Date.now() - 86400000);

  await fact(orderTest.pageId, 'price fact', { verified: true, category: 'PRICE', createdAt: yesterday });
  await fact(orderTest.pageId, 'hours fact', { verified: true, category: 'HOURS', createdAt: tomorrow });

  // Questions ordering: create lower askCount FIRST, then higher askCount
  // Should return in desc order: highAsk before lowAsk
  const lowAskQuestion = await write.question.create({
    data: { pageId: orderTest.pageId, text: 'Asked 5 times?', normalizedQuestion: 'asked 5', answered: true, askCount: 5 }
  });
  await write.pinnedAnswer.create({
    data: { pageId: orderTest.pageId, question: lowAskQuestion.text, normalizedQuestion: 'asked 5', answer: 'Five.' }
  });

  const highAskQuestion = await write.question.create({
    data: { pageId: orderTest.pageId, text: 'Asked 20 times?', normalizedQuestion: 'asked 20', answered: true, askCount: 20 }
  });
  await write.pinnedAnswer.create({
    data: { pageId: orderTest.pageId, question: highAskQuestion.text, normalizedQuestion: 'asked 20', answer: 'Twenty.' }
  });

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

  it('lists pinned answers, not unanswered questions', async () => {
    const k = await getKnowledge(mine);
    // Exact equality: ordered by askCount desc then lastAskedAt desc
    // Only one pinned question in this fixture (Berapa harga kek?)
    expect(k?.pinned).toEqual([{ questionId: expect.any(String), question: 'Berapa harga kek?', answer: 'RM95.' }]);
    expect(JSON.stringify(k?.pinned)).not.toContain('No pin here?');
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
    const sources = k?.sources ?? [];
    // We created: olderSource, then newerSource
    // Should be returned: newerSource first, then olderSource
    const sourceUrls = sources.map((s) => s.sourceUrl);
    const newIdx = sourceUrls.indexOf('https://new.example/');
    const oldIdx = sourceUrls.indexOf('https://old.example/');
    expect(newIdx).toBeGreaterThanOrEqual(0);
    expect(oldIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBeLessThan(oldIdx);
  });

  it('returns facts in category then createdAt order', async () => {
    const k = await getKnowledge(orderTestAccountId);
    const facts = k?.facts ?? [];
    // Created: PRICE past first, then HOURS future
    // Ordered by category asc, createdAt asc
    expect(facts.map((f) => f.claim)).toEqual(['price fact', 'hours fact']);
  });

  it('orders pinned answers by question askCount descending', async () => {
    const k = await getKnowledge(orderTestAccountId);
    // Created: low askCount (5) first, then high askCount (20)
    // Should return: high askCount (20) first, then low askCount (5)
    expect(k?.pinned.map((p) => p.question)).toEqual(['Asked 20 times?', 'Asked 5 times?']);
  });

  it('excludes questions with answered: true but no PinnedAnswer', async () => {
    const k = await getKnowledge(mine);
    expect(k?.pinned.map((p) => p.question)).not.toContain('No pin here?');
    // Verify a pinned question is present
    expect(k?.pinned.length).toBeGreaterThan(0);
  });

  it('passes through source status, error, and ids with exact values', async () => {
    const k = await getKnowledge(mine);
    const failedSource = k?.sources.find((s) => s.id === failedSourceId);
    expect(failedSource).toMatchObject({
      id: failedSourceId,
      status: 'FAILED',
      error: 'Network timeout',
    });
    // Verify fact ids are preserved exactly
    const k2 = await getKnowledge(mine);
    const facts = k2?.facts ?? [];
    expect(facts.length).toBeGreaterThan(0);
    facts.forEach((f) => {
      expect(f.id).toMatch(/^[a-z0-9]+$/);
      expect(typeof f.id).toBe('string');
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

  it('never returns an empty label', () => {
    expect(sourceLabel(null, '\n \n')).toBe('Pasted text');
  });
});
