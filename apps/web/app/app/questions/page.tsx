import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ANSWER_MAX, FAQ_MIN_ASKS, SESSION_COOKIE, TOPIC_TITLE_MAX } from '@curios/core';
import { countQuestionsThisWeek, getAnswerRate, getMyCurios, getOwnerPage, getTopicChoices, getTopics, getTopicTotals, type TopicShow } from '@curios/db-read';
import { resolveOwner } from '../session.js';
import { Questions } from './questions-screen.js';

/**
 * What customers actually ask, and the one screen that changes what the
 * product says back.
 *
 * Ranked by ask count. "Needs you" holds the topics the chat could not
 * answer on its own the last time it was asked (its "not sure" marker, see
 * unsure.ts), and the ones it has never replied to yet.
 */
/** Topics a screen shows; `?page=2` is the next seven, most asked first. `?show=needs|chat|answered` filters, before paging. */
const TOPICS_PER_PAGE = 7;

const SHOWS: readonly TopicShow[] = ['all', 'needs', 'chat', 'answered'];

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[]; show?: string | string[] }> }) {
  const query = await searchParams;
  const pageNumber = Math.max(1, Number.parseInt(typeof query.page === 'string' ? query.page : '1', 10) || 1);
  const show: TopicShow = SHOWS.find((s) => s === query.show) ?? 'all';
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  // One moment for the whole screen, handed down, so "12 min ago" and the
  // week of asks read the same on the server and in the browser.
  const now = new Date();
  const [topics, askedThisWeek, answerRate, owned, page, totals, choices] = await Promise.all([
    getTopics(owner.accountId, { now, show, limit: TOPICS_PER_PAGE, offset: (pageNumber - 1) * TOPICS_PER_PAGE }),
    countQuestionsThisWeek(owner.accountId, now),
    getAnswerRate(owner.accountId, now),
    getOwnerPage(owner.accountId),
    // For the chat preview's colours.
    getMyCurios(owner.accountId),
    // Over every topic, not this screenful: each filter's count and pages, the answered share, what to merge into.
    getTopicTotals(owner.accountId),
    getTopicChoices(owner.accountId),
  ]);
  if (!owned || !page) redirect('/app/onboarding');
  const pages = Math.max(1, Math.ceil(totals.topics[show] / TOPICS_PER_PAGE));
  // Past the last page (topics merged or deleted since the link was made): the first one.
  if (pageNumber > pages) redirect(show === 'all' ? '/app/questions' : `/app/questions?show=${show}`);

  // Plain data across the boundary: strings, numbers, booleans and Dates all
  // cross fine. The handlers live inside `Questions`, a client component -- a
  // Server Component may not pass a function here, and doing so is a 500 at
  // request time that no gate catches.
  return (
    <Questions
      // Keyed by the page, as Leads is: each page of topics starts fresh after a client-side navigation.
      key={`${show}-${pageNumber}`}
      topics={topics}
      paging={{ page: pageNumber, pages }}
      show={show}
      totals={totals}
      choices={choices}
      askedThisWeek={askedThisWeek}
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
