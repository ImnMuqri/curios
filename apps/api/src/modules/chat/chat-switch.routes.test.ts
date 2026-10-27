import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Gateway } from '@curios/gateway';
import { currentPeriod, type MailJobData } from '@curios/core';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';
import { CAP_REACHED_REPLY } from './chat.service.js';

let app: FastifyInstance;
let nth = 0;
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

/** Every model call either chat route makes, answer or same-question check alike. */
const modelCalls = vi.fn();

function stubGateway(): Gateway {
  return {
    extract: vi.fn(),
    slots: vi.fn(),
    sameQuestion: async () => {
      modelCalls('sameQuestion');
      throw new Error('not used');
    },
    chat: async function* () {
      modelCalls('chat');
      yield { type: 'text' as const, text: 'Kek butter 1kg RM95.' };
      yield {
        type: 'done' as const,
        usage: { inputTokens: 900, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 },
        model: 'claude-haiku-4-5',
        latencyMs: 1,
      };
    },
  };
}

/** The switch as the admin's route stores it, then the cache cleared, as that route does. */
async function chatSwitch(on: boolean) {
  await app.prisma.systemSetting.upsert({ where: { key: 'switch.chat' }, create: { key: 'switch.chat', value: on }, update: { value: on } });
  app.settings.clear();
}

let handle: string;
let pageId: string;
let cookie: string;

beforeAll(async () => {
  app = await buildApp({ chat: { gateway: stubGateway(), embedder: null } });
  await app.ready();
  const slug = randomUUID().slice(0, 8);
  handle = `cs-${slug}`;
  const account = await app.prisma.account.create({
    data: {
      email: `cs-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle,
          skeleton: handle,
          displayName: 'Nadia Bakes',
          published: true,
          facts: { create: { category: 'PRICE', claim: 'Kek butter 1kg RM95', normalizedClaim: 'kek butter 1kg rm95', confidence: 0.9, verified: true } },
        },
      },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  pageId = account.pages[0]!.id;
  // An answered topic, so the owner's own answer is there to give if the switch let it through.
  const topic = await app.prisma.topic.create({ data: { pageId, title: 'Ada delivery?', answer: 'Ya, sekitar Shah Alam.', askCount: 1 } });
  await app.prisma.question.create({ data: { pageId, topicId: topic.id, text: 'Ada delivery?', normalizedQuestion: 'ada delivery' } });
  cookie = (await createSession(app.prisma, account.id)).value;
});

afterAll(async () => {
  // SystemSetting is reached by no truncate cascade: this suite removes its own row.
  await app.prisma.systemSetting.deleteMany({ where: { key: 'switch.chat' } });
  // Nor is ModelCall: the answers this suite lets through write one each.
  await app.prisma.$executeRawUnsafe('TRUNCATE "ModelCall"');
  await app.close();
});

// Here, not in the test: a failing assertion must not leave the mailQueue spy on for the next one.
afterEach(() => {
  vi.restoreAllMocks();
});

/** This month's conversations on the page's meter. */
const used = async () =>
  (await app.prisma.usageCounter.findUnique({ where: { pageId_period: { pageId, period: currentPeriod() } }, select: { count: true } }))?.count ?? 0;

beforeEach(async () => {
  modelCalls.mockClear();
  await chatSwitch(true);
});

const ask = (question: string) => app.inject({ method: 'POST', url: `/chat/${handle}`, remoteAddress: from(), payload: { question } });

function textOf(payload: string): string {
  return payload
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)) as { type: string; text?: string })
    .filter((event) => event.type === 'text')
    .map((event) => event.text ?? '')
    .join('');
}

describe('the chat switch', () => {
  it('off: the visitor gets the fixed reply, with no model call, and the turn is kept as over the cap keeps it', async () => {
    const mailed: MailJobData[] = [];
    vi.spyOn(app.mailQueue, 'add').mockImplementation(async (_name, data) => {
      mailed.push(data);
      return {} as never;
    });
    await chatSwitch(false);
    const before = await used();

    const res = await ask('Berapa harga kek butter?');
    expect(res.statusCode).toBe(200);
    expect(textOf(res.payload)).toBe(CAP_REACHED_REPLY);
    expect(modelCalls).not.toHaveBeenCalled();
    expect(await app.prisma.modelCall.count({ where: { pageId } })).toBe(0);

    // Kept as the over-cap path keeps it: the conversation, both messages, the ask, unmarked.
    const conversation = await app.prisma.conversation.findFirstOrThrow({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      select: { messages: { orderBy: { createdAt: 'asc' }, select: { role: true, content: true } } },
    });
    expect(conversation.messages).toEqual([
      { role: 'USER', content: 'Berapa harga kek butter?' },
      { role: 'ASSISTANT', content: CAP_REACHED_REPLY },
    ]);
    const asks = await app.prisma.questionAsk.findMany({ where: { question: { pageId, normalizedQuestion: 'berapa harga kek butter' } }, select: { answered: true } });
    expect(asks).toEqual([{ answered: null }]);
    // Not the cap: no "reached its monthly limit" email, and the month's counter is not claimed.
    expect(mailed).toEqual([]);
    // Nobody was answered, so the owner's month is not spent.
    expect(await used()).toBe(before);
    const counter = await app.prisma.usageCounter.findUnique({ where: { pageId_period: { pageId, period: currentPeriod() } }, select: { capMailedAt: true } });
    expect(counter?.capMailedAt ?? null).toBeNull();
  });

  it('off: even the owner’s own answer gives way to the fixed reply', async () => {
    await chatSwitch(false);
    const res = await ask('Ada delivery?');
    expect(textOf(res.payload)).toBe(CAP_REACHED_REPLY);
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it('off: the owner’s tester gets the fixed reply too, with no model call', async () => {
    await chatSwitch(false);
    const res = await app.inject({
      method: 'POST',
      url: '/chat/test',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: cookie },
      payload: { question: 'Berapa harga kek butter?' },
    });
    expect(res.statusCode).toBe(200);
    // Its own `from`, so the tester never calls a pause the owner's monthly limit.
    expect(res.json()).toEqual({ reply: CAP_REACHED_REPLY, from: 'off' });
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it('back on: both answer from the model again', async () => {
    await chatSwitch(false);
    await chatSwitch(true);

    const before = await used();
    const visitor = await ask('Kek butter berapa?');
    expect(await used()).toBe(before + 1);
    expect(textOf(visitor.payload)).toBe('Kek butter 1kg RM95.');

    const tester = await app.inject({
      method: 'POST',
      url: '/chat/test',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: cookie },
      payload: { question: 'Kek butter berapa?' },
    });
    expect(tester.json()).toMatchObject({ reply: 'Kek butter 1kg RM95.', from: 'facts' });
    expect(modelCalls).toHaveBeenCalledWith('chat');
  });
});
