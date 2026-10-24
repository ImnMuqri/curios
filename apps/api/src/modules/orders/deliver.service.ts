import { randomBytes } from 'node:crypto';
import { digitalDeliveryMail, MAIL_QUEUE, type DigitalMailItem } from '@curios/core';
import { DOWNLOAD_DAYS, DOWNLOAD_USES, seatsLeft } from '@curios/core/digital';
import { openSecret } from '@curios/core/secret-box';
import type { Prisma, PrismaClient } from '@curios/db';
import { OrderNotFoundError, OrderStateError, SoldOutError, TimeFullError } from './order.errors.js';
import type { OrderMailQueue } from './place.service.js';

const DAY_MS = 24 * 3_600_000;

/** The grant's id: opaque, and not a secret (the order token is the credential). */
const grantId = () => randomBytes(16).toString('hex');

/** One grant per FILES line per file, for the files the item has now. */
async function makeGrants(tx: Prisma.TransactionClient, orderId: string, now: Date): Promise<void> {
  const lines = await tx.orderLine.findMany({
    where: { orderId, kind: 'DIGITAL', delivery: 'FILES', itemId: { not: null } },
    select: { id: true, item: { select: { files: { orderBy: { position: 'asc' }, select: { id: true, name: true } } } } },
  });
  const expiresAt = new Date(now.getTime() + DOWNLOAD_DAYS * DAY_MS);
  const data = lines.flatMap((line) =>
    (line.item?.files ?? []).map((file) => ({
      token: grantId(),
      orderLineId: line.id,
      fileId: file.id,
      fileName: file.name,
      usesLeft: DOWNLOAD_USES,
      expiresAt,
      createdAt: now,
    })),
  );
  if (data.length > 0) await tx.downloadGrant.createMany({ data });
}

/**
 * Delivers a paid order's digital lines, once. The conditional update
 * `sentAt: null -> now` (PAID or COMPLETED, with a digital line) is the whole
 * guard: two paths racing, or a replayed webhook, find it already set and get
 * false. The winner makes the download grants (5 uses, 30 days, one per FILES
 * line per file) and stamps `givenAt` on the codes reserved at placement.
 * Returns true only for the winner, which then queues the delivery email after
 * its transaction commits. A cancelled order is never delivered; a physical-only
 * order is never "sent".
 */
export async function deliverOrder(tx: Prisma.TransactionClient, orderId: string, now: Date): Promise<boolean> {
  const { count } = await tx.order.updateMany({
    where: { id: orderId, status: { in: ['PAID', 'COMPLETED'] }, sentAt: null, lines: { some: { kind: 'DIGITAL' } } },
    data: { sentAt: now },
  });
  if (count === 0) return false;
  await makeGrants(tx, orderId, now);
  await tx.itemCode.updateMany({ where: { orderLine: { orderId }, givenAt: null }, data: { givenAt: now } });
  return true;
}

export interface DeliveryMailDeps {
  prisma: PrismaClient;
  mailQueue: OrderMailQueue;
  /** PAYMENT_SECRETS_KEY; null (or an order without a sealed token) sends the email without links. */
  secretsKey: Buffer | null;
  /** The web app, for the order page. */
  appUrl: string;
  log?: { warn?: (obj: object, msg: string) => void };
}

const trimSlash = (url: string) => url.replace(/\/+$/, '');
const apiBase = () => trimSlash(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001');

/** The order's token, or null where it was not sealed or its key has changed. */
function openToken(sealed: string | null, key: Buffer | null, log?: DeliveryMailDeps['log']): string | null {
  if (!sealed || !key) return null;
  try {
    return openSecret(sealed, key);
  } catch {
    log?.warn?.({}, 'order link could not be opened (PAYMENT_SECRETS_KEY changed?), so the email carries no links');
    return null;
  }
}

/**
 * Queues the buyer's delivery email, after the transaction that delivered has
 * committed (or for the owner's "send again"). Best-effort: the order is
 * delivered whether or not the email can be queued, so any failure is logged
 * with ids only and never thrown. Reads the order line (what was sold) and the
 * grants and codes as they are now: on a resend the newest grant per file.
 */
export async function queueDeliveryMail(deps: DeliveryMailDeps, orderId: string): Promise<void> {
  try {
    const order = await deps.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        number: true,
        totalCents: true,
        customerName: true,
        email: true,
        tokenSealed: true,
        page: { select: { handle: true, displayName: true, language: true } },
        lines: {
          where: { kind: 'DIGITAL' },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            itemName: true,
            optionLabel: true,
            quantity: true,
            delivery: true,
            accessUrl: true,
            accessNote: true,
            sessionMinutes: true,
            sessionPlace: true,
            sessionWhere: true,
            codes: { orderBy: [{ givenAt: 'asc' }, { createdAt: 'asc' }], select: { code: true } },
            grants: { orderBy: { createdAt: 'desc' }, select: { id: true, fileId: true, fileName: true, expiresAt: true, file: { select: { position: true, sizeBytes: true } } } },
            booking: { select: { session: { select: { startsAt: true } } } },
          },
        },
      },
    });
    if (!order) return;
    if (!order.email) {
      deps.log?.warn?.({ orderId }, 'delivery email has no address');
      return;
    }
    const token = openToken(order.tokenSealed, deps.secretsKey, deps.log);
    const api = apiBase();
    const app = trimSlash(deps.appUrl);
    const items: DigitalMailItem[] = [];
    let until: Date | null = null;
    for (const line of order.lines) {
      if (!line.delivery) continue;
      const seen = new Set<string>();
      const downloads: { name: string; url: string | null; sizeBytes: number | null; position: number }[] = [];
      for (const g of line.grants) {
        // Newest first: a later "new links" supersedes the grants it left to expire.
        const key = g.fileId ?? g.fileName;
        if (seen.has(key)) continue;
        seen.add(key);
        downloads.push({ name: g.fileName, url: token ? `${api}/store/orders/${token}/files/${g.id}` : null, sizeBytes: g.file?.sizeBytes ?? null, position: g.file?.position ?? 999 });
        if (!until || g.expiresAt > until) until = g.expiresAt;
      }
      items.push({
        name: line.itemName,
        optionLabel: line.optionLabel,
        quantity: line.quantity,
        delivery: line.delivery,
        downloads: line.delivery === 'FILES' ? downloads.sort((a, b) => a.position - b.position).map(({ name, url, sizeBytes }) => ({ name, url, sizeBytes })) : [],
        link: line.delivery === 'LINK' && line.accessUrl ? { url: token ? `${api}/store/orders/${token}/link/${line.id}` : null, note: line.accessNote } : null,
        codes: line.delivery === 'CODES' ? line.codes.map((c) => c.code) : [],
        session:
          line.delivery === 'SESSION' && line.booking && line.sessionMinutes && line.sessionPlace && line.sessionWhere
            ? { startsAt: line.booking.session.startsAt, minutes: line.sessionMinutes, place: line.sessionPlace, where: line.sessionWhere, lineId: line.id }
            : null,
      });
    }
    if (items.length === 0) return;
    const mail = digitalDeliveryMail({
      lang: order.page.language === 'ms' ? 'ms' : 'en',
      number: order.number,
      shopName: order.page.displayName,
      customerName: order.customerName,
      items,
      orderUrl: token ? `${app}/${order.page.handle}/order/${token}` : null,
      handle: order.page.handle,
      totalCents: order.totalCents,
      downloadsUntil: until,
      appUrl: deps.appUrl,
    });
    void deps.mailQueue
      .add(MAIL_QUEUE, { to: order.email, ...mail, fromName: order.page.displayName }, { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true })
      .catch((error: unknown) => deps.log?.warn?.({ orderId, err: error instanceof Error ? error.name : 'error' }, 'could not queue the delivery email'));
  } catch (error) {
    deps.log?.warn?.({ orderId, err: error instanceof Error ? error.name : 'error' }, 'could not queue the delivery email');
  }
}

/** The owner's order, which must be delivered and still paid; another owner's is indistinguishable from none. */
async function sentOrder(tx: Pick<Prisma.TransactionClient, 'order'>, accountId: string, id: string) {
  const order = await tx.order.findFirst({
    where: { id, page: { accountId } },
    select: { id: true, status: true, sentAt: true },
  });
  if (!order) throw new OrderNotFoundError();
  if (order.sentAt === null || (order.status !== 'PAID' && order.status !== 'COMPLETED')) throw new OrderStateError();
  return order;
}

/** Queues the delivery email again. Only for an order that was sent. */
export async function resendDelivery(deps: DeliveryMailDeps, accountId: string, id: string): Promise<void> {
  await sentOrder(deps.prisma, accountId, id);
  await queueDeliveryMail(deps, id);
}

/** Fresh grants for every file of the order's FILES lines; the old ones are left to expire. */
export async function newLinks(deps: { prisma: PrismaClient }, accountId: string, id: string, now: Date): Promise<void> {
  await deps.prisma.$transaction(async (tx) => {
    await sentOrder(tx, accountId, id);
    await makeGrants(tx, id, now);
  });
}

/**
 * Gives a CODES line one more unused code, taken the way placement takes them
 * (SKIP LOCKED, so two taps never take the same one). The codes it had stay
 * with it. SOLD_OUT when the item has none left.
 */
export async function newCode(deps: { prisma: PrismaClient }, accountId: string, id: string, lineId: string, now: Date): Promise<void> {
  await deps.prisma.$transaction(async (tx) => {
    await sentOrder(tx, accountId, id);
    const line = await tx.orderLine.findFirst({
      where: { id: lineId, orderId: id, kind: 'DIGITAL', delivery: 'CODES' },
      select: { id: true, itemId: true, itemName: true },
    });
    if (!line || !line.itemId) throw new OrderNotFoundError();
    const [free] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "ItemCode"
      WHERE "itemId" = ${line.itemId} AND "orderLineId" IS NULL
      ORDER BY "createdAt", "id"
      LIMIT 1
      FOR UPDATE SKIP LOCKED`;
    if (!free) throw new SoldOutError(line.itemName);
    await tx.itemCode.update({ where: { id: free.id }, data: { orderLineId: line.id, givenAt: now } });
  });
}

/**
 * Moves a SESSION line's booking to another time of the same item, if that time
 * has room for its seats. The target row is locked while its bookings are
 * counted, as placement does, so two moves (or a move and a new order) cannot
 * both take the last seat. TIME_FULL for a full, past or foreign time.
 */
export async function moveTime(deps: { prisma: PrismaClient }, accountId: string, id: string, lineId: string, sessionId: string, now: Date): Promise<void> {
  await deps.prisma.$transaction(async (tx) => {
    await sentOrder(tx, accountId, id);
    const line = await tx.orderLine.findFirst({
      where: { id: lineId, orderId: id, kind: 'DIGITAL', delivery: 'SESSION' },
      select: { id: true, itemId: true, itemName: true, quantity: true, booking: { select: { id: true, sessionId: true, seats: true } } },
    });
    if (!line || !line.itemId || !line.booking) throw new OrderNotFoundError();
    if (line.booking.sessionId === sessionId) return;
    const [time] = await tx.$queryRaw<{ itemId: string; startsAt: Date; seats: number }[]>`
      SELECT "itemId", "startsAt", "seats" FROM "ItemSession" WHERE "id" = ${sessionId} FOR UPDATE`;
    if (!time || time.itemId !== line.itemId || time.startsAt.getTime() <= now.getTime()) throw new TimeFullError(line.itemName);
    const booked = await tx.sessionBooking.aggregate({ where: { sessionId }, _sum: { seats: true } });
    if (seatsLeft(time, booked._sum.seats ?? 0) < line.booking.seats) throw new TimeFullError(line.itemName);
    // The reminder is for the new time, so it starts over.
    await tx.sessionBooking.update({ where: { id: line.booking.id }, data: { sessionId, remindedAt: null } });
  });
}
