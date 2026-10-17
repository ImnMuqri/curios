import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { getMyCurios } from '@curios/db-read';
import { avatarUrl, coverUrl } from '../../../lib/avatar-url.js';
import { resolveOwner } from '../session.js';
import { MyCurios } from './my-curios-wrapper.js';

export default async function MyCuriosPage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');
  const page = await getMyCurios(owner.accountId);
  if (!page) redirect('/app/onboarding');

  // The header (title, save status, the page's address) is the editor's own:
  // it says whether the editor's changes have saved, which only the client knows.
  return (
    <MyCurios
      initial={{
        ...page,
        avatarUrl: avatarUrl(page.avatarKey),
        coverUrl: coverUrl(page.coverKey),
        shopItems: (page.shopTab?.preview ?? []).map((item) => ({ name: item.name, priceCents: item.priceCents, photoUrl: avatarUrl(item.photoKey) })),
      }}
      uploadsEnabled={Boolean(process.env.STORAGE_PUBLIC_URL)}
      publicBase={process.env.STORAGE_PUBLIC_URL ?? ''}
      // Built on the server, as Review does: the address an owner pastes into a bio.
      publicUrl={`${process.env.APP_URL ?? 'http://localhost:3000'}/${page.handle}`}
    />
  );
}
