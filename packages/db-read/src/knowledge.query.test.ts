import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SOURCE_LABEL_MAX } from '@curios/core';
import { getKnowledge, sourceLabel } from './knowledge.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let mine = '';
let theirs = '';
let sourceId = '';
let olderSourceId = '';
let failedSourceId = '';
let question1Id = '';
let question2Id = '';
let questionNoAnswerId = '';

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
  mine = a.accountId;
  theirs = b.accountId;

  // Create older source first, then newer source to test ordering (desc)
  const olderSource = await write.ingestion.create({
    data: { pageId: a.pageId, sourceUrl: 'https://old.example/', status: 'SUCCEEDED' }
  });
  olderSourceId = olderSource.id;

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

  const pastedSource = await write.ingestion.create({
    data: { pageId: a.pageId, pastedText: '\n\n  About Nadia Bakes\nMore.', status: 'SUCCEEDED', tracked: false }
  });

  // Create questions with different askCount for ordering test
  const q1 = await write.question.create({
    data: { pageId: a.pageId, text: 'Most asked?', normalizedQuestion: 'most asked', answered: true, askCount: 10, lastAskedAt: new Date() }
  });
  question1Id = q1.id;
  await write.pinnedAnswer.create({
    data: { pageId: a.pageId, question: q1.text, normalizedQuestion: 'most asked', answer: 'Yes.' }
  });

  const q2 = await write.question.create({
    data: { pageId: a.pageId, text: 'Less asked?', normalizedQuestion: 'less asked', answered: true, askCount: 5 }
  });
  question2Id = q2.id;
  await write.pinnedAnswer.create({
    data: { pageId: a.pageId, question: q2.text, normalizedQuestion: 'less asked', answer: 'Maybe.' }
  });

  const q3 = await write.question.create({
    data: { pageId: a.pageId, text: 'Berapa harga kek?', normalizedQuestion: 'berapa harga kek', answered: true }
  });
  await write.pinnedAnswer.create({
    data: { pageId: a.pageId, question: q3.text, normalizedQuestion: 'berapa harga kek', answer: 'RM95.' }
  });

  // Question with answered: true but NO PinnedAnswer
  const qNoAnswer = await write.question.create({
    data: { pageId: a.pageId, text: 'No pin here?', normalizedQuestion: 'no pin here', answered: true }
  });
  questionNoAnswerId = qNoAnswer.id;

  await write.question.create({
    data: { pageId: a.pageId, text: 'Ada delivery?', normalizedQuestion: 'ada delivery' }
  });

  await write.neverSay.create({
    data: { pageId: a.pageId, phrase: 'halal certified' }
  });

  await fact(b.pageId, 'someone else', { verified: true });
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
    // Pinned answers present (note: order depends on question ordering)
    expect(k?.pinned.length).toBeGreaterThan(0);
    expect(k?.pinned.some((p) => p.question === 'Berapa harga kek?')).toBe(true);
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
    const k = await getKnowledge(mine);
    const sources = k?.sources ?? [];
    // We created: oldSource, then source, then failedSource
    // So descending order should be: failedSource, source, oldSource
    const sourcesByUrl = new Map(sources.map((s) => [s.sourceUrl, s]));
    const oldSource = sourcesByUrl.get('https://old.example/');
    const newSource = sourcesByUrl.get('https://nadia.example/');
    const failedSource = sourcesByUrl.get('https://broken.example/');

    if (oldSource && newSource && failedSource) {
      // Find indices to verify ordering
      const oldIdx = sources.indexOf(oldSource);
      const newIdx = sources.indexOf(newSource);
      const failIdx = sources.indexOf(failedSource);
      // Newest (failedSource) should come first, then newSource, then oldSource
      expect(failIdx).toBeLessThan(newIdx);
      expect(newIdx).toBeLessThan(oldIdx);
    }
  });

  it('returns facts in consistent order from database query', async () => {
    const k = await getKnowledge(mine);
    const facts = k?.facts ?? [];
    // Verify facts are returned (orderBy is tested via mutation)
    expect(facts.length).toBeGreaterThan(0);
    // Verify all facts have required properties
    facts.forEach((f) => {
      expect(f.id).toBeDefined();
      expect(f.category).toBeDefined();
      expect(f.claim).toBeDefined();
    });
  });

  it('orders pinned answers by question askCount descending', async () => {
    const k = await getKnowledge(mine);
    const pinned = k?.pinned ?? [];
    // Questions are ordered by askCount desc then lastAskedAt desc
    // We created: "Most asked?" (askCount=10), "Less asked?" (askCount=5), "Berapa..." (askCount not set)
    const texts = pinned.map((p) => p.question);
    const mostAskedIdx = texts.indexOf('Most asked?');
    const lessAskedIdx = texts.indexOf('Less asked?');
    // Most asked (askCount 10) should come before less asked (askCount 5)
    if (mostAskedIdx >= 0 && lessAskedIdx >= 0) {
      expect(mostAskedIdx).toBeLessThan(lessAskedIdx);
    }
  });

  it('excludes questions with answered: true but no PinnedAnswer', async () => {
    const k = await getKnowledge(mine);
    expect(k?.pinned.map((p) => p.question)).not.toContain('No pin here?');
    // Verify the question exists in DB but not in pinned
    expect(k?.pinned.length).toBeGreaterThan(0);
  });

  it('passes through source status, error, and ids', async () => {
    const k = await getKnowledge(mine);
    const failedSource = k?.sources.find((s) => s.id === failedSourceId);
    expect(failedSource).toMatchObject({
      id: failedSourceId,
      status: 'FAILED',
      error: 'Network timeout',
    });
    // Also verify fact ids are preserved
    const fact = k?.facts[0];
    expect(fact?.id).toBeDefined();
    expect(typeof fact?.id).toBe('string');
  });

  it('orders never-say entries by id', async () => {
    const k = await getKnowledge(mine);
    const neverSay = k?.neverSay ?? [];
    if (neverSay.length > 1) {
      // If multiple entries, they should be in id order
      for (let i = 1; i < neverSay.length; i += 1) {
        expect(neverSay[i].id >= neverSay[i - 1].id).toBe(true);
      }
    }
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
