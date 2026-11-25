import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ANSWER_MAX, FAQ_MIN_ASKS, SESSION_COOKIE, TOPIC_TITLE_MAX } from '@curios/core';
import { chatAnsweredIds, getAnswerRate, getMyCurios, getOwnerPage, getQuestionWeek, getTopicChoices, getTopics, getTopicTotals, questionWeekStart, type TopicShow } from '@curios/db-read';
import { resolveOwner } from '../session.js';
import { Questions } from './questions-screen.js';

/** The tab's name: "Curios - Questions" (the dashboard layout's template). */
export const metadata: Metadata = { title: 'Questions' };

/**
 * What customers actually ask, and the one screen that changes what the
 * product says back.
 *
 * Ranked by ask count. "Needs you" holds the topics the chat could not
 * answer on its own the last time it was asked (its "not sure" marker, see
 * unsure.ts), and the ones it has never replied to yet.
 */
/**
 * Topics a screen shows; `?page=2` is the next seven, most asked first. `?show=needs|answered` filters, before
 * paging. The old "Chat answers" filter is gone (owner, 19 Nov 2026): `?show=chat` links still open the page, as All.
 * `?topic=<id>` is one topic's own screen, from any page of the list; `show` and `page` ride along so "Questions" goes back to where it was.
 */
const TOPICS_PER_PAGE = 7;

const NO_WEEK = { thisWeek: 0, lastWeek: 0, days: [0, 0, 0, 0, 0, 0, 0] };
const NO_RATE = { answered: 0, recorded: 0 };

const SHOWS = ['all', 'needs', 'answered'] as const satisfies readonly TopicShow[];

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[]; show?: string | string[]; topic?: string | string[] }> }) {
  const query = await searchParams;
  const pageNumber = Math.max(1, Number.parseInt(typeof query.page === 'string' ? query.page : '1', 10) || 1);
  const show = SHOWS.find((s) => s === query.show) ?? 'all';
  const topicId = typeof query.topic === 'string' && query.topic ? query.topic : null;
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  // One moment for the whole screen, handed down, so "12 min ago" and the
  // week of asks read the same on the server and in the browser.
  const now = new Date();
  // What the chat answered on its own is one scan of the account's asks: read once, for the list and its totals.
  const chatIds = topicId ? Promise.resolve([]) : chatAnsweredIds(owner.accountId);
  const [topics, week, answerRate, owned, page, totals, choices] = await Promise.all([
    // The topic screen reads its one topic; the list is not on it.
    chatIds.then((ids) => getTopics(owner.accountId, topicId ? { now, id: topicId } : { now, show, limit: TOPICS_PER_PAGE, offset: (pageNumber - 1) * TOPICS_PER_PAGE, chatIds: ids })),
    // The strip's two figures count the same asks over the same window: recorded question asks over the 7
    // Malaysian calendar days ending today. A topic's own screen shows neither, so it reads neither.
    topicId ? NO_WEEK : getQuestionWeek(owner.accountId, now),
    topicId ? NO_RATE : getAnswerRate(owner.accountId, now, 7, { from: questionWeekStart(now) }),
    getOwnerPage(owner.accountId),
    // For the chat preview's colours.
    getMyCurios(owner.accountId),
    // Over every topic, not this screenful: each filter's count and pages, the answered share. The topic screen shows none of it.
    topicId ? Promise.resolve(undefined) : chatIds.then((ids) => getTopicTotals(owner.accountId, { chatIds: ids })),
    // What a topic can be merged into, from any page: only the topic screen merges (the list only needs to know if there are none, from the totals).
    topicId ? getTopicChoices(owner.accountId) : Promise.resolve(undefined),
  ]);
  if (!owned || !page) redirect('/app/onboarding');
  const pages = totals ? Math.max(1, Math.ceil(totals.topics[show] / TOPICS_PER_PAGE)) : 1;
  // Past the last page (topics merged or deleted since the link was made): the first one.
  if (!topicId && pageNumber > pages) redirect(show === 'all' ? '/app/questions' : `/app/questions?show=${show}`);
  // A topic that is gone (deleted or merged away, or never this owner's): the list again.
  // Back where it was: the same filter and page.
  if (topicId && topics.length === 0) redirect(`/app/questions${[show === 'all' ? '' : `show=${show}`, pageNumber > 1 ? `page=${pageNumber}` : ''].filter(Boolean).join('&').replace(/^(?=.)/, '?')}`);

  // Plain data across the boundary: strings, numbers, booleans and Dates all
  // cross fine. The handlers live inside `Questions`, a client component -- a
  // Server Component may not pass a function here, and doing so is a 500 at
  // request time that no gate catches.
  return (
    <Questions
      // Keyed by the page, as Leads is: each page of topics starts fresh after a client-side navigation.
      key={`${show}-${pageNumber}`}
      topics={topicId ? [] : topics}
      topic={topicId ? (topics[0] ?? null) : null}
      paging={{ page: pageNumber, pages }}
      show={show}
      totals={totals}
      choices={choices}
      week={week}
      answerRate={answerRate}
      publishesFaq={owned.mode === 'BUSINESS'}
      faqMinAsks={FAQ_MIN_ASKS}
      handle={page.handle}
      publicUrl={`${process.env.APP_URL ?? 'http://localhost:3000'}/${page.handle}`}
      answerMax={ANSWER_MAX}
      titleMax={TOPIC_TITLE_MAX}
      pageName={page.displayName}
      look={{ accentColor: page.accentColor, headingFont: page.headingFont, background: page.background, backgroundColor: page.backgroundColor }}
      now={now.toISOString()}
    />
  );
}
