import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { orderState, SESSION_COOKIE } from '@curios/core';
import { getMyCurios, getOwnerPage, getOwnerStore, getSettings, type OwnerPage } from '@curios/db-read';
import { shortDate } from '../billing/billing-copy.js';
import { Callout } from '@curios/ui';
import { avatarUrl, coverUrl } from '../../../lib/avatar-url.js';
import { whatsappNumber } from '../../[handle]/shop/basket.js';
import { resolveOwner } from '../session.js';
import { StoreScreen } from './store-screen.js';
import { PageHead } from '../_ui/page-head.js';
import panel from '../panel.module.css';

/** Today in Malaysia, as YYYY-MM-DD: the day the notice strip counts from. */
function todayInMalaysia(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(now);
}

/**
 * Why an open shop takes no orders now, in the Alerts board's words for the
 * same pause, or null while it may. orderState decides, as it does for the
 * shop, the API, Alerts and Billing, against the free orders in force.
 */
function pausedWhy(page: Pick<OwnerPage, 'mode' | 'paidUntil' | 'ordersPlaced' | 'ordersAtTrialReset'>, now: Date, freeOrders: number): string | null {
  const state = orderState({ ...page, now }, freeOrders);
  switch (state.kind) {
    case 'trialSpent':
      return `Paused: your ${freeOrders} free orders are used.`;
    case 'lapsed':
      return `Paused: your plan ended on ${shortDate(state.paidUntil, true)}.`;
    default:
      return null;
  }
}

/** `?tab=payment` (the CHIP alert's link) opens that tab; anything else opens Items. */
const TAB_NAMES = ['items', 'payment', 'delivery'] as const;

export default async function StorePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');
  const asked = (await searchParams).tab;
  const initialTab = TAB_NAMES.find((name) => name === asked) ?? 'items';
  const [store, page, owned, { freeOrders }] = await Promise.all([getOwnerStore(owner.accountId), getMyCurios(owner.accountId), getOwnerPage(owner.accountId), getSettings()]);
  if (!store || !page || !owned) redirect('/app/onboarding');

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

  // The header (title, save status, open switch) is the screen's own: it
  // follows saves only the client sees.
  return (
    <StoreScreen
      initial={store.settings}
      items={store.items.map((item) => ({ ...item, photoUrl: avatarUrl(item.photoKey) }))}
      look={{
        handle: page.handle,
        displayName: page.displayName,
        bio: page.bio,
        language: page.language,
        avatarUrl: avatarUrl(page.avatarKey),
        coverUrl: coverUrl(page.coverKey),
        style: page.style,
        accentColor: page.accentColor,
        headingFont: page.headingFont,
        background: page.background,
        backgroundColor: page.backgroundColor,
        socials: page.socials,
        whatsapp: whatsappNumber(page.links),
      }}
      qrUrl={avatarUrl(store.settings.paymentQrKey)}
      uploadsEnabled={Boolean(process.env.STORAGE_PUBLIC_URL)}
      publicBase={process.env.STORAGE_PUBLIC_URL ?? ''}
      today={todayInMalaysia()}
      now={new Date()}
      chip={store.chip}
      initialTab={initialTab}
      orders={{ paused: pausedWhy(owned, new Date(), freeOrders), nextNumber: owned.ordersPlaced + 1 }}
    />
  );
}
