import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOrderByToken, type PublicOrder } from '@curios/db-read';
import { PageTheme } from '../../../_bento/BentoPage.js';
import { avatarUrl } from '../../../../lib/avatar-url.js';
import { whatsappNumber } from '../../shop/basket.js';
import { OrderView } from './order-view.js';
import styles from '../../shop/checkout/checkout.module.css';

// Read live: the owner marking it paid must show on the customer's next reload.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A link that only its customer holds: never in a search engine, whatever the page's own setting. */
const NOT_INDEXED = { index: false, follow: false } as const;

type Params = { params: Promise<{ handle: string; token: string }> };

/**
 * The order, or null when the token is unknown or the order is another page's.
 * Cached per request, so the metadata and the page read it once.
 */
const load = cache(async (handle: string, token: string): Promise<PublicOrder | null> => {
  const order = await getOrderByToken(token);
  if (!order || order.page.handle !== handle.toLowerCase()) return null;
  return order;
});

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle, token } = await params;
  const order = await load(handle, token);
  // The URL is the order's whole key: no request from this page sends it on as a referrer.
  if (!order) return { robots: NOT_INDEXED, referrer: 'no-referrer' };
  return { title: `Order #${order.number} · ${order.page.displayName}`, robots: NOT_INDEXED, referrer: 'no-referrer' };
}

export default async function OrderPage({ params }: Params) {
  const { handle, token } = await params;
  const order = await load(handle, token);
  if (!order) notFound();
  const { page } = order;

  return (
    <PageTheme theme={page} className={styles.stage}>
      <OrderView
        token={token}
        handle={page.handle}
        displayName={page.displayName}
        language={page.language}
        order={{
          number: order.number,
          code: order.code,
          method: order.method,
          day: order.day,
          itemsCents: order.itemsCents,
          deliveryCents: order.deliveryCents,
          totalCents: order.totalCents,
          status: order.status,
          receiptType: order.receiptType,
          receiptUploadedAt: iso(order.receiptUploadedAt),
          receiptRejectedAt: iso(order.receiptRejectedAt),
          paidAt: iso(order.paidAt),
          refundedAt: iso(order.refundedAt),
          paidVia: order.paidVia,
          paidMethodLabel: order.paidMethodLabel,
          paidRef: order.paidRef,
          chipPending: order.chipPending,
          lines: order.lines.map(({ itemName, optionLabel, unitPriceCents, quantity }) => ({ itemName, optionLabel, unitPriceCents, quantity })),
        }}
        qrUrl={avatarUrl(page.paymentQrKey)}
        receiptUrl={avatarUrl(order.receiptKey)}
        bank={{ name: page.bankName, accountName: page.bankAccountName, accountNumber: page.bankAccountNumber }}
        whatsapp={whatsappNumber(page.links)}
        // The server's clock, so Ready lights on the day the server says it is.
        now={new Date().toISOString()}
      />
    </PageTheme>
  );
}
