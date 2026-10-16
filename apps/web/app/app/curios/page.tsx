import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { getMyCurios } from '@curios/db-read';
import { avatarUrl, coverUrl } from '../../../lib/avatar-url.js';
import { resolveOwner } from '../session.js';
import { MyCurios } from './my-curios-wrapper.js';
import { PageHead } from '../_ui/page-head.js';
import panel from '../panel.module.css';

export default async function MyCuriosPage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');
  const page = await getMyCurios(owner.accountId);
  if (!page) redirect('/app/onboarding');

  return (
    <>
      <PageHead title="My Curios">
        <a className={panel.primaryLink} href={`/${page.handle}`} target="_blank" rel="noreferrer">
          View page
        </a>
      </PageHead>
      <MyCurios
        initial={{ ...page, avatarUrl: avatarUrl(page.avatarKey), coverUrl: coverUrl(page.coverKey), shopPhotoUrl: avatarUrl(page.shop?.photoKey ?? null) }}
        uploadsEnabled={Boolean(process.env.STORAGE_PUBLIC_URL)}
        publicBase={process.env.STORAGE_PUBLIC_URL ?? ''}
      />
    </>
  );
}
