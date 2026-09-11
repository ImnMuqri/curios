import { prismaRead } from './client.js';

export interface FaqListEntry {
  slug: string;
  question: string;
}

export interface FaqIndex {
  handle: string;
  displayName: string;
  entries: FaqListEntry[];
}

export interface FaqAnswer {
  handle: string;
  displayName: string;
  question: string;
  answer: string;
}

/** Enough for any real page; a bound so one owner cannot make a huge document. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Where the page's own gates live, so no route can forget one.
 *
 * `findFirst`, not `findUnique`: the handle is unique but `mode` is not part of
 * any unique index, and all three conditions have to be in the same query.
 */
function publishedBusinessPage(handle: string) {
  return prismaRead.page.findFirst({
    where: { handle: handle.toLowerCase(), published: true, mode: 'BUSINESS' },
    select: { id: true, handle: true, displayName: true },
  });
}

/**
 * Every question on a page that has earned a public URL and still has an
 * answer behind it, most asked first.
 *
 * Two queries rather than a join: `Question` and `PinnedAnswer` have no Prisma
 * relation, but both carry a unique `(pageId, normalizedQuestion)`, so this is
 * two indexed reads and an in-memory match -- no raw SQL, and no new foreign
 * key on a table the chat path writes to on every question.
 *
 * The answer is read through `PinnedAnswer` rather than cached onto `Question`
 * so that withdrawing an answer removes it from THIS query's result the very
 * next time it runs, without anyone having to remember a second write. That is
 * not the same as the public page updating immediately: `/[handle]/faq` and
 * `/[handle]/faq/[slug]` cache the rendered HTML for up to 60 seconds (Next ISR,
 * no `revalidatePath` call anywhere), so a page a visitor or a crawler already
 * has cached keeps showing the withdrawn answer until that window turns over.
 * This function is immediate; the route it feeds is not.
 */
export async function getFaqIndex(
  handle: string,
  options: { limit?: number } = {},
): Promise<FaqIndex | null> {
  const page = await publishedBusinessPage(handle);
  if (!page) return null;

  const questions = await prismaRead.question.findMany({
    where: { pageId: page.id, faqSlug: { not: null }, faqSuppressed: false },
    orderBy: [{ askCount: 'desc' }, { lastAskedAt: 'desc' }],
    take: Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
    select: { faqSlug: true, text: true, normalizedQuestion: true },
  });

  const answered = new Set(
    (
      await prismaRead.pinnedAnswer.findMany({
        where: {
          pageId: page.id,
          normalizedQuestion: { in: questions.map((q) => q.normalizedQuestion) },
        },
        select: { normalizedQuestion: true },
      })
    ).map((row) => row.normalizedQuestion),
  );

  return {
    handle: page.handle,
    displayName: page.displayName,
    entries: questions
      .filter((q) => answered.has(q.normalizedQuestion))
      // The slug is non-null by the query above; this narrows it for the type.
      .map((q) => ({ slug: q.faqSlug as string, question: q.text })),
  };
}

/**
 * One question and the owner's exact words.
 *
 * Null covers every failure the route turns into a 404: no such handle, a
 * personal page, an unpublished page, a slug nobody holds, and a slug whose
 * answer has been withdrawn. The route does not need to tell them apart.
 */
export async function getFaqEntry(handle: string, slug: string): Promise<FaqAnswer | null> {
  const page = await publishedBusinessPage(handle);
  if (!page) return null;

  // Lowercased, like the handle above: faqSlugBase generates slugs lowercase,
  // so a mixed-case inbound link (a typo, a chat client that title-cases URLs)
  // resolves instead of 404ing. Inbound links finding the page are the point
  // of this slice.
  const question = await prismaRead.question.findFirst({
    where: { pageId: page.id, faqSlug: slug.toLowerCase(), faqSuppressed: false },
    select: { text: true, normalizedQuestion: true },
  });
  if (!question) return null;

  const pinned = await prismaRead.pinnedAnswer.findUnique({
    where: {
      pageId_normalizedQuestion: {
        pageId: page.id,
        normalizedQuestion: question.normalizedQuestion,
      },
    },
    select: { answer: true },
  });
  if (!pinned) return null;

  return {
    handle: page.handle,
    displayName: page.displayName,
    question: question.text,
    answer: pinned.answer,
  };
}
