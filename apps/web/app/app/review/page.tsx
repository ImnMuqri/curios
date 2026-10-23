import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { countPendingFacts, getMyCurios, getOwnerPage, getReviewQueue } from '@curios/db-read';

import { resolveOwner } from '../session.js';
import { Review } from './review-queue.js';
import { Publish } from './publish-button.js';
import { PageHead } from '../_ui/page-head.js';
import panel from '../panel.module.css';

/**
 * The highest-leverage screen in the product, per FRONTEND.md: the one place
 * a mistake is unrecoverable, because a wrong price published to a stranger
 * cannot be un-shown to whoever already saw it. From the design handoff's
 * Review board: one fact at a time on a stack, and beside it what the chat
 * can say once it is accepted.
 *
 * `getOwnerPage` before the rest: the queue is meaningless without a page
 * for the facts to belong to, so an owner with no page yet is sent back to
 * claim one rather than shown an empty queue that looks like success.
 *
 * Bound at 50, oldest first -- `getReviewQueue` already clamps and orders;
 * this screen must not undo that by asking for more. `countPendingFacts` is
 * the same filter counted, so the progress line counts the real queue.
 */
export default async function ReviewPage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  const page = await getOwnerPage(owner.accountId);
  if (!page) redirect('/app/onboarding');

  const [facts, pending, look] = await Promise.all([
    getReviewQueue(owner.accountId, { limit: 50 }),
    countPendingFacts(owner.accountId),
    // For the chat preview's colours.
    getMyCurios(owner.accountId),
  ]);

  // Built here, on the server: the owner needs an address they can paste
  // into a bio, so a relative `/handle` is not enough, and `APP_URL` is
  // already loaded before Next starts (B2).
  const publicUrl = `${process.env.APP_URL ?? 'http://localhost:3000'}/${page.handle}`;

  // Plain data across the boundary, and `Publish` as an element: the
  // handlers live inside `Review` and `Publish`, both client components. A
  // Server Component may not pass a function here; that is a 500 at request
  // time that no gate catches.
  //
  // `Publish` is handed to the side panel UNCONDITIONALLY (B3/F5): it must
  // not depend on whether facts remain, because publishing is not gated on
  // having reviewed anything. THIS LINE is where F5 is actually decided,
  // which is why page.test.tsx renders this component and asserts the
  // button is offered with facts present and absent alike.
  return (
    <>
      <PageHead title="Review" note="Facts found in your sources. Accept, edit or reject each one.">
        {/* A shop, a LinkedIn bio, a second site: sources can arrive at any
            time, and each one's facts join this same queue. */}
        <a className={panel.secondaryLink} href="/app/knowledge?tab=sources&add=1">
          Add another source
        </a>
      </PageHead>
      <Review
        facts={facts}
        pending={pending}
        published={page.published}
        pageName={page.displayName}
        look={look ? { accentColor: look.accentColor, headingFont: look.headingFont, background: look.background, backgroundColor: look.backgroundColor } : undefined}
        footer={<Publish publicUrl={publicUrl} published={page.published} />}
      />
    </>
  );
}
