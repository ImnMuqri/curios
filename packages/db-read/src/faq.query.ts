import { PUBLIC_PAGE_WHERE } from '@curios/core';
import type { HeadingFont, PageBackground } from '@curios/core/bento';
import { prismaRead } from './client.js';

/** The page's own look, so its FAQ pages read as part of it. */
export interface FaqTheme {
  accentColor: string;
  headingFont: HeadingFont;
  background: PageBackground;
  backgroundColor: string | null;
}

export interface FaqListEntry {
  slug: string;
  question: string;
  answer: string;
  /** How many times visitors asked it, in any wording. */
  askCount: number;
}

export interface FaqIndex {
  handle: string;
  displayName: string;
  theme: FaqTheme;
  entries: FaqListEntry[];
  /** Every entry the index would list without a limit. */
  total: number;
}

export interface FaqAnswer {
  handle: string;
  displayName: string;
  theme: FaqTheme;
  question: string;
  answer: string;
  askCount: number;
  /** The page's other answers, most asked first ("People also ask"). */
  related: { slug: string; question: string }[];
}

/** How many other answers an entry page offers under its own. */
const RELATED = 3;

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
    where: { handle: handle.toLowerCase(), ...PUBLIC_PAGE_WHERE, mode: 'BUSINESS' },
    select: { id: true, handle: true, displayName: true, accentColor: true, headingFont: true, background: true, backgroundColor: true },
  });
}

function themeOf(page: FaqTheme): FaqTheme {
  return { accentColor: page.accentColor, headingFont: page.headingFont, background: page.background, backgroundColor: page.backgroundColor };
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

  const where = { pageId: page.id, faqSlug: { not: null }, faqSuppressed: false, answer: { not: null } };
  const [topics, total] = await Promise.all([
    prismaRead.topic.findMany({
      where,
      orderBy: [{ askCount: 'desc' }, { lastAskedAt: 'desc' }],
      take: Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
      select: { faqSlug: true, title: true, answer: true, askCount: true },
    }),
    prismaRead.topic.count({ where }),
  ]);

  return {
    handle: page.handle,
    displayName: page.displayName,
    theme: themeOf(page),
    // The slug and answer are non-null by the query above; this narrows them for the type.
    entries: topics.map((t) => ({ slug: t.faqSlug as string, question: t.title, answer: t.answer as string, askCount: t.askCount })),
    total,
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
    select: { id: true, title: true, answer: true, askCount: true },
  });
  if (!topic || topic.answer === null) return null;

  const related = await prismaRead.topic.findMany({
    where: { pageId: page.id, id: { not: topic.id }, faqSlug: { not: null }, faqSuppressed: false, answer: { not: null } },
    orderBy: [{ askCount: 'desc' }, { lastAskedAt: 'desc' }],
    take: RELATED,
    select: { faqSlug: true, title: true },
  });

  return {
    handle: page.handle,
    displayName: page.displayName,
    theme: themeOf(page),
    question: topic.title,
    answer: topic.answer,
    askCount: topic.askCount,
    related: related.map((t) => ({ slug: t.faqSlug as string, question: t.title })),
  };
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
