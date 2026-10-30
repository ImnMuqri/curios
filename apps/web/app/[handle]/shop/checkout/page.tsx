import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getCheckout, getSettings } from '@curios/db-read';
import { UNAVAILABLE_METADATA, UnavailableScreen, suspendedLanguage } from '../../../_system/unavailable.js';
import { PageTheme } from '../../../_bento/BentoPage.js';
import { avatarUrl, coverUrl } from '../../../../lib/avatar-url.js';
import { whatsappNumber } from '../basket.js';
import { Checkout } from './checkout.js';
import styles from './checkout.module.css';
import { coverTintOf } from '@curios/core/bento';

// Read live, like the shop: a price or a pause must show on the next request.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const shop = await getCheckout(handle);
  if (!shop) return (await suspendedLanguage(handle)) ? UNAVAILABLE_METADATA : {};
  return { title: `${shop.displayName} · Checkout` };
}

export default async function CheckoutPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const now = new Date();
  const shop = await getCheckout(handle, now);
  if (!shop) {
    const suspended = await suspendedLanguage(handle);
    if (suspended) return <UnavailableScreen language={suspended} />;
    notFound();
  }
  // Paused: back to the shop, whose basket bar is the WhatsApp fallback.
  if (!shop.canTakeOrders) redirect(`/${shop.handle}/shop`);
  // With CHIP payments off (the admin's switch) checkout offers only the owner's own QR or bank:
  // no CHIP methods are drawn, and none is asked for.
  const { switches } = await getSettings();

  return (
    <PageTheme theme={shop} className={styles.stage} paintDocument={{ tint: coverTintOf(shop) }}>
      <Checkout
        coverUrl={coverUrl(shop.coverKey)}
        handle={shop.handle}
        displayName={shop.displayName}
        language={shop.language}
        items={shop.items.map((i) => ({ ...i, photoUrl: avatarUrl(i.photoKey) }))}
        whatsapp={whatsappNumber(shop.links)}
        pickupEnabled={shop.pickupEnabled}
        pickupNote={shop.pickupNote}
        deliveryMode={shop.deliveryMode}
        deliveryFeeCents={shop.deliveryFeeCents}
        deliveryNote={shop.deliveryNote}
        minNoticeDays={shop.minNoticeDays}
        closedDays={shop.closedDays}
        payByQr={shop.payByQr}
        hasQr={shop.hasQr}
        vouchers={shop.vouchers}
        chipMethods={switches.chipPayments ? shop.chipMethods : null}
        // The server's clock, so the day pills the browser draws are the ones it rendered.
        now={now.toISOString()}
      />
    </PageTheme>
  );
}
