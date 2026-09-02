import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { getOwnerPage, getReviewQueue } from '@curios/db-read';
import { resolveOwner } from '../session.js';
import { Review } from './review-queue.js';

/**
 * The highest-leverage screen in the product, per FRONTEND.md: the one place
 * a mistake is unrecoverable, because a wrong price published to a stranger
 * cannot be un-shown to whoever already saw it.
 *
 * `getOwnerPage` before `getReviewQueue`: the queue is meaningless without a
 * page for the facts to belong to, so an owner with no page yet is sent back
 * to claim one rather than shown an empty queue that looks like success.
 *
 * Bound at 50, oldest first -- `getReviewQueue` already clamps and orders;
 * this screen must not undo that by asking for more.
 */
export default async function ReviewPage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  const page = await getOwnerPage(owner.accountId);
  if (!page) redirect('/app/onboarding');

  const facts = await getReviewQueue(owner.accountId, { limit: 50 });

  // Plain data across the boundary -- `ReviewFact` is strings, nulls and a
  // number, so it crosses fine. The handlers live inside `Review`, which is a
  // client component. A Server Component may not pass a function here; that
  // is a 500 at request time that no gate catches.
  return <Review facts={facts} />;
}
