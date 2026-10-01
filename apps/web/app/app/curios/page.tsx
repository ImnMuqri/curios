import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { getMyCurios } from '@curios/db-read';
import { avatarUrl } from '../../../lib/avatar-url.js';
import { resolveOwner } from '../session.js';
import { MyCurios } from './my-curios-wrapper.js';

export default async function MyCuriosPage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');
  const page = await getMyCurios(owner.accountId);
  if (!page) redirect('/app/onboarding');

  return (
    <MyCurios
      initial={{ ...page, avatarUrl: avatarUrl(page.avatarKey) }}
      uploadsEnabled={Boolean(process.env.STORAGE_PUBLIC_URL)}
      publicBase={process.env.STORAGE_PUBLIC_URL ?? ''}
    />
  );
}
