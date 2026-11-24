import { getOrderByToken } from '@curios/db-read';
import { shopCopy } from '../../../shop/copy.js';
import { pickupCalendar, sessionCalendar } from './ics.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

/**
 * "Add to calendar" for a class: an .ics for one SESSION line of a paid order,
 * `?line=<orderLineId>`, from the booked time and the minutes the buyer was sold.
 * Or, with `?pickup=1`, "Add to calendar" for a pickup order: its day and window at its place
 * (any order that is not cancelled, paid or not: the customer may add the day before paying).
 * The order token is the credential, as on the order page; an unpaid order's class, or a
 * line that is not a session of that order, is a plain 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ handle: string; token: string }> }) {
  const { handle, token } = await params;
  const query = new URL(request.url).searchParams;
  const lineId = query.get('line');
  const pickup = query.get('pickup') === '1';
  if (!lineId && !pickup) return notFound();
  const order = await getOrderByToken(token);
  if (!order || order.page.handle !== handle.toLowerCase()) return notFound();
  if (pickup) {
    if (order.method !== 'PICKUP' || !order.day || order.status === 'CANCELLED') return notFound();
    const body = pickupCalendar({
      uid: `${order.id}@curios`,
      now: new Date(),
      day: order.day,
      from: order.pickupFrom,
      to: order.pickupTo,
      title: shopCopy(order.page.language).pickupCalTitle(order.page.displayName),
      where: [order.pickupPlaceName, order.pickupPlaceAddress].filter(Boolean).join(', ') || null,
      shopName: order.page.displayName,
      orderUrl: `${new URL(request.url).origin}/${order.page.handle}/order/${encodeURIComponent(token)}`,
    });
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="pickup-${order.number}.ics"`,
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }
  if (!lineId) return notFound();
  if (order.status !== 'PAID' && order.status !== 'COMPLETED') return notFound();
  const line = order.lines.find((l) => l.id === lineId);
  if (!line || line.delivery !== 'SESSION' || !line.sessionStartsAt || !line.sessionMinutes) return notFound();

  const origin = new URL(request.url).origin;
  const body = sessionCalendar({
    uid: `${line.id}@curios`,
    now: new Date(),
    startsAt: line.sessionStartsAt,
    minutes: line.sessionMinutes,
    title: line.itemName,
    // The meeting URL or the place, as sold (null if the line has neither).
    // A suspended shop hands out no meeting link: only a place (in person) still goes in the file.
    where: order.page.suspended && line.sessionPlace === 'ONLINE' ? null : line.sessionWhere,
    shopName: order.page.displayName,
    orderUrl: `${origin}/${order.page.handle}/order/${encodeURIComponent(token)}`,
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="class-${order.number}.ics"`,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
