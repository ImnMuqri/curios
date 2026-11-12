import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Gateway, HelpInput } from '@curios/gateway';
import { helpGuide } from '@curios/core/help-guide';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';
import { NOT_IN_GUIDE } from './help.service.js';

let app: FastifyInstance;
let nth = 0;
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

/** What the stub answers next: an entry id (or "none") and the text, or an error. */
let next: { entry: string | null; answer: string } | Error = { entry: 'shop-vouchers', answer: 'Make a voucher in **Store**.' };
const calls: HelpInput[] = [];

function stubGateway(): Gateway {
  const unused = async () => {
    throw new Error('not used');
  };
  return {
    extract: unused,
    slots: unused,
    sameQuestion: unused,
     
    chat: async function* () {
      throw new Error('not used');
    },
    help: async (input) => {
      calls.push(input);
      if (next instanceof Error) throw next;
      return {
        entryId: next.entry,
        answer: next.answer,
        usage: { inputTokens: 40, outputTokens: 30, cacheReadTokens: 6000, cacheWriteTokens: 0 },
        model: 'claude-haiku-4-5',
        latencyMs: 1,
      };
    },
  };
}

const accounts: string[] = [];

beforeAll(async () => {
  app = await buildApp({ help: { gateway: stubGateway() } });
  await app.ready();
});

afterAll(async () => {
  await app.prisma.helpQuestion.deleteMany({ where: { accountId: { in: accounts } } });
  await app.prisma.supportThread.deleteMany({ where: { accountId: { in: accounts } } });
  await app.prisma.account.deleteMany({ where: { id: { in: accounts } } });
  await app.close();
});

beforeEach(() => {
  calls.length = 0;
  next = { entry: 'shop-vouchers', answer: 'Make a voucher in **Store**.' };
});

async function anOwner(mode: 'BUSINESS' | 'PERSONAL' = 'BUSINESS') {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `Help-${randomUUID()}@Example.com`,
      name: 'Lina binti Kamal',
      pages: { create: { handle: `hp-${slug}`, skeleton: `hp-${slug}`, displayName: 'Kek Lina', mode } },
    },
    select: { id: true, email: true, pages: { select: { id: true } } },
  });
  accounts.push(account.id);
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, accountId: account.id, email: account.email, pageId: account.pages[0]!.id };
}

const call = (method: 'GET' | 'POST', url: string, cookie: string | null, payload?: unknown) =>
  app.inject({
    method,
    url,
    remoteAddress: from(),
    ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}),
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });

async function setChat(on: boolean) {
  await app.prisma.systemSetting.upsert({ where: { key: 'switch.chat' }, create: { key: 'switch.chat', value: on }, update: { value: on } });
  app.settings.clear();
}

describe('signed in only', () => {
  it('refuses every help route without a session', async () => {
    expect((await call('GET', '/help/guide', null)).statusCode).toBe(401);
    expect((await call('POST', '/help/ask', null, { question: 'hi', screen: 'home' })).statusCode).toBe(401);
    expect((await call('POST', '/help/topic', null, { entryId: 'acc-dark', screen: 'home' })).statusCode).toBe(401);
    expect((await call('POST', '/help/support', null, { note: 'hi', screen: 'home' })).statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe('GET /help/guide', () => {
  it('gives every entry with the live numbers filled and no Source line', async () => {
    const mine = await anOwner();
    const res = await call('GET', '/help/guide', mine.cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ sections: Array<{ title: string; entries: Array<{ id: string; answer: string }> }>; chat: boolean }>();
    expect(body.chat).toBe(true);
    expect(body.sections.flatMap((s) => s.entries)).toHaveLength(helpGuide().entries.length);
    expect(res.body).not.toContain('"source"');
    expect(res.body).not.toMatch(/\{monthlyPrice\}|\{freeLeads\}/);
    const price = body.sections.flatMap((s) => s.entries).find((e) => e.id === 'bill-price')!;
    expect(price.answer).toMatch(/^RM\d/);
  });
});

describe('POST /help/ask', () => {
  it('answers from the entry the model named, with that entry’s screen, and logs it', async () => {
    const mine = await anOwner();
    const res = await call('POST', '/help/ask', mine.cookie, { question: 'how do i give a discount for raya?', screen: 'settings' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      state: 'answer',
      entryId: 'shop-vouchers',
      answer: 'Make a voucher in **Store**.',
      question: 'How do I give a discount?',
      open: '/app/store?tab=vouchers',
    });
    const row = await app.prisma.helpQuestion.findUniqueOrThrow({ where: { id: (res.json()).id } });
    expect(row).toMatchObject({ accountId: mine.accountId, screen: 'settings', via: 'CHAT', entryId: 'shop-vouchers', ok: true, helped: null, sentToSupport: false });
    expect(row.question).toBe('how do i give a discount for raya?');
  });

  it('sends the whole guide as the system prompt and the owner’s details only in the question turn', async () => {
    const mine = await anOwner('PERSONAL');
    await call('POST', '/help/ask', mine.cookie, { question: 'Why isn’t my page on Google?', screen: 'settings' });

    const input = calls[0]!;
    expect(input.entryIds).toEqual(helpGuide().entries.map((e) => e.id));
    expect(input.systemPrompt).toContain('<entry id="page-google"');
    expect(input.systemPrompt).not.toContain('Lina');
    expect(input.systemPrompt).not.toMatch(/\{monthlyPrice\}/);
    const last = input.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content).toContain('name="Lina"');
    expect(last.content).toContain('plan="personal page (free)"');
    expect(last.content).toContain('screen="Settings"');
    expect(last.content).toContain('<question>Why isn’t my page on Google?</question>');
  });

  it('never touches the page’s conversations, and records the cost against no page', async () => {
    const mine = await anOwner();
    const before = await app.prisma.modelCall.count({ where: { pageId: null } });
    await call('POST', '/help/ask', mine.cookie, { question: 'how much is business?', screen: 'billing' });

    const where = { pageId: mine.pageId };
    expect(await app.prisma.usageCounter.count({ where })).toBe(0);
    expect(await app.prisma.conversation.count({ where })).toBe(0);
    expect(await app.prisma.modelCall.count({ where })).toBe(0);
    expect(await app.prisma.modelCall.count({ where: { pageId: null } })).toBe(before + 1);
  });

  it('says it is not in the guide when the model names none, in the panel’s words', async () => {
    const mine = await anOwner();
    next = { entry: null, answer: 'Custom domains are not covered.' };
    const res = await call('POST', '/help/ask', mine.cookie, { question: 'Can I use my own domain?', screen: 'settings' });

    expect(res.json()).toEqual({ state: 'unknown', id: expect.any(String), answer: NOT_IN_GUIDE });
    const row = await app.prisma.helpQuestion.findUniqueOrThrow({ where: { id: (res.json()).id } });
    expect(row.entryId).toBeNull();
  });

  it('rests when the model fails, and logs the miss', async () => {
    const mine = await anOwner();
    next = new Error('overloaded');
    const res = await call('POST', '/help/ask', mine.cookie, { question: 'hi', screen: 'home' });

    expect(res.json()).toEqual({ state: 'resting' });
    expect(await app.prisma.helpQuestion.findFirst({ where: { accountId: mine.accountId }, select: { ok: true } })).toEqual({ ok: false });
  });

  it('rests without a model call while the admin has chat switched off', async () => {
    const mine = await anOwner();
    await setChat(false);
    try {
      const res = await call('POST', '/help/ask', mine.cookie, { question: 'hi', screen: 'home' });
      expect(res.json()).toEqual({ state: 'resting' });
      expect(calls).toHaveLength(0);
      expect(((await call('GET', '/help/guide', mine.cookie)).json()).chat).toBe(false);
    } finally {
      await setChat(true);
    }
  });

  it('refuses a screen it does not know and an empty question', async () => {
    const mine = await anOwner();
    expect((await call('POST', '/help/ask', mine.cookie, { question: 'hi', screen: 'nowhere' })).statusCode).toBe(400);
    expect((await call('POST', '/help/ask', mine.cookie, { question: '   ', screen: 'home' })).statusCode).toBe(400);
  });
});

describe('POST /help/topic and feedback', () => {
  it('logs a picked topic with its filled answer, and takes Yes or No on the owner’s own rows only', async () => {
    const mine = await anOwner();
    const theirs = await anOwner();
    const res = await call('POST', '/help/topic', mine.cookie, { entryId: 'bill-price', screen: 'billing' });
    expect(res.statusCode).toBe(201);
    const { id } = res.json();
    const row = await app.prisma.helpQuestion.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ via: 'TOPIC', entryId: 'bill-price', question: 'How much is Business?' });
    expect(row.answer).toMatch(/^RM\d/);

    expect((await call('POST', `/help/${id}/feedback`, theirs.cookie, { helped: true })).statusCode).toBe(200);
    expect((await app.prisma.helpQuestion.findUniqueOrThrow({ where: { id } })).helped).toBeNull();
    await call('POST', `/help/${id}/feedback`, mine.cookie, { helped: false });
    expect((await app.prisma.helpQuestion.findUniqueOrThrow({ where: { id } })).helped).toBe(false);
  });

  it('404s an entry the guide does not have', async () => {
    const mine = await anOwner();
    expect((await call('POST', '/help/topic', mine.cookie, { entryId: 'made-up', screen: 'home' })).statusCode).toBe(404);
  });
});

describe('POST /help/support', () => {
  it('opens a support thread from the owner’s address, matched to their account, with the question and answer', async () => {
    const mine = await anOwner();
    next = { entry: null, answer: 'x' };
    const asked = (await call('POST', '/help/ask', mine.cookie, { question: 'Can I use my own domain, like keklina.com?', screen: 'settings' })).json();

    const res = await call('POST', '/help/support', mine.cookie, { id: asked.id, note: 'I bought keklina.com last week.', screen: 'settings' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ email: mine.email });

    const thread = await app.prisma.supportThread.findFirstOrThrow({
      where: { accountId: mine.accountId },
      include: { messages: true },
    });
    expect(thread).toMatchObject({ address: mine.email.toLowerCase(), name: 'Lina binti Kamal', status: 'OPEN', unread: true, subject: 'Help: Can I use my own domain, like keklina.com?' });
    expect(thread.messages).toHaveLength(1);
    const message = thread.messages[0]!;
    expect(message).toMatchObject({ direction: 'IN', fromAddress: mine.email.toLowerCase(), resendEmailId: null });
    expect(message.messageId).toMatch(/^<.+@curios\.my>$/);
    expect(message.text).toContain('I bought keklina.com last week.');
    expect(message.text).toContain('Question: Can I use my own domain, like keklina.com?');
    expect(message.text).toContain(`Answer they got: ${NOT_IN_GUIDE}`);
    expect(message.text).toContain('From the guide: not in the guide');
    expect(message.text).toContain('Screen: Settings');
    expect((await app.prisma.helpQuestion.findUniqueOrThrow({ where: { id: asked.id } })).sentToSupport).toBe(true);
  });

  it('takes a note alone, from Topics, and refuses nothing at all', async () => {
    const mine = await anOwner();
    expect((await call('POST', '/help/support', mine.cookie, { note: 'How do I move my page to a new email?', screen: 'settings' })).statusCode).toBe(201);
    const thread = await app.prisma.supportThread.findFirstOrThrow({ where: { accountId: mine.accountId } });
    expect(thread.subject).toBe('Help: How do I move my page to a new email?');

    const empty = await call('POST', '/help/support', mine.cookie, { note: '  ', screen: 'settings' });
    expect(empty.statusCode).toBe(400);
    expect((empty.json()).error.code).toBe('HELP_EMPTY');
  });

  it('cannot send someone else’s question', async () => {
    const mine = await anOwner();
    const theirs = await anOwner();
    const asked = (await call('POST', '/help/ask', theirs.cookie, { question: 'secret question', screen: 'home' })).json();
    const res = await call('POST', '/help/support', mine.cookie, { id: asked.id, screen: 'home' });
    expect(res.statusCode).toBe(400);
    expect(await app.prisma.supportThread.count({ where: { accountId: mine.accountId } })).toBe(0);
  });
});
