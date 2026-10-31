import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createDiskPrivateFiles, type PrivateFiles } from '@curios/storage/private-files';
import { processInbound, type InboundDeps } from './inbound.js';
import { createResendClient, type ReceivedEmail, type ResendClient } from './resend-client.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const SUPPORT = 'support@curios.my';

let root = '';
let files: PrivateFiles;
const accountIds: string[] = [];
const emailIds: string[] = [];

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'support-inbound-'));
  files = createDiskPrivateFiles(root);
});

// By the ids made here, not a truncate: the test DB is shared, and a truncate
// in beforeEach would leave the last test's rows behind anyway.
afterAll(async () => {
  await prisma.supportThread.deleteMany({ where: { messages: { some: { resendEmailId: { in: emailIds } } } } });
  await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

/** A unique address per test, so threads and accounts never meet another run's. */
const unique = (who: string) => `${who}-${randomUUID().slice(0, 8)}@example.com`;
const newEmailId = () => {
  const id = randomUUID();
  emailIds.push(id);
  return id;
};

function anEmail(overrides: Partial<ReceivedEmail> = {}): ReceivedEmail {
  return {
    from: 'Nadia <n@example.com>',
    to: [SUPPORT],
    cc: [],
    reply_to: [],
    subject: 'Cannot publish my page',
    html: '<p>Hello</p>',
    text: 'Hello',
    headers: {},
    message_id: `<${randomUUID()}@mail.example.com>`,
    authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    attachments: [],
    ...overrides,
  };
}

/** Resend, answering this email for any id; each attachment's bytes from `bodies`. */
function aResend(email: ReceivedEmail, bodies: Record<string, () => NodeJS.ReadableStream> = {}): ResendClient {
  return {
    getReceived: vi.fn(async () => email),
    attachmentStream: vi.fn(async (_emailId: string, attachmentId: string) => {
      const meta = email.attachments.find((a) => a.id === attachmentId)!;
      const body = bodies[attachmentId] ?? (() => Readable.from([Buffer.from(`bytes of ${attachmentId}`)]));
      return { stream: body(), contentType: meta.content_type, size: meta.size };
    }),
  };
}

const log = { info: vi.fn() };
const deps = (resend: ResendClient): InboundDeps => ({ prisma, resend, files, support: SUPPORT, log });

const messageOf = (resendEmailId: string) =>
  prisma.supportMessage.findUnique({ where: { resendEmailId }, include: { thread: true, attachments: true } });

describe('processInbound', () => {
  it("files a new email from an owner's address as an open, unread thread with its attachment", async () => {
    const owner = unique('Owner');
    const account = await prisma.account.create({ data: { email: owner.toLowerCase() } });
    accountIds.push(account.id);
    const emailId = newEmailId();
    const email = anEmail({
      from: `Nadia Bakes <${owner.toUpperCase()}>`,
      attachments: [
        { id: 'att-1', filename: 'screen.png', content_type: 'image/png', content_disposition: 'inline', content_id: '<img001>', size: 15 },
      ],
    });

    expect(await processInbound(deps(aResend(email)), emailId)).toBe('stored');

    const message = await messageOf(emailId);
    expect(message?.thread).toMatchObject({ status: 'OPEN', unread: true, accountId: account.id, address: owner.toLowerCase(), name: 'Nadia Bakes', subject: 'Cannot publish my page' });
    expect(message).toMatchObject({ direction: 'IN', html: '<p>Hello</p>', text: 'Hello', fromAddress: owner.toLowerCase(), fromName: 'Nadia Bakes', toAddresses: [SUPPORT], messageId: email.message_id });
    expect(message?.attachments).toEqual([
      expect.objectContaining({ resendAttachmentId: 'att-1', fileName: 'screen.png', contentType: 'image/png', sizeBytes: 15, contentId: 'img001', inline: true, storageKey: `support/${emailId}/att-1` }),
    ]);
    expect((await files.read(`support/${emailId}/att-1`)).toString()).toBe('bytes of att-1');
  });

  it('threads by the Reply-To address, not From', async () => {
    const replyTo = unique('reply');
    const emailId = newEmailId();
    await processInbound(deps(aResend(anEmail({ from: `Mailer <${unique('noreply')}>`, reply_to: [`Real Person <${replyTo}>`] }))), emailId);

    expect((await messageOf(emailId))?.thread.address).toBe(replyTo);
  });

  it('joins the thread named by In-Reply-To, reopening a done one', async () => {
    const address = unique('thread');
    const first = newEmailId();
    const firstEmail = anEmail({ from: address });
    await processInbound(deps(aResend(firstEmail)), first);
    const thread = (await messageOf(first))!.thread;
    const before = new Date('2026-01-01T00:00:00Z');
    await prisma.supportThread.update({ where: { id: thread.id }, data: { status: 'DONE', unread: false, lastMessageAt: before } });

    const second = newEmailId();
    await processInbound(
      deps(aResend(anEmail({ from: address, subject: 'Re: Cannot publish my page', headers: { 'In-Reply-To': firstEmail.message_id! } }))),
      second,
    );

    const reply = await messageOf(second);
    expect(reply?.threadId).toBe(thread.id);
    expect(reply?.thread).toMatchObject({ status: 'OPEN', unread: true });
    expect(reply!.thread.lastMessageAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it('opens a second thread for a new subject from the same address', async () => {
    const address = unique('two');
    const first = newEmailId();
    const second = newEmailId();
    await processInbound(deps(aResend(anEmail({ from: address, subject: 'One' }))), first);
    await processInbound(deps(aResend(anEmail({ from: address, subject: 'Two' }))), second);

    const [a, b] = [await messageOf(first), await messageOf(second)];
    expect(a?.threadId).not.toBe(b?.threadId);
    expect(b?.thread.subject).toBe('Two');
  });

  it('stores nothing until every attachment is up, and a rerun finishes the job', async () => {
    const emailId = newEmailId();
    const email = anEmail({
      from: unique('files'),
      attachments: [
        { id: 'a', filename: 'a.pdf', content_type: 'application/pdf', content_disposition: 'attachment', content_id: null, size: 10 },
        { id: 'b', filename: 'b.pdf', content_type: 'application/pdf', content_disposition: null, content_id: null, size: 10 },
      ],
    });
    const broken = () =>
      new Readable({
        read() {
          this.destroy(new Error('connection reset'));
        },
      });

    await expect(processInbound(deps(aResend(email, { b: broken })), emailId)).rejects.toThrow('connection reset');
    expect(await prisma.supportMessage.count({ where: { resendEmailId: emailId } })).toBe(0);

    expect(await processInbound(deps(aResend(email)), emailId)).toBe('stored');
    const message = await messageOf(emailId);
    expect(message?.attachments.map((a) => a.storageKey).sort()).toEqual([`support/${emailId}/a`, `support/${emailId}/b`]);
    expect(message?.attachments.find((a) => a.resendAttachmentId === 'a')?.inline).toBe(false);
    expect(await prisma.supportMessage.count({ where: { resendEmailId: emailId } })).toBe(1);
    // The first upload was overwritten in place: one file (and its type sidecar) per attachment.
    expect((await readdir(path.join(root, 'support', emailId))).sort()).toEqual(['a', 'a.type', 'b', 'b.type']);
  });

  it('answers duplicate for an email already stored, and writes nothing', async () => {
    const emailId = newEmailId();
    const email = anEmail({ from: unique('dup') });
    await processInbound(deps(aResend(email)), emailId);
    const resend = aResend(email);

    expect(await processInbound(deps(resend), emailId)).toBe('duplicate');
    expect(resend.getReceived).not.toHaveBeenCalled();
    expect(await prisma.supportMessage.count({ where: { resendEmailId: emailId } })).toBe(1);
  });

  it('files mail that fails authentication as spam, not open', async () => {
    const address = unique('spam');
    const emailId = newEmailId();
    await processInbound(deps(aResend(anEmail({ from: address, authentication: { spf: 'pass', dkim: 'pass', dmarc: 'fail' } }))), emailId);

    expect((await messageOf(emailId))?.thread.status).toBe('SPAM');
    expect(await prisma.supportThread.count({ where: { address, status: 'OPEN' } })).toBe(0);
  });

  it('keeps a spam thread spam when a reply that passes arrives', async () => {
    const address = unique('stillspam');
    const first = newEmailId();
    const firstEmail = anEmail({ from: address, authentication: { spf: 'fail', dkim: 'fail', dmarc: 'fail' } });
    await processInbound(deps(aResend(firstEmail)), first);

    const second = newEmailId();
    await processInbound(deps(aResend(anEmail({ from: address, headers: { 'in-reply-to': firstEmail.message_id! } }))), second);

    const reply = await messageOf(second);
    expect(reply?.threadId).toBe((await messageOf(first))?.threadId);
    expect(reply?.thread.status).toBe('SPAM');
  });

  it('gives a message with no Message-ID one of its own', async () => {
    const emailId = newEmailId();
    await processInbound(deps(aResend(anEmail({ from: unique('noid'), message_id: null }))), emailId);

    expect((await messageOf(emailId))?.messageId).toMatch(/^<[0-9a-f-]+@curios\.my>$/);
  });

  it('leaves mail that is not for support alone', async () => {
    const emailId = newEmailId();
    const resend = aResend(anEmail({ from: unique('other'), to: ['hello@curios.my'] }));

    expect(await processInbound(deps(resend), emailId)).toBe('not-support');
    expect(resend.attachmentStream).not.toHaveBeenCalled();
    expect(await prisma.supportMessage.count({ where: { resendEmailId: emailId } })).toBe(0);
  });
});

describe('createResendClient', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('fetches the received email with cid images, authenticated', async () => {
    const fetch = vi.fn(async () => json({ object: 'email', id: 'e1', from: 'a@example.com', attachments: [] }));
    const client = createResendClient({ apiKey: 're_test', fetch });

    expect(await client.getReceived('e1')).toMatchObject({ from: 'a@example.com' });
    expect(fetch).toHaveBeenCalledWith('https://api.resend.com/emails/receiving/e1?html_format=cid', {
      headers: { Authorization: 'Bearer re_test' },
    });
  });

  it('streams an attachment from its download_url, without the API key', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.startsWith('https://api.resend.com/')
        ? json({ id: 'a1', content_type: 'image/png', size: 3, download_url: 'https://inbound-cdn.resend.com/x?sig=1' })
        : new Response('abc'),
    );
    const client = createResendClient({ apiKey: 're_test', fetch });

    const { stream, contentType, size } = await client.attachmentStream('e1', 'a1');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));

    expect(Buffer.concat(chunks).toString()).toBe('abc');
    expect({ contentType, size }).toEqual({ contentType: 'image/png', size: 3 });
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://api.resend.com/emails/receiving/e1/attachments/a1', {
      headers: { Authorization: 'Bearer re_test' },
    });
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://inbound-cdn.resend.com/x?sig=1');
  });

  it('throws with the status on a non-2xx', async () => {
    const client = createResendClient({ apiKey: 're_test', fetch: async () => json({ message: 'nope' }, 404) });

    await expect(client.getReceived('e1')).rejects.toThrow('404');
  });
});
