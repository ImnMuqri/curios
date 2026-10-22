import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIL_QUEUE, type MailJobData } from '@curios/core';
import { PrismaClient } from '@curios/db';
import { notifyCardRemoved, notifyRenewalFailure } from './renewal-mail.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const NOW = new Date('2026-09-14T08:00:00.000Z');
const APP_URL = 'https://curios.example';

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

async function aPage(paidUntil: Date | null = new Date('2026-09-15T00:00:00.000Z')) {
  const skeleton = `rm-${randomUUID().slice(0, 8)}`;
  const email = `renewal-mail-${randomUUID()}@example.com`;
  const account = await prisma.account.create({
    data: { email, pages: { create: { handle: skeleton, skeleton, displayName: 'Nadia Bakes', paidUntil } } },
    select: { pages: { select: { id: true } } },
  });
  return { pageId: account.pages[0]?.id ?? '', email };
}

function deps() {
  return {
    prisma,
    mailQueue: { add: vi.fn(async (_name: string, _data: MailJobData, _opts?: unknown): Promise<unknown> => ({})) },
    appUrl: APP_URL,
    now: NOW,
    log: { error: vi.fn() },
  };
}

describe('notifyRenewalFailure', () => {
  it("mails \"we'll try again tomorrow\" for a failure that will be retried", async () => {
    const { pageId, email } = await aPage();
    const d = deps();

    await notifyRenewalFailure(d, pageId, { kind: 'retry', attempts: 1 });

    expect(d.mailQueue.add).toHaveBeenCalledTimes(1);
    const [name, mail] = d.mailQueue.add.mock.calls[0] ?? [];
    expect(name).toBe(MAIL_QUEUE);
    expect(mail?.to).toBe(email);
    expect(mail?.subject).toBe("We couldn't renew your Curios plan");
    expect(mail?.text).toContain("We'll try again tomorrow.");
  });

  it('mails that auto-renew is off once the failures stop it', async () => {
    const { pageId, email } = await aPage();
    const d = deps();

    await notifyRenewalFailure(d, pageId, { kind: 'stopped' });

    const [, mail] = d.mailQueue.add.mock.calls[0] ?? [];
    expect(mail?.to).toBe(email);
    expect(mail?.subject).toBe('Auto-renew is off for Nadia Bakes');
    expect(mail?.text).toContain("We couldn't charge your card after 3 tries");
    expect(mail?.text).toContain('Your plan ends on 15 Sep 2026.');
  });

  it('sends nothing for a failure that was not counted', async () => {
    const { pageId } = await aPage();
    const d = deps();

    await notifyRenewalFailure(d, pageId, { kind: 'ignored' });

    expect(d.mailQueue.add).not.toHaveBeenCalled();
  });

  it('never throws when the mail cannot be queued, and logs the page and not the address', async () => {
    const { pageId, email } = await aPage();
    const d = deps();
    d.mailQueue.add.mockRejectedValue(new Error('redis went away'));

    await expect(notifyRenewalFailure(d, pageId, { kind: 'retry', attempts: 2 })).resolves.toBeUndefined();

    expect(d.log.error).toHaveBeenCalledTimes(1);
    expect(d.log.error.mock.calls[0]?.[0]).toMatchObject({ pageId });
    expect(JSON.stringify(d.log.error.mock.calls)).not.toContain(email);
  });
});

describe('notifyCardRemoved', () => {
  it('mails that the saved card can no longer be charged', async () => {
    const { pageId, email } = await aPage(new Date('2026-09-13T00:00:00.000Z'));
    const d = deps();

    await notifyCardRemoved(d, pageId);

    const [, mail] = d.mailQueue.add.mock.calls[0] ?? [];
    expect(mail?.to).toBe(email);
    expect(mail?.text).toContain('Your saved card can no longer be charged');
    expect(mail?.text).toContain('Your plan ended on 13 Sep 2026.');
  });
});
