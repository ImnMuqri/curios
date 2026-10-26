import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LEAD_RETENTION_MONTHS, SESSION_COOKIE } from '@curios/core';
import { getOrderStats, getOwnerOrdersPage, getOwnerPage, getOwnerStore } from '@curios/db-read';
import { Callout } from '@curios/ui';
import { avatarUrl } from '../../../lib/avatar-url.js';
import { PageHead } from '../_ui/page-head.js';
import panel from '../panel.module.css';
import { resolveOwner } from '../session.js';
import type { OrderRow } from './order-detail.js';
import { Orders } from './orders-screen.js';

/**
 * What customers ordered from the shop, newest first: three figures, the
 * orders down the left, and the chosen one on the right with its receipt and
 * the one thing to do next.
 *
 * `getOwnerOrdersPage` scopes to this owner inside the query. Keys never leave the
 * server: the receipt and item photos go down as addresses, built here as
 * every other screen builds them. `?order=<id>` (the new-order email's link)
 * opens that order. `?before=<id>` is the next hundred finished orders, from
 * "Older orders"; what still needs the owner is always on the first page.
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ order?: string | string[]; before?: string | string[] }> }) {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  if (!owner) redirect('/signin');
  const page = await getOwnerPage(owner.accountId);
  if (!page) redirect('/app/onboarding');

  if (page.mode === 'PERSONAL') {
    return (
      <>
        <PageHead title="Orders" />
        <div className={panel.body}>
          <Callout tone="info">
            Orders come from a shop, and shops are part of business pages. If you start selling, you can make this a business page from{' '}
            <a href="/app/billing">Billing</a>.
          </Callout>
        </div>
      </>
    );
  }

  // One moment for the whole screen, so "today, 10:02am" and the week read the same on the server and in the browser.
  const now = new Date();
  const query = await searchParams;
  const before = typeof query.before === 'string' && query.before ? query.before : undefined;
  const [listed, stats, store] = await Promise.all([
    getOwnerOrdersPage(owner.accountId, { before, now }),
    getOrderStats(owner.accountId, now),
    getOwnerStore(owner.accountId),
  ]);
  // A cursor that pages nothing (the order deleted, or never this owner's finished one) is the first page again.
  if (!listed) redirect('/app/orders');
  const { orders, older } = listed;
  const rows: OrderRow[] = orders.map(({ receiptKey, lines, ...order }) => ({
    ...order,
    receiptUrl: avatarUrl(receiptKey),
    lines: lines.map(({ photoKey, ...line }) => ({ ...line, photoUrl: avatarUrl(photoKey) })),
  }));
  const selected = typeof query.order === 'string' ? query.order : null;
  const shopUrl = `/${page.handle}/shop`;

  return (
    <Orders
      orders={rows}
      paging={{ older, paged: before !== undefined }}
      stats={stats}
      now={now.toISOString()}
      selected={selected}
      keptMonths={LEAD_RETENTION_MONTHS}
      shopUrl={shopUrl}
      publicUrl={`${process.env.APP_URL ?? 'http://localhost:3000'}${shopUrl}`}
      pickupNote={store?.settings.pickupNote ?? null}
    />
  );
}
