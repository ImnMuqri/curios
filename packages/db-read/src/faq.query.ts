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
 * Every topic on a page that has earned a public URL and still has an answer,
 * most asked first.
 *
 * The answer lives on the topic, so withdrawing it drops the entry from this query immediately.
 * That is not the same as the public page updating immediately: `/[handle]/faq` and
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

  const topics = await prismaRead.topic.findMany({
    where: { pageId: page.id, faqSlug: { not: null }, faqSuppressed: false, answer: { not: null } },
    orderBy: [{ askCount: 'desc' }, { lastAskedAt: 'desc' }],
    take: Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
    select: { faqSlug: true, title: true },
  });

  return {
    handle: page.handle,
    displayName: page.displayName,
    // The slug is non-null by the query above; this narrows it for the type.
    entries: topics.map((t) => ({ slug: t.faqSlug as string, question: t.title })),
  };
}

/**
 * One topic and the owner's exact words.
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
  const topic = await prismaRead.topic.findFirst({
    where: { pageId: page.id, faqSlug: slug.toLowerCase(), faqSuppressed: false, answer: { not: null } },
    select: { title: true, answer: true },
  });
  if (!topic || topic.answer === null) return null;

  return { handle: page.handle, displayName: page.displayName, question: topic.title, answer: topic.answer };
}

/** Where a retired slug now lives: its topic's slug, or null if the topic is gone or the slug unknown. */
export async function getFaqRedirect(handle: string, slug: string): Promise<string | null> {
  const page = await publishedBusinessPage(handle);
  if (!page) return null;
  const redirect = await prismaRead.faqRedirect.findUnique({
    where: { pageId_slug: { pageId: page.id, slug: slug.toLowerCase() } },
    select: { topic: { select: { faqSlug: true, answer: true, faqSuppressed: true } } },
  });
  const topic = redirect?.topic;
  return topic && topic.faqSlug && topic.answer !== null && !topic.faqSuppressed ? topic.faqSlug : null;
}
