import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { getOwnerPage, getOwnerStore } from '@curios/db-read';
import { Callout, Shell } from '@curios/ui';
import { avatarUrl } from '../../../lib/avatar-url.js';
import { resolveOwner } from '../session.js';
import { StoreScreen } from './store-screen.js';

export default async function StorePage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');
  const [store, page] = await Promise.all([getOwnerStore(owner.accountId), getOwnerPage(owner.accountId)]);
  if (!store || !page) redirect('/app/onboarding');

  if (store.mode === 'PERSONAL') {
    return (
      <Shell as="div" title="Store">
        <Callout tone="info">
          Shops are part of business pages. If you start selling, you can make this a business page from{' '}
          <a href="/app/billing">Billing</a>.
        </Callout>
      </Shell>
    );
  }

  return (
    <Shell as="div" title="Store" lede="Open a shop on your page: how customers pay, and how they get their order.">
      <StoreScreen
        initial={store.settings}
        handle={page.handle}
        uploadsEnabled={Boolean(process.env.STORAGE_PUBLIC_URL)}
        publicBase={process.env.STORAGE_PUBLIC_URL ?? ''}
        qrUrl={avatarUrl(store.settings.paymentQrKey)}
      />
    </Shell>
  );
}
