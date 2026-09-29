import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getKnowledge, sourceLabel } from './knowledge.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let mine = '';
let theirs = '';
let sourceId = '';

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

  const source = await write.ingestion.create({ data: { pageId: a.pageId, sourceUrl: 'https://nadia.example/', status: 'SUCCEEDED' } });
  sourceId = source.id;
  await fact(a.pageId, 'from the site', { ingestionId: source.id, verified: true });
  await fact(a.pageId, 'pending from the site', { ingestionId: source.id });
  await fact(a.pageId, 'rejected from the site', { ingestionId: source.id, rejectedAt: new Date() });
  await fact(a.pageId, 'typed by the owner', { origin: 'OWNER', verified: true, category: 'HOURS' });
  await fact(a.pageId, 'from before', { origin: 'UNTRACKED', verified: true });
  await write.ingestion.create({ data: { pageId: a.pageId, pastedText: '\n\n  About Nadia Bakes\nMore.', status: 'SUCCEEDED', tracked: false } });

  const question = await write.question.create({ data: { pageId: a.pageId, text: 'Berapa harga kek?', normalizedQuestion: 'berapa harga kek', answered: true } });
  await write.pinnedAnswer.create({ data: { pageId: a.pageId, question: question.text, normalizedQuestion: 'berapa harga kek', answer: 'RM95.' } });
  await write.question.create({ data: { pageId: a.pageId, text: 'Ada delivery?', normalizedQuestion: 'ada delivery' } });
  await write.neverSay.create({ data: { pageId: a.pageId, phrase: 'halal certified' } });

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
    expect(k?.pinned.map((p) => [p.question, p.answer])).toEqual([['Berapa harga kek?', 'RM95.']]);
  });

  it('lists never-say entries', async () => {
    expect((await getKnowledge(mine))?.neverSay.map((n) => n.phrase)).toEqual(['halal certified']);
  });

  it("never shows another owner's knowledge", async () => {
    const k = await getKnowledge(theirs);
    expect(k?.facts.map((f) => f.claim)).toEqual(['someone else']);
    expect(JSON.stringify(await getKnowledge(mine))).not.toContain('someone else');
  });
});

describe('sourceLabel', () => {
  it('cuts a long line with an ellipsis, counting characters', () => {
    const label = sourceLabel(null, '🎂'.repeat(200));
    expect([...label]).toHaveLength(80);
    expect(label.endsWith('…')).toBe(true);
  });

  it('never returns an empty label', () => {
    expect(sourceLabel(null, '\n \n')).toBe('Pasted text');
  });
});
