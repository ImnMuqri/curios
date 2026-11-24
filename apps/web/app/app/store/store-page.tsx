import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { orderState, SESSION_COOKIE } from '@curios/core';
import { MAX_ITEMS } from '@curios/core/store';
import { getMyCurios, getOwnerPage, getOwnerStore, getOwnerVouchers, getPickupPlaces, getSettings, type OwnerPage } from '@curios/db-read';
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
 * Why an open shop takes no orders now, in the deleted Alerts board's words for the
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

/** `?tab=payment` (the CHIP alert's link) or `?tab=vouchers` opens that tab; anything else opens Items. */
const TAB_NAMES = ['items', 'payment', 'delivery', 'vouchers'] as const;

/**
 * The Store, or one of its items: both routes read the same shop, so a reload or a shared link opens
 * either. `editing` is an item's id, 'new', or null for the Store itself; an id that is not this
 * shop's goes back to the Store.
 */
export async function renderStore({ tab, editing }: { tab?: string | string[]; editing: string | null }) {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');
  const initialTab = TAB_NAMES.find((name) => name === tab) ?? 'items';
  const [store, page, owned, vouchers, { freeOrders }] = await Promise.all([
    getOwnerStore(owner.accountId),
    getMyCurios(owner.accountId),
    getOwnerPage(owner.accountId),
    getOwnerVouchers(owner.accountId),
    getSettings(),
  ]);
  if (!store || !page || !owned) redirect('/app/onboarding');

  if (store.mode === 'PERSONAL') {
    return (
      <>
        <PageHead kicker="Your shop" title="Store" />
        <div className={panel.body}>
          <Callout tone="info">
            Shops are part of business pages. If you start selling, you can make this a business page from{' '}
            <a href="/app/billing">Billing</a>.
          </Callout>
        </div>
      </>
    );
  }

  if (editing && editing !== 'new' && !store.items.some((item) => item.id === editing)) redirect('/app/store');
  // A shop holds only so many items: a new one past that goes back to the Store, whose "+ Add item" says so.
  if (editing === 'new' && store.items.length >= MAX_ITEMS) redirect('/app/store');

  const pickupPlaces = await getPickupPlaces(owned.id);

  // The header is the screen's own: its counts and the open switch follow changes only the client sees.
  return (
    <StoreScreen
      initial={store.settings}
      items={store.items.map((item) => ({ ...item, photoUrl: avatarUrl(item.photoKey) }))}
      stats={store.itemStats ?? {}}
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
      vouchers={vouchers}
      pickupPlaces={pickupPlaces}
      initialTab={initialTab}
      editingId={editing}
      orders={{ paused: pausedWhy(owned, new Date(), freeOrders), nextNumber: owned.ordersPlaced + 1 }}
    />
  );
}
