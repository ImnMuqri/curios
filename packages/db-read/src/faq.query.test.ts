import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { getFaqEntry, getFaqIndex } from './faq.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeEach(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

async function seedPage(input: { published?: boolean; mode?: 'PERSONAL' | 'BUSINESS' } = {}) {
  const account = await write.account.create({
    data: { email: `faqr-${randomUUID()}@example.com` },
    select: { id: true },
  });
  const handle = `faqr-${randomUUID().slice(0, 8)}`;
  const page = await write.page.create({
    data: {
      accountId: account.id,
      handle,
      skeleton: handle,
      displayName: 'Nadia Bakes',
      published: input.published ?? true,
      mode: input.mode ?? 'BUSINESS',
    },
    select: { id: true, handle: true },
  });
  return page;
}

async function seedAnswered(
  pageId: string,
  input: { suppressed?: boolean;
    text: string;
    slug: string | null;
    askCount?: number;
    answer?: string | null;
    // Real withdrawal (owner deletes the PinnedAnswer row) never tells
    // Question about it -- `answered` stays true with no PinnedAnswer behind
    // it. Defaulting to `input.answer !== null` keeps every existing call site
    // that means "answered normally" working unchanged; the two withdrawal
    // tests below pass `answered: true` explicitly so they model the real
    // shape instead of a state the product never produces.
    answered?: boolean;
  },
) {
  const normalizedQuestion = input.text.toLowerCase();
  await write.question.create({
    data: {
      pageId,
      text: input.text,
      normalizedQuestion,
      faqSlug: input.slug,
      faqSuppressed: input.suppressed ?? false,
      askCount: input.askCount ?? 5,
      answered: input.answered ?? input.answer !== null,
    },
  });
  if (input.answer !== null) {
    await write.pinnedAnswer.create({
      data: { pageId, question: input.text, normalizedQuestion, answer: input.answer ?? 'RM12 sekotak.' },
    });
  }
}

describe('getFaqIndex', () => {
  it('lists the slugged, answered questions most asked first', async () => {
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga', askCount: 4 });
    await seedAnswered(page.id, { text: 'Ada halal?', slug: 'ada-halal', askCount: 9 });

    const index = await getFaqIndex(page.handle);

    // Most asked first, the same order the owner sees on /app/questions, so the
    // public page and the dashboard agree about which question matters.
    expect(index!.entries.map((e) => e.slug)).toEqual(['ada-halal', 'berapa-harga']);
    expect(index!.displayName).toBe('Nadia Bakes');
  });

  it('omits a question that has no slug yet', async () => {
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga' });
    await seedAnswered(page.id, { text: 'Ada halal?', slug: null });

    const index = await getFaqIndex(page.handle);

    expect(index!.entries.map((e) => e.slug)).toEqual(['berapa-harga']);
  });

  it('omits a question whose answer the owner has withdrawn', async () => {
    // Reading through PinnedAnswer rather than caching the text means a
    // withdrawal takes effect on the next call to this function, not the next
    // revalidation (the page it feeds is a separate story -- see
    // faq.query.ts's doc comment on getFaqIndex).
    //
    // `answered: true` here is the point: withdrawing an answer deletes the
    // PinnedAnswer row but never touches Question.answered, which stays true.
    // Without this, the seed would leave `answered: false` and this test
    // would pass just the same against a wrong implementation that filtered
    // on Question.answered instead of on PinnedAnswer existing.
    const page = await seedPage();
    await seedAnswered(page.id, {
      text: 'Berapa harga?',
      slug: 'berapa-harga',
      answer: null,
      answered: true,
    });

    const index = await getFaqIndex(page.handle);

    expect(index!.entries).toEqual([]);
  });

  it('refuses an unpublished page', async () => {
    const page = await seedPage({ published: false });
    await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga' });

    expect(await getFaqIndex(page.handle)).toBeNull();
  });

  it('refuses a personal page', async () => {
    const page = await seedPage({ mode: 'PERSONAL' });
    await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga' });

    expect(await getFaqIndex(page.handle)).toBeNull();
  });

  it('returns null for a handle nobody has claimed', async () => {
    expect(await getFaqIndex('nobody-has-this-handle-zzz')).toBeNull();
  });

  it('clamps the limit rather than trusting a caller', async () => {
    // 101 slugged, answered questions -- one more than MAX_LIMIT -- so that a
    // caller-supplied limit above the cap can only return 100 if the cap is
    // actually enforced. Fewer rows than the cap would pass whether or not
    // the clamp exists, which is the illusion this test exists to rule out.
    const page = await seedPage();
    const rows = Array.from({ length: 101 }, (_, i) => {
      const text = `Soalan nombor ${i}?`;
      return {
        pageId: page.id,
        text,
        normalizedQuestion: text.toLowerCase(),
        faqSlug: `soalan-${i}`,
        askCount: 1,
        answered: true,
      };
    });
    await write.question.createMany({ data: rows });
    await write.pinnedAnswer.createMany({
      data: rows.map((r) => ({
        pageId: page.id,
        question: r.text,
        normalizedQuestion: r.normalizedQuestion,
        answer: 'RM12 sekotak.',
      })),
    });

    const index = await getFaqIndex(page.handle, { limit: 150 });

    expect(index!.entries).toHaveLength(100);
  });
});

describe('suppression', () => {
  it('drops a suppressed question from the index', async () => {
    // The takedown. The row keeps its slug and its answer -- the owner has
    // said "not public", not "never happened" -- so only this flag stands
    // between a customer's words and a search result.
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga' });
    await seedAnswered(page.id, { text: 'Ada halal?', slug: 'ada-halal', suppressed: true });

    const index = await getFaqIndex(page.handle);

    expect(index!.entries.map((e) => e.slug)).toEqual(['berapa-harga']);
  });

  it('404s a suppressed question at its own URL, not just in the index', async () => {
    // Hiding it from the index while the direct link still resolves would be
    // no takedown at all -- the URL is the thing that got indexed.
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Ada halal?', slug: 'ada-halal', suppressed: true });

    expect(await getFaqEntry(page.handle, 'ada-halal')).toBeNull();
  });

  it('serves it again once the owner unsuppresses', async () => {
    // Reversible on purpose: an owner who hid something by mistake should not
    // need a database console to undo it.
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Ada halal?', slug: 'ada-halal', suppressed: true });
    await write.question.updateMany({
      where: { pageId: page.id, faqSlug: 'ada-halal' },
      data: { faqSuppressed: false },
    });

    expect(await getFaqEntry(page.handle, 'ada-halal')).not.toBeNull();
  });
});

describe('getFaqEntry', () => {
  it('returns the question and the owner exact answer', async () => {
    const page = await seedPage();
    await seedAnswered(page.id, {
      text: 'Berapa harga?',
      slug: 'berapa-harga',
      answer: 'RM12 sekotak, RM60 lima kotak.',
    });

    const entry = await getFaqEntry(page.handle, 'berapa-harga');

    expect(entry).toEqual({
      handle: page.handle,
      displayName: 'Nadia Bakes',
      question: 'Berapa harga?',
      answer: 'RM12 sekotak, RM60 lima kotak.',
    });
  });

  it('returns null once the answer is withdrawn, though the slug remains', async () => {
    // `answered: true`: a withdrawal never resets Question.answered, so a test
    // that let it default to false would also pass a wrong implementation
    // gated on that field rather than on PinnedAnswer existing.
    const page = await seedPage();
    await seedAnswered(page.id, {
      text: 'Berapa harga?',
      slug: 'berapa-harga',
      answer: null,
      answered: true,
    });

    expect(await getFaqEntry(page.handle, 'berapa-harga')).toBeNull();
  });

  it('returns null for a withdrawn answer exactly as withdrawAnswer leaves it', async () => {
    // withdrawAnswer deletes the PinnedAnswer, sets answered:false and keeps the
    // slug. The route 404s on this state because there is no PinnedAnswer.
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga', answer: null, answered: false });

    expect(await getFaqEntry(page.handle, 'berapa-harga')).toBeNull();
  });

  it('refuses an unpublished page', async () => {
    const page = await seedPage({ published: false });
    await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga' });

    expect(await getFaqEntry(page.handle, 'berapa-harga')).toBeNull();
  });

  it('refuses a personal page', async () => {
    const page = await seedPage({ mode: 'PERSONAL' });
    await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga' });

    expect(await getFaqEntry(page.handle, 'berapa-harga')).toBeNull();
  });

  it('resolves a mixed-case slug, since faqSlugBase only ever generates lowercase ones', async () => {
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga' });

    expect(await getFaqEntry(page.handle, 'Berapa-Harga')).not.toBeNull();
  });

  it('does not serve one page slug from another page', async () => {
    // The gate that matters most here: a slug is unique per page, not global.
    const [mine, theirs] = await Promise.all([seedPage(), seedPage()]);
    await seedAnswered(theirs.id, { text: 'Berapa harga?', slug: 'berapa-harga' });

    expect(await getFaqEntry(mine.handle, 'berapa-harga')).toBeNull();
  });
});
