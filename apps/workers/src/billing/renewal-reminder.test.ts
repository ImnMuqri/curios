import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildRenewalReminder, runPlanEndedMails, runRenewalReminders, type MailQueueLike } from './renewal-reminder.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const NOW = new Date('2026-09-17T02:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;
const APP_URL = 'https://curios.example';
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

function aMailQueue() {
  return { add: vi.fn<MailQueueLike['add']>(async () => ({ id: 'queued' })) };
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

async function aPage(options: {
  paidUntil: Date | null;
  mode?: 'BUSINESS' | 'PERSONAL';
  renewalReminderFor?: Date | null;
  ordersPlaced?: number;
  storeEnabled?: boolean;
  card?: { label: string | null; plan: 'MONTHLY' | 'ANNUAL' };
}) {
  const slug = `rem-${randomUUID().slice(0, 8)}`;
  const account = await prisma.account.create({
    data: {
      email: `renewal-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle: slug,
          skeleton: slug,
          displayName: 'Nadia Bakes',
          mode: options.mode ?? 'BUSINESS',
          paidUntil: options.paidUntil,
          renewalReminderFor: options.renewalReminderFor ?? null,
          ordersPlaced: options.ordersPlaced ?? 0,
          storeEnabled: options.storeEnabled ?? false,
          renewalCard: options.card
            ? { create: { token: `tok-${randomUUID()}`, plan: options.card.plan, cardLabel: options.card.label } }
            : undefined,
        },
      },
    },
    select: { email: true, pages: { select: { id: true } } },
  });
  return { email: account.email, pageId: account.pages[0]?.id ?? '' };
}

const reminderMark = async (pageId: string) =>
  (
    await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { renewalReminderFor: true },
    })
  ).renewalReminderFor;

describe('runRenewalReminders', () => {
  it('emails an owner whose plan ends in two days, and marks the period done', async () => {
    const paidUntil = inDays(2);
    const page = await aPage({ paidUntil });
    const mailQueue = aMailQueue();

    const result = await runRenewalReminders({ prisma, mailQueue, now: NOW, appUrl: APP_URL });

    expect(result).toEqual({ reminded: 1 });
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    const [, mail] = mailQueue.add.mock.calls[0] ?? [];
    expect(mail?.to).toBe(page.email);
    expect(mail?.text).toContain(`${APP_URL}/app/billing`);
    expect(await reminderMark(page.pageId)).toEqual(paidUntil);
  });

  it('tells an owner with a saved card what will be charged, from the card plan', async () => {
    await aPage({ paidUntil: inDays(2), card: { label: 'Visa ending 1111', plan: 'ANNUAL' } });
    const mailQueue = aMailQueue();

    await runRenewalReminders({ prisma, mailQueue, now: NOW, appUrl: APP_URL });

    const [, mail] = mailQueue.add.mock.calls[0] ?? [];
    expect(mail?.text).toContain("We'll charge RM490 to Visa ending 1111 on");
    expect(mail?.html).toContain('>See billing</a>');
  });

  it('never sends a second reminder for the same period', async () => {
    const paidUntil = inDays(2);
    const page = await aPage({ paidUntil });

    await runRenewalReminders({ prisma, mailQueue: aMailQueue(), now: NOW, appUrl: APP_URL });
    const second = aMailQueue();
    const result = await runRenewalReminders({ prisma, mailQueue: second, now: NOW, appUrl: APP_URL });

    expect(result).toEqual({ reminded: 0 });
    expect(second.add).not.toHaveBeenCalled();
    expect(await reminderMark(page.pageId)).toEqual(paidUntil);
  });

  it('reminds again once the owner has renewed, because the period moved', async () => {
    // No reminders table: the mark is the paidUntil it was for, so paying moves
    // the page back into eligibility by itself.
    const page = await aPage({ paidUntil: inDays(2), renewalReminderFor: inDays(2) });
    await prisma.page.update({ where: { id: page.pageId }, data: { paidUntil: inDays(2.5) } });
    const mailQueue = aMailQueue();

    expect(await runRenewalReminders({ prisma, mailQueue, now: NOW, appUrl: APP_URL })).toEqual({
      reminded: 1,
    });
  });

  it('reminds a plan ending exactly three days out', async () => {
    await aPage({ paidUntil: new Date(NOW.getTime() + 3 * DAY_MS) });
    const mailQueue = aMailQueue();

    await runRenewalReminders({ prisma, mailQueue, now: NOW, appUrl: APP_URL });

    expect(mailQueue.add).toHaveBeenCalledTimes(1);
  });

  it('leaves a plan a minute further out for tomorrow’s run', async () => {
    await aPage({ paidUntil: new Date(NOW.getTime() + 3 * DAY_MS + MINUTE_MS) });
    const mailQueue = aMailQueue();

    await runRenewalReminders({ prisma, mailQueue, now: NOW, appUrl: APP_URL });

    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('says nothing to a plan that has already ended', async () => {
    // A lapse is the leads screen's and the billing screen's to explain. An
    // email about it a day late is a reminder of nothing.
    await aPage({ paidUntil: new Date(NOW.getTime() - MINUTE_MS) });
    const mailQueue = aMailQueue();

    await runRenewalReminders({ prisma, mailQueue, now: NOW, appUrl: APP_URL });

    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('says nothing to a personal page, which pays nothing', async () => {
    await aPage({ paidUntil: inDays(2), mode: 'PERSONAL' });
    const mailQueue = aMailQueue();

    await runRenewalReminders({ prisma, mailQueue, now: NOW, appUrl: APP_URL });

    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('keeps the claim when the email cannot be queued, losing one rather than sending two', async () => {
    // Claimed first, emailed second. If this order were reversed, a queue
    // failure would leave the page unmarked and tomorrow's run would email
    // again -- and a crash between the two would send twice.
    //
    // Two due pages, different `paidUntil` inside the window, so
    // `orderBy: { paidUntil: 'asc' }` makes the first page here the first one
    // the loop visits -- deterministically the one the queue fails for.
    const firstPaidUntil = inDays(1);
    const secondPaidUntil = inDays(2);
    const first = await aPage({ paidUntil: firstPaidUntil });
    const second = await aPage({ paidUntil: secondPaidUntil });
    let calls = 0;
    const failingOnce = {
      add: vi.fn<MailQueueLike['add']>(async () => {
        calls += 1;
        if (calls === 1) throw new Error('redis is gone');
        return { id: 'queued' };
      }),
    };

    // One page's email failing must not stop the rest: the run itself does
    // not reject, and the page behind the failure still gets reminded.
    await expect(
      runRenewalReminders({ prisma, mailQueue: failingOnce, now: NOW, appUrl: APP_URL }),
    ).resolves.toEqual({ reminded: 1 });

    // The failed page stays claimed -- losing one reminder rather than
    // sending two -- while the page behind it in the loop still gets its
    // email.
    expect(await reminderMark(first.pageId)).toEqual(firstPaidUntil);
    expect(failingOnce.add).toHaveBeenCalledTimes(2);
    const [, secondMail] = failingOnce.add.mock.calls[1] ?? [];
    expect(secondMail?.to).toBe(second.email);
    expect(await reminderMark(second.pageId)).toEqual(secondPaidUntil);
  });
});

describe('buildRenewalReminder', () => {
  const mail = buildRenewalReminder({
    displayName: 'Nadia Bakes',
    // 20:00 UTC is already the next day in Kuala Lumpur.
    paidUntil: new Date('2026-09-19T20:00:00.000Z'),
    appUrl: `${APP_URL}/`,
    card: null,
  });

  it('names the shop and the Malaysian calendar day the plan ends', () => {
    expect(mail.subject).toContain('Nadia Bakes');
    expect(mail.subject).toContain('20 September 2026');
    expect(mail.text).toContain('20 September 2026');
  });

  it('links to billing, with no double slash from a trailing one', () => {
    expect(mail.text).toContain(`${APP_URL}/app/billing`);
    expect(mail.text).not.toContain('//app/billing');
  });

  it('does not promise a charge that cannot happen', () => {
    // Without a saved card nothing is charged. An email implying money will be
    // taken is both untrue and the fastest way to lose an owner's trust.
    expect(mail.text).toContain('not charge you automatically');
    expect(mail.text.toLowerCase()).not.toContain('will be renewed');
  });

  it('says what keeps working, so nobody reads it as the page going dark', () => {
    expect(mail.text).toContain('Only the capture card stops');
  });
});

describe('runPlanEndedMails', () => {
  const run = (mailQueue: ReturnType<typeof aMailQueue>, now = NOW) => runPlanEndedMails({ prisma, mailQueue, now, appUrl: APP_URL });

  it('tells an owner whose plan ended in the last day, laid out, once', async () => {
    const page = await aPage({ paidUntil: inDays(-0.5) });
    const mailQueue = aMailQueue();

    expect(await run(mailQueue)).toEqual({ told: 1 });
    expect(await run(mailQueue)).toEqual({ told: 0 });

    expect(mailQueue.add).toHaveBeenCalledOnce();
    const mail = mailQueue.add.mock.calls[0]?.[1];
    expect(mail?.to).toBe(page.email);
    expect(mail?.subject).toBe('Your Curios plan for Nadia Bakes has ended');
    expect(mail?.html).toContain('Plan ended');
    expect(mail?.text).toContain(`${APP_URL}/app/billing`);
  });

  // The shop's half by orderState, the rule checkout uses: free orders left
  // means the shop is still open, and a Store that is off is not mentioned.
  it.each([
    ['free orders left', { ordersPlaced: 1, storeEnabled: true }, 'Your shop still has 2 free orders. After those, checkout pauses until you pay.'],
    ['none left', { ordersPlaced: 3, storeEnabled: true }, 'your shop has stopped taking orders'],
    ['the Store off', { ordersPlaced: 3, storeEnabled: false }, 'The capture card is no longer shown. Your page and chat still work.'],
  ])('says what the plan ending did to the shop (%s)', async (_name, shop, said) => {
    await aPage({ paidUntil: inDays(-0.5), ...shop });
    const mailQueue = aMailQueue();

    await run(mailQueue);
    const text = mailQueue.add.mock.calls[0]?.[1]?.text ?? '';
    expect(text).toContain(said);
    if (!shop.storeEnabled || shop.ordersPlaced < 3) expect(text).not.toContain('stopped taking orders');
  });

  it('skips the plan-ended mail while a renewal card exists', async () => {
    // A renewal is still being tried; the auto-renew job says when it gives up.
    await aPage({ paidUntil: inDays(-0.5), card: { label: null, plan: 'MONTHLY' } });
    const mailQueue = aMailQueue();

    expect(await run(mailQueue)).toEqual({ told: 0 });
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('says nothing to a plan still running, or one that ended long before', async () => {
    await aPage({ paidUntil: inDays(1) });
    await aPage({ paidUntil: inDays(-5) });
    const mailQueue = aMailQueue();

    expect(await run(mailQueue)).toEqual({ told: 0 });
  });

  it('says nothing to a personal page', async () => {
    await aPage({ paidUntil: inDays(-0.5), mode: 'PERSONAL' });
    expect(await run(aMailQueue())).toEqual({ told: 0 });
  });
});

