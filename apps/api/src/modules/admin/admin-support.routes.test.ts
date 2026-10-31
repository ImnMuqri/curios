import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ADMIN_COOKIE, MAIL_QUEUE, type MailJobData } from '@curios/core';
import { buildApp } from '../../app.js';
import { createDiskPrivateFiles, type PrivateFiles } from '../store/private-files.js';
import { hashPassword } from '../auth/password.service.js';
import { createAdminSession } from './admin-session.service.js';

const mailQueue = { add: vi.fn(async (_name: string, _data: MailJobData, _opts?: unknown) => ({})) };

let app: FastifyInstance;
let files: PrivateFiles;
let root: string;
let previousOrigin: string | undefined;
let adminId: string;
let cookie: string;
const madeThreads: string[] = [];
const madeAccounts: string[] = [];

beforeAll(async () => {
  previousOrigin = process.env.ADMIN_ORIGIN;
  process.env.ADMIN_ORIGIN = 'http://localhost:3002';
  root = await mkdtemp(path.join(tmpdir(), 'admin-support-'));
  files = createDiskPrivateFiles(root);
  app = await buildApp({ admin: { mailQueue, store: null, privateFiles: files } });
  await app.ready();

  const admin = await app.prisma.adminUser.create({
    data: { email: `admin-${randomUUID()}@example.com`, name: 'Test Admin', passwordHash: await hashPassword('a-long-enough-passphrase') },
  });
  adminId = admin.id;
  cookie = await createAdminSession(app.prisma, admin.id, '127.0.0.1');
});

afterAll(async () => {
  // SupportMessage.sentById restricts the admin's deletion: the threads (and their messages) go first.
  await app.prisma.supportThread.deleteMany({ where: { id: { in: madeThreads } } });
  await app.prisma.adminAction.deleteMany({ where: { adminUserId: adminId } });
  await app.prisma.adminUser.deleteMany({ where: { id: adminId } });
  await app.prisma.account.deleteMany({ where: { id: { in: madeAccounts } } });
  await rm(root, { recursive: true, force: true });
  if (previousOrigin === undefined) delete process.env.ADMIN_ORIGIN;
  else process.env.ADMIN_ORIGIN = previousOrigin;
  await app.close();
});

beforeEach(() => {
  mailQueue.add.mockClear();
});

const send = (method: 'GET' | 'POST', url: string, payload?: object, withCookie: string | null = cookie) =>
  app.inject({ method, url, payload, cookies: withCookie ? { [ADMIN_COOKIE]: withCookie } : undefined });

let clock = Date.parse('2026-10-01T00:00:00Z');
const tick = () => new Date((clock += 60_000));

async function aThread(
  extra: { subject?: string; status?: 'OPEN' | 'DONE' | 'SPAM'; unread?: boolean; accountId?: string; lastMessageAt?: Date } = {},
) {
  const tag = randomUUID().slice(0, 8);
  const thread = await app.prisma.supportThread.create({
    data: {
      address: `sender-${tag}@example.com`,
      name: 'Aina',
      subject: extra.subject ?? `Help ${tag}`,
      status: extra.status ?? 'OPEN',
      unread: extra.unread ?? true,
      accountId: extra.accountId,
      lastMessageAt: extra.lastMessageAt ?? tick(),
    },
  });
  madeThreads.push(thread.id);
  return thread;
}

async function aMessage(
  threadId: string,
  extra: { direction?: 'IN' | 'OUT'; html?: string; sendStatus?: 'SENDING' | 'SENT' | 'FAILED'; createdAt?: Date } = {},
) {
  const direction = extra.direction ?? 'IN';
  return app.prisma.supportMessage.create({
    data: {
      threadId,
      direction,
      messageId: `<${randomUUID()}@mail.test>`,
      fromAddress: direction === 'IN' ? 'sender@example.com' : 'support@curios.my',
      toAddresses: ['x@example.com'],
      subject: 'Help',
      text: 'Hello there',
      html: extra.html,
      sendStatus: direction === 'OUT' ? (extra.sendStatus ?? 'SENT') : undefined,
      sentById: direction === 'OUT' ? adminId : undefined,
      createdAt: extra.createdAt ?? tick(),
    },
  });
}

async function anAttachment(messageId: string, bytes: Buffer, extra: { contentType: string; contentId?: string; inline?: boolean; fileName?: string }) {
  const storageKey = `support/test-${randomUUID()}`;
  await files.put(storageKey, bytes, extra.contentType, bytes.length);
  return app.prisma.supportAttachment.create({
    data: {
      messageId,
      resendAttachmentId: randomUUID(),
      fileName: extra.fileName ?? 'file.bin',
      contentType: extra.contentType,
      sizeBytes: bytes.length,
      contentId: extra.contentId,
      inline: extra.inline ?? false,
      storageKey,
    },
  });
}

describe('auth', () => {
  it('refuses every route without an admin session', async () => {
    const routes: ['GET' | 'POST', string][] = [
      ['GET', '/admin/support/threads'],
      ['GET', '/admin/support/counts'],
      ['GET', '/admin/support/threads/x'],
      ['GET', '/admin/support/attachments/x'],
      ['POST', '/admin/support/threads/x/read'],
      ['POST', '/admin/support/threads/x/status'],
      ['POST', '/admin/support/threads/x/reply'],
      ['POST', '/admin/support/messages/x/retry'],
    ];
    for (const [method, url] of routes) {
      const res = await send(method, url, method === 'POST' ? {} : undefined, null);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe('list', () => {
  it('status=open leaves out DONE and SPAM, and all keeps them', async () => {
    const tag = randomUUID().slice(0, 8);
    const open = await aThread({ subject: `${tag} open` });
    const done = await aThread({ subject: `${tag} done`, status: 'DONE' });
    const spam = await aThread({ subject: `${tag} spam`, status: 'SPAM' });

    const ids = async (status: string) => ((await send('GET', `/admin/support/threads?status=${status}&q=${tag}`)).json().threads as { id: string }[]).map((t) => t.id);
    expect(await ids('open')).toEqual([open.id]);
    expect(await ids('done')).toEqual([done.id]);
    expect(await ids('spam')).toEqual([spam.id]);
    expect((await ids('all')).sort()).toEqual([open.id, done.id, spam.id].sort());
  });

  it('q finds a thread by subject, address or name, in any case', async () => {
    const tag = randomUUID().slice(0, 8);
    const thread = await aThread({ subject: `Refund for ORDER-${tag}` });
    const bySubject = await send('GET', `/admin/support/threads?status=all&q=order-${tag}`);
    expect(bySubject.json().threads.map((t: { id: string }) => t.id)).toEqual([thread.id]);
    const byAddress = await send('GET', `/admin/support/threads?status=all&q=${thread.address.toUpperCase()}`);
    expect(byAddress.json().threads.map((t: { id: string }) => t.id)).toEqual([thread.id]);
  });

  it('joins the page of the account as owner, and counts attachments', async () => {
    const slug = `sp-${randomUUID().slice(0, 8)}`;
    const account = await app.prisma.account.create({
      data: {
        email: `${slug}@admin-support.test`,
        pages: {
          create: { handle: `${slug}-a`, skeleton: `${slug}-a`, displayName: 'First Shop' },
        },
      },
      select: { id: true, pages: { select: { id: true, handle: true } } },
    });
    madeAccounts.push(account.id);
    const thread = await aThread({ accountId: account.id });
    const message = await aMessage(thread.id);
    await anAttachment(message.id, Buffer.from('a'), { contentType: 'text/plain' });
    await anAttachment(message.id, Buffer.from('b'), { contentType: 'text/plain' });
    const loose = await aThread();

    const res = await send('GET', `/admin/support/threads?status=all&q=${thread.address}`);
    const first = account.pages.find((p) => p.handle === `${slug}-a`)!;
    expect(res.json().threads[0]).toMatchObject({
      id: thread.id,
      attachmentCount: 2,
      owner: { pageId: first.id, handle: `${slug}-a`, displayName: 'First Shop' },
    });
    const none = await send('GET', `/admin/support/threads?status=all&q=${loose.address}`);
    expect(none.json().threads[0].owner).toBeNull();
  });

  it('pages by lastMessageAt, 50 at a time, newest first', async () => {
    const tag = randomUUID().slice(0, 8);
    const base = Date.parse('2030-01-01T00:00:00Z');
    const made = [];
    for (let i = 0; i < 51; i++) made.push(await aThread({ subject: `${tag} ${i}`, lastMessageAt: new Date(base + i * 1000) }));
    const first = (await send('GET', `/admin/support/threads?status=all&q=${tag}`)).json();
    expect(first.threads).toHaveLength(50);
    expect(first.threads[0].id).toBe(made[50]!.id);
    expect(first.next).toBe(first.threads[49].lastMessageAt);
    const second = (await send('GET', `/admin/support/threads?status=all&q=${tag}&before=${encodeURIComponent(first.next)}`)).json();
    expect(second.threads.map((t: { id: string }) => t.id)).toEqual([made[0]!.id]);
    expect(second.next).toBeNull();
  });
});

describe('counts', () => {
  it('counts threads by status', async () => {
    const before = (await send('GET', '/admin/support/counts')).json();
    await aThread();
    await aThread({ status: 'DONE' });
    await aThread({ status: 'SPAM' });
    await aThread({ status: 'SPAM' });
    const after = (await send('GET', '/admin/support/counts')).json();
    expect(after.open - before.open).toBe(1);
    expect(after.done - before.done).toBe(1);
    expect(after.spam - before.spam).toBe(2);
  });
});

describe('thread', () => {
  it('answers 404 SUPPORT_NOT_FOUND for an unknown id', async () => {
    const res = await send('GET', '/admin/support/threads/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('SUPPORT_NOT_FOUND');
  });

  it('inlines a small image as a data: URI and keeps cid: for one over 2 MB', async () => {
    const thread = await aThread();
    const message = await aMessage(thread.id, { html: '<p><img src="cid:img1"><img src="cid:big1"><img src="cid:img1"></p>' });
    const png = Buffer.from('not-really-a-png');
    await anAttachment(message.id, png, { contentType: 'image/png', contentId: 'img1', inline: true });
    await anAttachment(message.id, Buffer.alloc(3 * 1024 * 1024, 1), { contentType: 'image/png', contentId: 'big1', inline: true });

    const res = await send('GET', `/admin/support/threads/${thread.id}`);
    const html = res.json().messages[0].html as string;
    const uri = `data:image/png;base64,${png.toString('base64')}`;
    expect(html).toBe(`<p><img src="${uri}"><img src="cid:big1"><img src="${uri}"></p>`);
    expect(res.json().messages[0].attachments).toHaveLength(2);
    expect(res.json().messages[0].attachments[0]).not.toHaveProperty('storageKey');
  });

  it('stops inlining once a message holds 8 MB', async () => {
    const thread = await aThread();
    const message = await aMessage(thread.id, { html: '<img src="cid:a"><img src="cid:b"><img src="cid:c"><img src="cid:d"><img src="cid:e">' });
    for (const cid of ['a', 'b', 'c', 'd', 'e']) {
      await anAttachment(message.id, Buffer.alloc(2 * 1024 * 1024, 1), { contentType: 'image/jpeg', contentId: cid, inline: true });
    }
    const html = (await send('GET', `/admin/support/threads/${thread.id}`)).json().messages[0].html as string;
    expect(html.match(/data:image\/jpeg/g)).toHaveLength(4);
    expect(html).toContain('cid:e');
  });

  it('returns the thread, the owner with plan and paidUntil, and the messages in order', async () => {
    const slug = `sp-${randomUUID().slice(0, 8)}`;
    const paidUntil = new Date(Date.now() + 10 * 86_400_000);
    const account = await app.prisma.account.create({
      data: { email: `${slug}@admin-support.test`, pages: { create: { handle: slug, skeleton: slug, displayName: 'Kek Lina', mode: 'BUSINESS', paidUntil } } },
      select: { id: true, pages: { select: { id: true } } },
    });
    madeAccounts.push(account.id);
    const thread = await aThread({ accountId: account.id });
    const one = await aMessage(thread.id);
    const two = await aMessage(thread.id, { direction: 'OUT' });

    const body = (await send('GET', `/admin/support/threads/${thread.id}`)).json();
    expect(body.thread).toMatchObject({ id: thread.id, owner: { pageId: account.pages[0]!.id, handle: slug, displayName: 'Kek Lina' } });
    expect(body.owner).toEqual({ pageId: account.pages[0]!.id, handle: slug, displayName: 'Kek Lina', plan: 'Business', paidUntil: paidUntil.toISOString() });
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual([one.id, two.id]);
    expect(body.messages[1].sentBy).toEqual({ name: 'Test Admin' });
    expect(body.messages[0].sentBy).toBeNull();
  });
});

describe('attachment download', () => {
  it('sends an svg as an attachment with nosniff, and 404s an unknown id', async () => {
    const thread = await aThread();
    const message = await aMessage(thread.id);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const attachment = await anAttachment(message.id, svg, { contentType: 'image/svg+xml', fileName: 'logo.svg' });

    const res = await send('GET', `/admin/support/attachments/${attachment.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['content-disposition']).toContain('logo.svg');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.rawPayload.equals(svg)).toBe(true);

    expect((await send('GET', '/admin/support/attachments/nope')).statusCode).toBe(404);
  });
});

describe('reply', () => {
  it('stores one SENDING message and one audit row without the body, then queues the threaded job', async () => {
    const thread = await aThread({ subject: 'Re: Where is my order' });
    const first = await aMessage(thread.id, { direction: 'IN' });
    const second = await aMessage(thread.id, { direction: 'OUT' });
    const third = await aMessage(thread.id, { direction: 'IN' });

    const res = await send('POST', `/admin/support/threads/${thread.id}/reply`, { text: '  Sorry about that, checking now.  ' });
    expect(res.statusCode).toBe(200);

    const out = await app.prisma.supportMessage.findMany({ where: { threadId: thread.id, sendStatus: 'SENDING' } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      direction: 'OUT',
      subject: 'Re: Where is my order',
      text: 'Sorry about that, checking now.',
      sentById: adminId,
      fromName: 'Curios Support',
      toAddresses: [thread.address],
    });
    expect(res.json().message).toMatchObject({ id: out[0]!.id, sendStatus: 'SENDING', sentBy: { name: 'Test Admin' } });

    const audit = await app.prisma.adminAction.findMany({ where: { targetId: thread.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'REPLIED_SUPPORT',
      targetType: 'SupportThread',
      targetLabel: thread.address,
      reason: '',
      adminUserId: adminId,
    });
    expect(JSON.stringify(audit[0])).not.toContain('Sorry about that');
    expect(audit[0]!.metadata).toEqual({ subject: 'Re: Where is my order' });

    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    const [name, job, opts] = mailQueue.add.mock.calls[0]!;
    expect(name).toBe(MAIL_QUEUE);
    expect(job).toEqual({
      to: thread.address,
      from: 'support',
      subject: 'Re: Where is my order',
      text: 'Sorry about that, checking now.',
      messageId: out[0]!.messageId,
      inReplyTo: third.messageId,
      references: [first.messageId, second.messageId, third.messageId],
      supportMessageId: out[0]!.id,
    });
    expect(opts).toMatchObject({ attempts: 5, backoff: { type: 'exponential' } });

    const moved = await app.prisma.supportThread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(moved.lastMessageAt.getTime()).toBeGreaterThan(thread.lastMessageAt.getTime());
    expect(moved.status).toBe('OPEN');
  });

  it('puts Re: on a subject that has none, once', async () => {
    const thread = await aThread({ subject: 'Where is my order' });
    await aMessage(thread.id);
    await send('POST', `/admin/support/threads/${thread.id}/reply`, { text: 'Hi' });
    expect(mailQueue.add.mock.calls[0]![1]).toMatchObject({ subject: 'Re: Where is my order' });
  });

  it('rejects an empty reply and an unknown thread', async () => {
    const thread = await aThread();
    expect((await send('POST', `/admin/support/threads/${thread.id}/reply`, { text: '   ' })).statusCode).toBe(400);
    const res = await send('POST', '/admin/support/threads/nope/reply', { text: 'Hi' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('SUPPORT_NOT_FOUND');
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('answers 500 REPLY_NOT_QUEUED and marks the message FAILED when the queue is down', async () => {
    const thread = await aThread();
    await aMessage(thread.id);
    mailQueue.add.mockRejectedValueOnce(new Error('redis down'));

    const res = await send('POST', `/admin/support/threads/${thread.id}/reply`, { text: 'Hi' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('REPLY_NOT_QUEUED');
    const out = await app.prisma.supportMessage.findMany({ where: { threadId: thread.id, direction: 'OUT' } });
    expect(out).toHaveLength(1);
    expect(out[0]!.sendStatus).toBe('FAILED');
  });
});

describe('retry', () => {
  it('queues a FAILED message again with threading recomputed, and refuses a SENT one', async () => {
    const thread = await aThread({ subject: 'Help' });
    const incoming = await aMessage(thread.id, { direction: 'IN' });
    const failed = await aMessage(thread.id, { direction: 'OUT', sendStatus: 'FAILED' });
    await aMessage(thread.id, { direction: 'IN' });

    const res = await send('POST', `/admin/support/messages/${failed.id}/retry`);
    expect(res.statusCode).toBe(204);
    expect((await app.prisma.supportMessage.findUniqueOrThrow({ where: { id: failed.id } })).sendStatus).toBe('SENDING');
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    expect(mailQueue.add.mock.calls[0]![1]).toEqual({
      to: thread.address,
      from: 'support',
      subject: failed.subject,
      text: 'Hello there',
      messageId: failed.messageId,
      inReplyTo: incoming.messageId,
      references: [incoming.messageId],
      supportMessageId: failed.id,
    });

    // It is SENDING now, so a second click is refused rather than queued twice.
    const again = await send('POST', `/admin/support/messages/${failed.id}/retry`);
    expect(again.statusCode).toBe(409);
    expect(mailQueue.add).toHaveBeenCalledTimes(1);
  });

  it('answers 409 NOT_FAILED for a SENT message and 404 for an unknown or incoming one', async () => {
    const thread = await aThread();
    const sent = await aMessage(thread.id, { direction: 'OUT', sendStatus: 'SENT' });
    const incoming = await aMessage(thread.id, { direction: 'IN' });

    const res = await send('POST', `/admin/support/messages/${sent.id}/retry`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOT_FAILED');
    expect((await send('POST', `/admin/support/messages/${incoming.id}/retry`)).statusCode).toBe(404);
    expect((await send('POST', '/admin/support/messages/nope/retry')).json().error.code).toBe('SUPPORT_NOT_FOUND');
    expect(mailQueue.add).not.toHaveBeenCalled();
  });

  it('marks the message FAILED again when the queue is still down', async () => {
    const thread = await aThread();
    const failed = await aMessage(thread.id, { direction: 'OUT', sendStatus: 'FAILED' });
    mailQueue.add.mockRejectedValueOnce(new Error('redis down'));
    const res = await send('POST', `/admin/support/messages/${failed.id}/retry`);
    expect(res.statusCode).toBe(500);
    expect((await app.prisma.supportMessage.findUniqueOrThrow({ where: { id: failed.id } })).sendStatus).toBe('FAILED');
  });
});

describe('status and read', () => {
  it('moves DONE to OPEN and SPAM to OPEN, and rejects SPAM as a target', async () => {
    const done = await aThread({ status: 'DONE' });
    const spam = await aThread({ status: 'SPAM' });
    expect((await send('POST', `/admin/support/threads/${done.id}/status`, { status: 'OPEN' })).statusCode).toBe(204);
    expect((await send('POST', `/admin/support/threads/${spam.id}/status`, { status: 'OPEN' })).statusCode).toBe(204);
    expect((await app.prisma.supportThread.findUniqueOrThrow({ where: { id: done.id } })).status).toBe('OPEN');
    expect((await app.prisma.supportThread.findUniqueOrThrow({ where: { id: spam.id } })).status).toBe('OPEN');

    expect((await send('POST', `/admin/support/threads/${done.id}/status`, { status: 'DONE' })).statusCode).toBe(204);
    expect((await app.prisma.supportThread.findUniqueOrThrow({ where: { id: done.id } })).status).toBe('DONE');
    expect((await send('POST', `/admin/support/threads/${done.id}/status`, { status: 'SPAM' })).statusCode).toBe(400);
    expect((await send('POST', '/admin/support/threads/nope/status', { status: 'OPEN' })).statusCode).toBe(404);
  });

  it('read clears unread', async () => {
    const thread = await aThread({ unread: true });
    expect((await send('POST', `/admin/support/threads/${thread.id}/read`)).statusCode).toBe(204);
    expect((await app.prisma.supportThread.findUniqueOrThrow({ where: { id: thread.id } })).unread).toBe(false);
    expect((await send('POST', '/admin/support/threads/nope/read')).statusCode).toBe(404);
  });
});
