import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { getOwnerPage, getOwnerStore } from '@curios/db-read';
import { Callout } from '@curios/ui';
import { avatarUrl } from '../../../lib/avatar-url.js';
import { resolveOwner } from '../session.js';
import { StoreScreen } from './store-screen.js';
import { PageHead } from '../_ui/page-head.js';
import panel from '../panel.module.css';

export default async function StorePage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');
  const [store, page] = await Promise.all([getOwnerStore(owner.accountId), getOwnerPage(owner.accountId)]);
  if (!store || !page) redirect('/app/onboarding');

  if (store.mode === 'PERSONAL') {
    return (
      <>
        <PageHead title="Store" />
        <div className={panel.body}>
          <Callout tone="info">
            Shops are part of business pages. If you start selling, you can make this a business page from{' '}
            <a href="/app/billing">Billing</a>.
          </Callout>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead title="Store" note="Open a shop on your page: how customers pay, and how they get their order." />
      <div className={panel.body}>
        <StoreScreen
          initial={store.settings}
          handle={page.handle}
          uploadsEnabled={Boolean(process.env.STORAGE_PUBLIC_URL)}
          publicBase={process.env.STORAGE_PUBLIC_URL ?? ''}
          qrUrl={avatarUrl(store.settings.paymentQrKey)}
          items={store.items.map((item) => ({ ...item, photoUrl: avatarUrl(item.photoKey) }))}
        />
      </div>
    </>
  );
}
