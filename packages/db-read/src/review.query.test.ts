import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getReviewQueue } from './review.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let mine = '';
let theirs = '';
let myPageId = '';

async function anOwnerWithAPage(): Promise<{ accountId: string; pageId: string }> {
  const slug = randomUUID().slice(0, 8);
  const account = await write.account.create({
    data: {
      email: `rq-${randomUUID()}@example.com`,
      pages: { create: { handle: `rq-${slug}`, skeleton: `rq-${slug}`, displayName: 'Q' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  return { accountId: account.id, pageId: account.pages[0]?.id ?? '' };
}

async function aFact(pageId: string, claim: string, extra: Record<string, unknown> = {}) {
  await write.fact.create({
    data: {
      pageId,
      category: 'PRICE',
      claim,
      normalizedClaim: claim,
      confidence: 0.9,
      ...extra,
    },
  });
}

beforeAll(async () => {
  const a = await anOwnerWithAPage();
  const b = await anOwnerWithAPage();
  mine = a.accountId;
  myPageId = a.pageId;
  theirs = b.accountId;

  await aFact(myPageId, 'kuih lapis is rm12');
  await aFact(myPageId, 'we open at nine', { verified: true });
  await aFact(myPageId, 'we are halal certified', { rejectedAt: new Date() });
  await aFact(b.pageId, 'someone elses fact');
});

describe('getReviewQueue', () => {
  it('returns only facts still awaiting review', async () => {
    const queue = await getReviewQueue(mine, { limit: 50 });

    // Verified facts are done. Rejected facts were answered once already, and
    // asking again is the thing the soft delete exists to prevent.
    expect(queue.map((f) => f.claim)).toEqual(['kuih lapis is rm12']);
  });

  it('returns nothing for an account that owns none of them', async () => {
    // Scoped in the query rather than filtered after the read. This is the
    // same shape as the ingest IDOR plan 1 closed, on a read path.
    expect(await getReviewQueue(theirs, { limit: 50 })).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ claim: 'kuih lapis is rm12' })]),
    );
  });

  it('carries the source line the review screen renders', async () => {
    const queue = await getReviewQueue(mine, { limit: 50 });

    // sourceText already exists in the schema, commented "the line it came
    // from, for the review screen". This is that screen.
    expect(queue[0]).toHaveProperty('sourceText');
  });

  it('bounds what it returns', async () => {
    for (let i = 0; i < 5; i += 1) await aFact(myPageId, `extra claim number ${i}`);

    // A 25-page crawl yields well over a hundred facts. Review is a queue that
    // empties, not a wall that intimidates.
    expect(await getReviewQueue(mine, { limit: 3 })).toHaveLength(3);
  });
});
