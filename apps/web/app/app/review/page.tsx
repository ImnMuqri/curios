import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { getOwnerPage, getReviewQueue } from '@curios/db-read';
import { resolveOwner } from '../session.js';
import { Review } from './review-queue.js';
import { Publish } from './publish-button.js';
import styles from './review.module.css';

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

  // Built here, on the server: the owner needs an address they can paste
  // into a bio, so a relative `/handle` is not enough, and `APP_URL` is
  // already loaded via `node --env-file` before Next starts (B2). Rejected a
  // NEXT_PUBLIC_APP_URL: a second copy of a value we already have, exposed to
  // the browser, to save one line in a component that is already
  // server-side. Rejected `window.location.origin`: unavailable during the
  // server render, so the link would flicker in or arrive absent.
  const publicUrl = `${process.env.APP_URL ?? 'http://localhost:3000'}/${page.handle}`;

  // Plain data across the boundary -- `ReviewFact` is strings, nulls and a
  // number, `publicUrl` is a string and `page.published` is a boolean, so
  // all of it crosses fine. The handlers live inside `Review` and `Publish`,
  // both client components. A Server Component may not pass a function here;
  // that is a 500 at request time that no gate catches.
  //
  // `Publish` renders as a SIBLING of `Review`, not inside its empty state
  // (B3): "Nothing left to review. Publish when you are ready." lives inside
  // `ReviewQueue` and disappears whenever facts remain, so putting the
  // button there would hide it exactly when F5 says it must stay visible --
  // publishing is not gated on having reviewed anything. THIS LINE is where
  // F5 is actually decided, which is why page.test.tsx renders this
  // component and asserts the button is offered with facts present and
  // absent alike. `PublishButton` having no verification prop closes the
  // obvious route to a gate; it says nothing about this one.
  //
  // `Publish` is also the one wrapper on this screen with no `onChanged`
  // callback, unlike `Claim`, `Ingest` and `Review`, so it does not
  // `router.refresh()` on success. A6 stated that invariant screen-wide, so
  // this is a deliberate exception: `page.published` has exactly one
  // consumer, `PublishButton` itself, whose local `done` state already shows
  // the published view. The moment anything else on this route reads
  // `published` -- a "your page is live" badge, say -- this needs the
  // callback like the other three.
  return (
    <>
      <Review facts={facts} />
      {/* A shop, a LinkedIn bio, a second site: sources can arrive at any time,
          and each one's facts join this same queue. */}
      <a className={styles.addSource} href="/app/onboarding">
        Add another source
      </a>
      <Publish publicUrl={publicUrl} published={page.published} />
    </>
  );
}
