import { getOrderByToken } from '@curios/db-read';
import { sessionCalendar } from './ics.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

/**
 * "Add to calendar" for a class: an .ics for one SESSION line of a paid order,
 * `?line=<orderLineId>`, from the booked time and the minutes the buyer was sold.
 * The order token is the credential, as on the order page; an unpaid order, or a
 * line that is not a session of that order, is a plain 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ handle: string; token: string }> }) {
  const { handle, token } = await params;
  const lineId = new URL(request.url).searchParams.get('line');
  if (!lineId) return notFound();
  const order = await getOrderByToken(token);
  if (!order || order.page.handle !== handle.toLowerCase()) return notFound();
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
