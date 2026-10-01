import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { getOwnerPage, getQuestions } from '@curios/db-read';
import { Shell } from '@curios/ui';
import { resolveOwner } from '../session.js';
import { Questions } from './question-list.js';

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

  const [questions, page] = await Promise.all([
    getQuestions(owner.accountId),
    getOwnerPage(owner.accountId),
  ]);

  // Plain data across the boundary: strings, numbers, booleans and Dates all
  // cross fine. The handler lives inside `Questions`, a client component -- a
  // Server Component may not pass a function here, and doing so is a 500 at
  // request time that no gate catches.
  return (
    <Shell as="div" title="Questions">
      <Questions questions={questions} publishesFaq={page?.mode === 'BUSINESS'} />
    </Shell>
  );
}
