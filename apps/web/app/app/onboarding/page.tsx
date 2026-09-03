import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { getOwnerPage } from '@curios/db-read';
import { resolveOwner } from '../session.js';
import { Claim } from './claim-form.js';
import { Ingest } from './ingest-form.js';

export default async function OnboardingPage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');

  const page = await getOwnerPage(owner.accountId);

  // Plain data across the boundary -- `page.id` is a string. The handler lives
  // inside `Ingest`, which is a client component.
  return page ? <Ingest pageId={page.id} /> : <Claim />;
}
