import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { getFaqEntry, getFaqIndex, getFaqRedirect } from './faq.query.js';

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
  input: {
    suppressed?: boolean;
    text: string;
    slug: string | null;
    askCount?: number;
    /** null is a withdrawn (or never given) answer. */
    answer?: string | null;
    lastAskedAt?: Date;
  },
) {
  return write.topic.create({
    data: {
      pageId,
      title: input.text,
      faqSlug: input.slug,
      faqSuppressed: input.suppressed ?? false,
      askCount: input.askCount ?? 5,
      answer: input.answer === undefined ? 'RM12 sekotak.' : input.answer,
      ...(input.lastAskedAt ? { lastAskedAt: input.lastAskedAt } : {}),
    },
  });
}

describe('getFaqIndex', () => {
  it('lists the slugged, answered topics most asked first', async () => {
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga', askCount: 4 });
    await seedAnswered(page.id, { text: 'Ada halal?', slug: 'ada-halal', askCount: 9 });

    const index = await getFaqIndex(page.handle);

    // Most asked first, the same order the owner sees on /app/questions, so the
    // public page and the dashboard agree about which question matters.
    expect(index!.entries.map((e) => e.slug)).toEqual(['ada-halal', 'berapa-harga']);
    expect(index!.entries[0]).toEqual({ slug: 'ada-halal', question: 'Ada halal?' });
    expect(index!.displayName).toBe('Nadia Bakes');
  });

  it('puts the more recently asked first when ask counts tie', async () => {
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Lama?', slug: 'lama', askCount: 3, lastAskedAt: new Date('2026-01-01T00:00:00Z') });
    await seedAnswered(page.id, { text: 'Baru?', slug: 'baru', askCount: 3, lastAskedAt: new Date('2026-02-01T00:00:00Z') });

    const index = await getFaqIndex(page.handle);

    expect(index!.entries.map((e) => e.slug)).toEqual(['baru', 'lama']);
  });

  it('omits a topic that has no slug yet', async () => {
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga' });
    await seedAnswered(page.id, { text: 'Ada halal?', slug: null });

    const index = await getFaqIndex(page.handle);

    expect(index!.entries.map((e) => e.slug)).toEqual(['berapa-harga']);
  });

  it('omits a topic whose answer the owner has withdrawn', async () => {
    // The answer lives on the topic, so withdrawing it takes effect on the next
    // call to this function, not the next revalidation. The slug stays.
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga', answer: null });

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
    // 101 slugged, answered topics -- one more than MAX_LIMIT -- so a
    // caller-supplied limit above the cap can only return 100 if the cap is
    // actually enforced.
    const page = await seedPage();
    await write.topic.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({
        pageId: page.id,
        title: `Soalan nombor ${i}?`,
        faqSlug: `soalan-${i}`,
        askCount: 1,
        answer: 'RM12 sekotak.',
      })),
    });

    const index = await getFaqIndex(page.handle, { limit: 150 });

    expect(index!.entries).toHaveLength(100);
  });
});

describe('suppression', () => {
  it('drops a suppressed topic from the index', async () => {
    // The takedown. The row keeps its slug and its answer -- the owner has
    // said "not public", not "never happened" -- so only this flag stands
    // between a customer's words and a search result.
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga' });
    await seedAnswered(page.id, { text: 'Ada halal?', slug: 'ada-halal', suppressed: true });

    const index = await getFaqIndex(page.handle);

    expect(index!.entries.map((e) => e.slug)).toEqual(['berapa-harga']);
  });

  it('404s a suppressed topic at its own URL, not just in the index', async () => {
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Ada halal?', slug: 'ada-halal', suppressed: true });

    expect(await getFaqEntry(page.handle, 'ada-halal')).toBeNull();
  });

  it('serves it again once the owner unsuppresses', async () => {
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Ada halal?', slug: 'ada-halal', suppressed: true });
    await write.topic.updateMany({
      where: { pageId: page.id, faqSlug: 'ada-halal' },
      data: { faqSuppressed: false },
    });

    expect(await getFaqEntry(page.handle, 'ada-halal')).not.toBeNull();
  });
});

describe('getFaqEntry', () => {
  it('returns the title and the owner exact answer', async () => {
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
    const page = await seedPage();
    await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga', answer: null });

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

describe('getFaqRedirect', () => {
  it("returns the target topic's slug for a retired slug", async () => {
    const page = await seedPage();
    const target = await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga' });
    await write.faqRedirect.create({ data: { pageId: page.id, slug: 'harga-kek', topicId: target.id } });

    expect(await getFaqRedirect(page.handle, 'harga-kek')).toBe('berapa-harga');
  });

  it('resolves a mixed-case retired slug', async () => {
    const page = await seedPage();
    const target = await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga' });
    await write.faqRedirect.create({ data: { pageId: page.id, slug: 'harga-kek', topicId: target.id } });

    expect(await getFaqRedirect(page.handle, 'Harga-Kek')).toBe('berapa-harga');
  });

  it('returns null for a redirect whose topic is gone', async () => {
    const page = await seedPage();
    await write.faqRedirect.create({ data: { pageId: page.id, slug: 'harga-kek', topicId: null } });

    expect(await getFaqRedirect(page.handle, 'harga-kek')).toBeNull();
  });

  it('returns null for a slug nobody retired', async () => {
    const page = await seedPage();

    expect(await getFaqRedirect(page.handle, 'no-such-slug')).toBeNull();
  });

  it("never follows another page's redirect", async () => {
    const [mine, theirs] = await Promise.all([seedPage(), seedPage()]);
    const target = await seedAnswered(theirs.id, { text: 'Berapa harga?', slug: 'berapa-harga' });
    await write.faqRedirect.create({ data: { pageId: theirs.id, slug: 'harga-kek', topicId: target.id } });

    expect(await getFaqRedirect(mine.handle, 'harga-kek')).toBeNull();
  });

  it('returns null when the target is suppressed, unanswered, or has no slug', async () => {
    const page = await seedPage();
    const suppressed = await seedAnswered(page.id, { text: 'A?', slug: 'a', suppressed: true });
    const unanswered = await seedAnswered(page.id, { text: 'B?', slug: 'b', answer: null });
    const slugless = await seedAnswered(page.id, { text: 'C?', slug: null });
    await write.faqRedirect.createMany({
      data: [
        { pageId: page.id, slug: 'old-a', topicId: suppressed.id },
        { pageId: page.id, slug: 'old-b', topicId: unanswered.id },
        { pageId: page.id, slug: 'old-c', topicId: slugless.id },
      ],
    });

    expect(await getFaqRedirect(page.handle, 'old-a')).toBeNull();
    expect(await getFaqRedirect(page.handle, 'old-b')).toBeNull();
    expect(await getFaqRedirect(page.handle, 'old-c')).toBeNull();
  });

  it('refuses an unpublished or personal page', async () => {
    const unpublished = await seedPage({ published: false });
    const personal = await seedPage({ mode: 'PERSONAL' });
    for (const page of [unpublished, personal]) {
      const target = await seedAnswered(page.id, { text: 'Berapa harga?', slug: 'berapa-harga' });
      await write.faqRedirect.create({ data: { pageId: page.id, slug: 'harga-kek', topicId: target.id } });
      expect(await getFaqRedirect(page.handle, 'harga-kek')).toBeNull();
    }
  });
});
