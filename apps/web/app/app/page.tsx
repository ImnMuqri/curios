import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
// The barrel here, unlike middleware.ts. This file runs on Node, so the
// barrel's transitive node:crypto import is fine. The split between the two
// is deliberate -- see the comment in middleware.ts.
import { SESSION_COOKIE } from '@curios/core';
import { getOwnerPage } from '@curios/db-read';
import { resolveOwner } from './session.js';

/**
 * A router, not a screen. Decides where a signed-in owner belongs: no page
 * yet sends them to onboarding to claim a handle, a page (published or not)
 * sends them to their review queue. This is the only place that decision is
 * made.
 */
export default async function AppPage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  // The layout already redirected an invalid session; this is belt and braces
  // for a direct render, and it narrows the type.
  if (!owner) redirect('/signin');

  const page = await getOwnerPage(owner.accountId);
  redirect(page ? '/app/review' : '/app/onboarding');
}
