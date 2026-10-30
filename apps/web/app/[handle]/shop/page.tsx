import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getCheckout } from '@curios/db-read';
import { UNAVAILABLE_METADATA, UnavailableScreen, suspendedLanguage } from '../../_system/unavailable.js';
import { PageTheme } from '../../_bento/BentoPage.js';
import { avatarUrl, coverUrl } from '../../../lib/avatar-url.js';
import { BasketBar } from './basket-bar.js';
import { whatsappNumber } from './basket.js';
import { shopCopy } from './copy.js';
import { nextOrderDay } from './pill.js';
import { ShopPageView } from './shop-page.js';
import styles from './shop-page.module.css';
import { coverTintOf } from '@curios/core/bento';

// Read live, like /[handle]: an item turned off must leave the shelf on the next request.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const shop = await getCheckout(handle);
  if (!shop) return (await suspendedLanguage(handle)) ? UNAVAILABLE_METADATA : {};
  return { title: `${shop.displayName} · Shop`, description: shop.shopDescription ?? `Order from ${shop.displayName} on Curios.` };
}

export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const { handle } = await params;
  const { item } = await searchParams;
  const shop = await getCheckout(handle);
  if (!shop) {
    const suspended = await suspendedLanguage(handle);
    if (suspended) return <UnavailableScreen language={suspended} />;
    notFound();
  }

  // Links shared before the product page (the chat's "Order" chips among them) name the item by id.
  const shared = item ? shop.items.find((candidate) => candidate.id === item) : undefined;
  if (shared) redirect(`/${shop.handle}/shop/${shared.slug}`);

  const copy = shopCopy(shop.language);
  const nextDay = nextOrderDay(shop, new Date());
  const barNote = nextDay ? (shop.pickupEnabled ? copy.barPickup(copy.dayLong(nextDay)) : copy.barDelivery(copy.dayLong(nextDay))) : false;

  // The shop has its own top bar, so it does not wear the page's header and tabs: only its look.
  return (
    <main>
      <PageTheme theme={shop} className={styles.stage} paintDocument={{ tint: coverTintOf(shop) }}>
        <div className={styles.column}>
          <ShopPageView
            handle={shop.handle}
            displayName={shop.displayName}
            language={shop.language}
            items={shop.items.map((i) => ({ ...i, photoUrl: avatarUrl(i.photoKey) }))}
            pickupEnabled={shop.pickupEnabled}
            pickupNote={shop.pickupNote}
            deliveryMode={shop.deliveryMode}
            canTakeOrders={shop.canTakeOrders}
            nextDay={nextDay}
            description={shop.shopDescription}
            halal={shop.shopHalal}
            coverUrl={coverUrl(shop.coverKey)}
            avatarUrl={avatarUrl(shop.avatarKey)}
            vouchers={shop.canTakeOrders ? shop.vouchers : []}
          />
          <BasketBar
            handle={shop.handle}
            displayName={shop.displayName}
            language={shop.language}
            items={shop.items}
            canTakeOrders={shop.canTakeOrders}
            whatsapp={whatsappNumber(shop.links)}
            note={barNote}
            vouchers={shop.canTakeOrders ? shop.vouchers : []}
          />
        </div>
      </PageTheme>
    </main>
  );
}
