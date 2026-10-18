import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ANSWER_MAX, FAQ_MIN_ASKS, SESSION_COOKIE, TOPIC_TITLE_MAX } from '@curios/core';
import { countQuestionsThisWeek, getAnswerRate, getMyCurios, getOwnerPage, getTopics } from '@curios/db-read';
import { resolveOwner } from '../session.js';
import { Questions } from './questions-screen.js';

/**
 * What customers actually ask, and the one screen that changes what the
 * product says back.
 *
 * Ranked by ask count. BACKEND.md's original design ranked by whether the
 * model refused; that is not detected and is not detectable across Malay,
 * Manglish and English -- see its refusal rule. A question asked nine times is
 * a gap either way.
 */
export default async function QuestionsPage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  // One moment for the whole screen, handed down, so "12 min ago" and the
  // week of asks read the same on the server and in the browser.
  const now = new Date();
  const [topics, askedThisWeek, answerRate, owned, page] = await Promise.all([
    getTopics(owner.accountId, { now }),
    countQuestionsThisWeek(owner.accountId, now),
    getAnswerRate(owner.accountId, now),
    getOwnerPage(owner.accountId),
    // For the chat preview's colours.
    getMyCurios(owner.accountId),
  ]);
  if (!owned || !page) redirect('/app/onboarding');

  // Plain data across the boundary: strings, numbers, booleans and Dates all
  // cross fine. The handlers live inside `Questions`, a client component -- a
  // Server Component may not pass a function here, and doing so is a 500 at
  // request time that no gate catches.
  return (
    <Questions
      topics={topics}
      askedThisWeek={askedThisWeek}
      answerRate={answerRate}
      publishesFaq={owned.mode === 'BUSINESS'}
      faqMinAsks={FAQ_MIN_ASKS}
      handle={page.handle}
      publicUrl={`${process.env.APP_URL ?? 'http://localhost:3000'}/${page.handle}`}
      answerMax={ANSWER_MAX}
      titleMax={TOPIC_TITLE_MAX}
      look={{ accentColor: page.accentColor, headingFont: page.headingFont, background: page.background, backgroundColor: page.backgroundColor }}
      now={now.toISOString()}
    />
  );
}
