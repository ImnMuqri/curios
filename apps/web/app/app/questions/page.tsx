import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ANSWER_MAX, SESSION_COOKIE, TOPIC_TITLE_MAX } from '@curios/core';
import { getOwnerPage, getTopics } from '@curios/db-read';

import { resolveOwner } from '../session.js';
import { Topics } from './topic-list.js';
import { PageHead } from '../_ui/page-head.js';
import panel from '../panel.module.css';

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

  const [topics, page] = await Promise.all([
    getTopics(owner.accountId),
    getOwnerPage(owner.accountId),
  ]);

  // Plain data across the boundary: strings, numbers, booleans and Dates all
  // cross fine. The handler lives inside `Topics`, a client component -- a
  // Server Component may not pass a function here, and doing so is a 500 at
  // request time that no gate catches.
  return (
    <>
      <PageHead title="Questions" note="What visitors ask your page, grouped by topic" />
      <div className={panel.body}>
        <Topics
          topics={topics}
          publishesFaq={page?.mode === 'BUSINESS'}
          answerMax={ANSWER_MAX}
          titleMax={TOPIC_TITLE_MAX}
        />
      </div>
    </>
  );
}
