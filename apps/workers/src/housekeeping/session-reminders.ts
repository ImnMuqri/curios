import { MAIL_QUEUE, sessionReminderMail, type MailJobData } from '@curios/core';
import { openSecret } from '@curios/core/secret-box';
import type { PrismaClient } from '@curios/db';

export const SESSION_REMINDERS_JOB = 'session-reminders';

const DAY_MS = 24 * 3_600_000;
const MALAYSIA_MS = 8 * 3_600_000;

/** Bookings looked at per run; the rest wait for the next day's run. */
const BATCH = 500;

/** The start of tomorrow in Malaysia (UTC+8, no daylight saving) and of the day after, as instants. */
export function tomorrowInMalaysia(now: Date): { from: Date; to: Date } {
  const todayStart = Math.floor((now.getTime() + MALAYSIA_MS) / DAY_MS) * DAY_MS - MALAYSIA_MS;
  return { from: new Date(todayStart + DAY_MS), to: new Date(todayStart + 2 * DAY_MS) };
}

const trimSlash = (url: string) => url.replace(/\/+$/, '');

export interface SessionReminderDeps {
  prisma: PrismaClient;
  mailQueue: { add(name: string, data: MailJobData, opts?: unknown): Promise<unknown> };
  now: Date;
  /** The web app, for the order page. */
  appUrl: string;
  /** PAYMENT_SECRETS_KEY; null sends the reminder with the time and place but no links. */
  secretsKey: Buffer | null;
  log?: { info?: (details: object, message: string) => void; warn?: (details: object, message: string) => void };
}

/**
 * Emails the buyer the day before a class (Malaysian calendar day), once per booking.
 * Claimed first, queued second: the claim is a conditional update (`remindedAt: null -> now`,
 * still the same time, order still paid and sent), so two runs at once send one email, and a
 * booking the owner moved in between is not claimed for a time it no longer has. Moving a
 * booking resets `remindedAt`, so it is reminded for its new time. Cancelled and unsent orders
 * are never picked. Losing one reminder to a queue failure is the accepted failure, as with
 * the plan reminders. Returns how many were queued.
 */
// An order paid after the day's run for a class the next morning gets no reminder: its delivery email, sent when it was paid, covers it.
export async function sendSessionReminders(deps: SessionReminderDeps): Promise<number> {
  const { from, to } = tomorrowInMalaysia(deps.now);
  const paid = { status: { in: ['PAID', 'COMPLETED'] as ('PAID' | 'COMPLETED')[] }, sentAt: { not: null }, email: { not: null } };
  const due = await deps.prisma.sessionBooking.findMany({
    where: { remindedAt: null, session: { startsAt: { gte: from, lt: to } }, orderLine: { order: paid } },
    select: {
      id: true,
      sessionId: true,
      session: { select: { startsAt: true } },
      orderLine: {
        select: {
          id: true,
          itemName: true,
          sessionMinutes: true,
          sessionPlace: true,
          sessionWhere: true,
          order: {
            select: {
              id: true,
              number: true,
              email: true,
              tokenSealed: true,
              page: { select: { handle: true, displayName: true, language: true, accentColor: true } },
              lines: {
                where: { delivery: 'FILES' },
                orderBy: { position: 'asc' },
                select: { grants: { orderBy: { createdAt: 'desc' }, select: { id: true, fileId: true, fileName: true, file: { select: { position: true, sizeBytes: true } } } } },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });

  const api = trimSlash(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001');
  const app = trimSlash(deps.appUrl);
  let queued = 0;
  for (const booking of due) {
    const line = booking.orderLine;
    const order = line.order;
    if (!order.email || !line.sessionMinutes || !line.sessionPlace || !line.sessionWhere) continue;

    const claim = await deps.prisma.sessionBooking.updateMany({
      where: { id: booking.id, remindedAt: null, sessionId: booking.sessionId, orderLine: { order: paid } },
      data: { remindedAt: deps.now },
    });
    if (claim.count === 0) continue;

    let token: string | null = null;
    if (order.tokenSealed && deps.secretsKey) {
      try {
        token = openSecret(order.tokenSealed, deps.secretsKey);
      } catch {
        deps.log?.warn?.({ orderId: order.id }, 'order link could not be opened (PAYMENT_SECRETS_KEY changed?), so the reminder carries no links');
      }
    }
    const seen = new Set<string>();
    const files: { name: string; url: string | null; sizeBytes: number | null; position: number }[] = [];
    for (const fileLine of order.lines) {
      for (const g of fileLine.grants) {
        // Newest first: a later "new links" supersedes the grants it left to expire.
        const key = g.fileId ?? g.fileName;
        if (seen.has(key)) continue;
        seen.add(key);
        files.push({ name: g.fileName, url: token ? `${api}/store/orders/${token}/files/${g.id}` : null, sizeBytes: g.file?.sizeBytes ?? null, position: g.file?.position ?? 999 });
      }
    }
    files.sort((a, b) => a.position - b.position);

    const mail = sessionReminderMail({
      lang: order.page.language === 'ms' ? 'ms' : 'en',
      number: order.number,
      shopName: order.page.displayName,
      handle: order.page.handle,
      accent: order.page.accentColor,
      itemName: line.itemName,
      session: { startsAt: booking.session.startsAt, minutes: line.sessionMinutes, place: line.sessionPlace, where: line.sessionWhere, lineId: line.id },
      files: files.map(({ name, url, sizeBytes }) => ({ name, url, sizeBytes })),
      orderUrl: token ? `${app}/${order.page.handle}/order/${token}` : null,
      appUrl: deps.appUrl,
    });
    try {
      await deps.mailQueue.add(MAIL_QUEUE, { to: order.email, ...mail, fromName: order.page.displayName }, { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true });
      queued += 1;
    } catch (error) {
      deps.log?.warn?.({ orderId: order.id, err: error instanceof Error ? error.name : 'error' }, 'session reminder could not be queued');
    }
  }
  if (queued > 0) deps.log?.info?.({ queued }, 'session reminders queued');
  return queued;
}
