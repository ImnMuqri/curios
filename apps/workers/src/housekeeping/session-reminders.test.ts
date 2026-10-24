import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { sealSecret } from '@curios/core/secret-box';
import { scheduleHousekeepingJobs } from './retention.js';
import { SESSION_REMINDERS_JOB, sendSessionReminders, tomorrowInMalaysia } from './session-reminders.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const key = randomBytes(32);
// 09:00 on Sat 24 Oct 2026 in Malaysia.
const now = new Date('2026-10-24T01:00:00Z');
// Sun 25 Oct, 8:00 pm in Malaysia: tomorrow.
const tomorrow8pm = new Date('2026-10-25T12:00:00Z');

let accountId = '';
let pageId = '';
let classItem = '';
let fileItem = '';
let fileId = '';
let n = 0;

function mailbox() {
  const added: { to: string; subject: string; text: string; html?: string; fromName?: string }[] = [];
  return { added, mailQueue: { add: vi.fn(async (_name: string, data: (typeof added)[number]) => void added.push(data)) } };
}

beforeAll(async () => {
  const slug = `sr${randomUUID().slice(0, 8)}`;
  const account = await prisma.account.create({
    data: {
      email: `sr-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle: slug,
          skeleton: slug,
          displayName: 'Kek <b>Lina</b>',
          language: 'ms',
          items: {
            create: [
              { name: 'Kelas', slug: 'k', position: 0, priceCents: 500, kind: 'DIGITAL', delivery: 'SESSION' },
              { name: 'List', slug: 'l', position: 1, priceCents: 500, kind: 'DIGITAL', delivery: 'FILES', files: { create: { key: 'k/x.pdf', name: 'list.pdf', sizeBytes: 225_280, contentType: 'application/pdf', position: 0 } } },
            ],
          },
        },
      },
    },
    select: { id: true, pages: { select: { id: true, items: { orderBy: { position: 'asc' }, select: { id: true, files: { select: { id: true } } } } } } },
  });
  accountId = account.id;
  pageId = account.pages[0]!.id;
  classItem = account.pages[0]!.items[0]!.id;
  fileItem = account.pages[0]!.items[1]!.id;
  fileId = account.pages[0]!.items[1]!.files[0]!.id;
});
afterAll(async () => {
  await prisma.account.delete({ where: { id: accountId } });
  await prisma.$disconnect();
});

/** A paid and sent order with one class booking at `startsAt`, and a file line when asked. */
async function aBooking(startsAt: Date, opts: { status?: 'PAID' | 'CANCELLED'; sent?: boolean; withFile?: boolean; sealed?: boolean; where?: string } = {}) {
  n += 1;
  const session = await prisma.itemSession.create({ data: { itemId: classItem, startsAt, seats: 10 } });
  const order = await prisma.order.create({
    data: {
      pageId,
      number: n,
      code: `R${n}`,
      tokenHash: `sr-${randomUUID()}`,
      tokenSealed: opts.sealed === false ? null : sealSecret('tok123', key),
      customerName: 'Aina',
      phone: '+60123456789',
      email: 'a@example.com',
      itemsCents: 500,
      deliveryCents: 0,
      totalCents: 500,
      status: opts.status ?? 'PAID',
      paidAt: new Date(),
      sentAt: opts.sent === false ? null : new Date(),
      lines: {
        create: [
          { itemId: classItem, itemName: 'Kelas <i>batik</i>', unitPriceCents: 500, quantity: 1, position: 0, kind: 'DIGITAL', delivery: 'SESSION', sessionMinutes: 90, sessionPlace: 'ONLINE', sessionWhere: opts.where ?? 'https://meet.example/abc' },
          ...(opts.withFile ? [{ itemId: fileItem, itemName: 'List', unitPriceCents: 500, quantity: 1, position: 1, kind: 'DIGITAL' as const, delivery: 'FILES' as const }] : []),
        ],
      },
    },
    select: { id: true, lines: { orderBy: { position: 'asc' }, select: { id: true } } },
  });
  const booking = await prisma.sessionBooking.create({ data: { sessionId: session.id, orderLineId: order.lines[0]!.id, seats: 1 } });
  if (opts.withFile) {
    await prisma.downloadGrant.create({ data: { token: randomUUID(), orderLineId: order.lines[1]!.id, fileId, fileName: 'list.pdf', usesLeft: 5, expiresAt: new Date(now.getTime() + 30 * 86_400_000) } });
  }
  return { orderId: order.id, bookingId: booking.id, sessionId: session.id };
}
const reminded = async (bookingId: string) => (await prisma.sessionBooking.findUniqueOrThrow({ where: { id: bookingId } })).remindedAt;

describe('tomorrowInMalaysia', () => {
  it('is the next Malaysian calendar day, even late in the evening there', () => {
    expect(tomorrowInMalaysia(new Date('2026-10-24T01:00:00Z'))).toEqual({ from: new Date('2026-10-24T16:00:00Z'), to: new Date('2026-10-25T16:00:00Z') });
    // 23:30 Malaysia on the 24th is still the 24th there, though 15:30 UTC.
    expect(tomorrowInMalaysia(new Date('2026-10-24T15:30:00Z')).from).toEqual(new Date('2026-10-24T16:00:00Z'));
    // 00:30 Malaysia on the 25th is 16:30 UTC on the 24th.
    expect(tomorrowInMalaysia(new Date('2026-10-24T16:30:00Z')).from).toEqual(new Date('2026-10-25T16:00:00Z'));
  });
});

describe('sendSessionReminders', () => {
  it('reminds once per booking, with the join link, the shop as sender and escaped owner text', async () => {
    const { bookingId } = await aBooking(tomorrow8pm);
    const box = mailbox();
    const deps = { prisma, mailQueue: box.mailQueue, now, appUrl: 'https://curios.example', secretsKey: key };
    expect(await sendSessionReminders(deps)).toBeGreaterThanOrEqual(1);
    const mine = box.added.filter((m) => m.subject.includes('Kelas <i>batik</i>'));
    expect(mine).toHaveLength(1);
    const mail = mine[0]!;
    expect(mail.to).toBe('a@example.com');
    expect(mail.fromName).toBe('Kek <b>Lina</b>');
    expect(mail.subject).toBe('Kelas <i>batik</i> anda esok, 8:00 malam');
    expect(mail.text).toContain('https://meet.example/abc');
    expect(mail.text).toContain('/order/tok123');
    expect(mail.html).toContain('Kelas &lt;i&gt;batik&lt;/i&gt;');
    expect(mail.html).not.toContain('<i>batik</i>');
    expect(mail.html).toContain('Kek &lt;b&gt;Lina&lt;/b&gt;');
    expect(await reminded(bookingId)).toEqual(now);

    const second = mailbox();
    await sendSessionReminders({ ...deps, mailQueue: second.mailQueue });
    expect(second.added.filter((m) => m.subject.includes('Kelas <i>batik</i>'))).toHaveLength(0);
  });

  it('skips a cancelled order, an unsent one, and a class that is not tomorrow', async () => {
    const cancelled = await aBooking(tomorrow8pm, { status: 'CANCELLED' });
    const unsent = await aBooking(tomorrow8pm, { sent: false });
    const today = await aBooking(new Date('2026-10-24T11:00:00Z'));
    const later = await aBooking(new Date('2026-10-26T12:00:00Z'));
    const box = mailbox();
    await sendSessionReminders({ prisma, mailQueue: box.mailQueue, now, appUrl: 'https://curios.example', secretsKey: key });
    for (const b of [cancelled, unsent, today, later]) expect(await reminded(b.bookingId)).toBeNull();
  });

  it('includes the order’s files with their download links', async () => {
    await aBooking(tomorrow8pm, { withFile: true });
    const box = mailbox();
    await sendSessionReminders({ prisma, mailQueue: box.mailQueue, now, appUrl: 'https://curios.example', secretsKey: key });
    const mail = box.added.find((m) => m.text.includes('list.pdf'));
    expect(mail?.text).toMatch(/\/store\/orders\/tok123\/files\//);
    expect(mail?.html).toContain('220 KB');
  });

  it('sends the time and place without links when the order link cannot be opened', async () => {
    const { bookingId } = await aBooking(tomorrow8pm, { sealed: false, where: 'https://meet.example/nolink' });
    const box = mailbox();
    await sendSessionReminders({ prisma, mailQueue: box.mailQueue, now, appUrl: 'https://curios.example', secretsKey: key });
    const mail = box.added.find((m) => m.text.includes('meet.example/nolink'));
    expect(mail).toBeDefined();
    expect(mail!.text).not.toContain('/order/');
    expect(await reminded(bookingId)).not.toBeNull();
  });

  it('reminds a moved booking again, for its new time', async () => {
    const { bookingId, orderId } = await aBooking(tomorrow8pm);
    const box = mailbox();
    const deps = { prisma, mailQueue: box.mailQueue, now, appUrl: 'https://curios.example', secretsKey: key };
    await sendSessionReminders(deps);
    expect(await reminded(bookingId)).not.toBeNull();
    // The owner moves it to another time (Task 5 resets remindedAt), also tomorrow here.
    const other = await prisma.itemSession.create({ data: { itemId: classItem, startsAt: new Date('2026-10-25T02:00:00Z'), seats: 5 } });
    await prisma.sessionBooking.update({ where: { id: bookingId }, data: { sessionId: other.id, remindedAt: null } });
    box.added.length = 0;
    await sendSessionReminders(deps);
    expect(box.added.filter((m) => m.subject.includes('10:00 pagi'))).toHaveLength(1);
    void orderId;
  });

  it('two runs at once send one email per booking', async () => {
    const { bookingId } = await aBooking(tomorrow8pm, { where: 'https://meet.example/race' });
    const box = mailbox();
    const deps = { prisma, mailQueue: box.mailQueue, now, appUrl: 'https://curios.example', secretsKey: key };
    await Promise.all([sendSessionReminders(deps), sendSessionReminders(deps)]);
    expect(box.added.filter((m) => m.text.includes('meet.example/race'))).toHaveLength(1);
    expect(await reminded(bookingId)).not.toBeNull();
  });

  it('is scheduled daily at 09:00 in Malaysia', async () => {
    const queue = { upsertJobScheduler: vi.fn(async () => ({})) };
    await scheduleHousekeepingJobs(queue);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(SESSION_REMINDERS_JOB, { pattern: '0 9 * * *', tz: 'Asia/Kuala_Lumpur' }, { name: SESSION_REMINDERS_JOB });
  });
});
