import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Gateway } from '@curios/gateway';
import { currentPeriod } from '@curios/core';
import { buildApp } from '../../app.js';
import { ENQUIRY_FALLBACK_REPLY } from './chat.service.js';
import { enquiryMessage } from '../leads/enquiry.service.js';

let app: FastifyInstance;
let nth = 0;
/** A fresh source address per request, so the per-IP limiter never sees a flood. */
const from = () => `203.0.116.${(nth++ % 200) + 1}`;

const REPLY = 'Thanks, Aisyah! Kek Lina will confirm the details on WhatsApp.';

/**
 * What the stub gateway does on its next chat call: reply, or throw before a word. Every call is
 * recorded with the system prompt it was given, so a test can say there was none, or read the prompt.
 */
let mode: 'reply' | 'throw' = 'reply';
const chatCalls: string[] = [];

function stubGateway(): Gateway {
  return {
    extract: vi.fn(),
    slots: vi.fn(),
    sameQuestion: async () => {
      throw new Error('not used');
    },
    chat: async function* (input) {
      chatCalls.push(input.systemPrompt);
      if (mode === 'throw') throw new Error('provider down');
      yield { type: 'text' as const, text: REPLY };
      yield {
        type: 'done' as const,
        usage: { inputTokens: 900, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 },
        // A real model id: recordModelCall prices every call and throws on one it does not know.
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

beforeAll(async () => {
  app = await buildApp({ chat: { gateway: stubGateway(), embedder: null } });
  await app.ready();
});

afterAll(async () => {
  // Neither SystemSetting nor ModelCall is reached by a truncate cascade: this suite removes its own.
  await app.prisma.systemSetting.deleteMany({ where: { key: 'switch.chat' } });
  await app.prisma.$executeRawUnsafe('TRUNCATE "ModelCall"');
  await app.close();
});

beforeEach(async () => {
  mode = 'reply';
  chatCalls.length = 0;
  await chatSwitch(true);
  // The cap's email is the mail queue's business, never Redis's here.
  vi.spyOn(app.mailQueue, 'add').mockImplementation(async () => ({}) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A published shop with an Ask item, and an enquiry about it as the enquiry route writes one. */
async function aShopWithAnEnquiry() {
  const handle = `ce-${randomUUID().slice(0, 8)}`;
  const account = await app.prisma.account.create({
    data: {
      email: `ce-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle,
          skeleton: handle,
          displayName: 'Kek Lina',
          published: true,
          mode: 'BUSINESS',
          storeEnabled: true,
          facts: { create: { category: 'PRICE', claim: 'Kek butter 1kg RM95', normalizedClaim: 'kek butter 1kg rm95', confidence: 0.9, verified: true } },
        },
      },
    },
    select: { pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]!.id;
  const item = await app.prisma.item.create({
    data: { pageId, name: 'Kek kahwin', slug: 'kek-kahwin', position: 0, priceCents: 18_000, askForPrice: true },
    select: { id: true },
  });
  const conversationId = await anEnquiry(pageId, item.id);
  return { handle, pageId, itemId: item.id, conversationId };
}
type Shop = Awaited<ReturnType<typeof aShopWithAnEnquiry>>;

async function anEnquiry(pageId: string, itemId: string): Promise<string> {
  const message = 'Kek 3 tingkat untuk 150 orang, 20 Disember.';
  const conversation = await app.prisma.conversation.create({
    data: { pageId, messages: { create: { role: 'USER', content: enquiryMessage('Kek kahwin', message) } } },
    select: { id: true },
  });
  await app.prisma.lead.create({
    data: { pageId, conversationId: conversation.id, phone: '+60123456789', kind: 'ENQUIRY', itemId, name: 'Aisyah', note: message },
  });
  return conversation.id;
}

const reply = (handle: string, conversationId: string) =>
  app.inject({ method: 'POST', url: `/chat/${handle}/enquiry`, remoteAddress: from(), payload: { conversationId } });

interface Event {
  type: string;
  text?: string;
  conversationId?: string;
  code?: string;
  intent?: { qualified: boolean };
  productCards?: unknown;
}

/** The events an SSE body carries, parsed the way the browser client parses them. */
function eventsOf(payload: string): Event[] {
  return payload
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)) as Event);
}

const textOf = (payload: string) =>
  eventsOf(payload)
    .filter((event) => event.type === 'text')
    .map((event) => event.text ?? '')
    .join('');

const assistantMessages = (conversationId: string) =>
  app.prisma.message.findMany({ where: { conversationId, role: 'ASSISTANT' }, select: { content: true } });

const used = async (pageId: string) =>
  (await app.prisma.usageCounter.findUnique({ where: { pageId_period: { pageId, period: currentPeriod() } }, select: { count: true } }))?.count ?? 0;

/** The meter one short of over: the next conversation goes over the admin's cap. */
async function atTheCap(shop: Shop) {
  const { cap } = await app.settings.get();
  await app.prisma.usageCounter.create({ data: { pageId: shop.pageId, period: currentPeriod(), count: cap } });
}

describe('POST /chat/:handle/enquiry', () => {
  it("streams the model's reply, then a done with no capture intent and no product cards, and writes the reply once", async () => {
    const shop = await aShopWithAnEnquiry();

    const res = await reply(shop.handle, shop.conversationId);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = eventsOf(res.payload);
    expect(textOf(res.payload)).toBe(REPLY);
    const done = events.at(-1);
    expect(done).toEqual({ type: 'done', conversationId: shop.conversationId, intent: { qualified: false } });
    expect(done).not.toHaveProperty('productCards');
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(chatCalls).toHaveLength(1);
    expect(await assistantMessages(shop.conversationId)).toEqual([{ content: REPLY }]);
  });

  it('gives the model the enquiry instruction naming the item, and the shop with the item marked ask', async () => {
    const shop = await aShopWithAnEnquiry();
    await reply(shop.handle, shop.conversationId);

    const prompt = chatCalls[0] ?? '';
    expect(prompt).toContain('This conversation began with an enquiry the visitor sent about Kek kahwin');
    expect(prompt).toContain('<item name="Kek kahwin" ask="yes">from RM180');
  });

  it('a second call gives back the written reply without asking the model again', async () => {
    const shop = await aShopWithAnEnquiry();
    await reply(shop.handle, shop.conversationId);
    expect(chatCalls).toHaveLength(1);

    const again = await reply(shop.handle, shop.conversationId);

    expect(textOf(again.payload)).toBe(REPLY);
    expect(eventsOf(again.payload).at(-1)).toEqual({ type: 'done', conversationId: shop.conversationId, intent: { qualified: false } });
    expect(chatCalls).toHaveLength(1);
    expect(await assistantMessages(shop.conversationId)).toHaveLength(1);
  });

  it('is never a Question, a Topic or an ask on the Questions screen, and counts one conversation on the meter', async () => {
    const shop = await aShopWithAnEnquiry();
    const before = await used(shop.pageId);

    await reply(shop.handle, shop.conversationId);
    await reply(shop.handle, shop.conversationId);

    expect(await app.prisma.question.count({ where: { pageId: shop.pageId } })).toBe(0);
    expect(await app.prisma.topic.count({ where: { pageId: shop.pageId } })).toBe(0);
    expect(await app.prisma.questionAsk.count({ where: { question: { pageId: shop.pageId } } })).toBe(0);
    // The reload replays the reply and is not a second conversation.
    expect(await used(shop.pageId)).toBe(before + 1);
  });

  it('gives an error event with CONVERSATION_NOT_FOUND for a conversation that is not an enquiry, or not this page\'s', async () => {
    const shop = await aShopWithAnEnquiry();
    const other = await aShopWithAnEnquiry();
    // A chat conversation with a number left in it: a lead, but not an enquiry.
    const chat = await app.prisma.conversation.create({ data: { pageId: shop.pageId, messages: { create: { role: 'USER', content: 'ada kek?' } } }, select: { id: true } });
    await app.prisma.lead.create({ data: { pageId: shop.pageId, conversationId: chat.id, phone: '+60129999999' } });
    // A conversation with no lead at all.
    const bare = await app.prisma.conversation.create({ data: { pageId: shop.pageId, messages: { create: { role: 'USER', content: 'hi' } } }, select: { id: true } });

    for (const conversationId of [chat.id, bare.id, other.conversationId, 'nope']) {
      const res = await reply(shop.handle, conversationId);
      expect(res.statusCode).toBe(200);
      const events = eventsOf(res.payload);
      expect(events.find((event) => event.type === 'error')).toMatchObject({ type: 'error', code: 'CONVERSATION_NOT_FOUND' });
      expect(events.some((event) => event.type === 'done')).toBe(false);
    }
    expect(chatCalls).toHaveLength(0);
    expect(await assistantMessages(other.conversationId)).toEqual([]);
  });

  it('over the cap: the fixed reply, written, with no model call', async () => {
    const shop = await aShopWithAnEnquiry();
    await atTheCap(shop);

    const res = await reply(shop.handle, shop.conversationId);

    expect(textOf(res.payload)).toBe(ENQUIRY_FALLBACK_REPLY('Kek Lina'));
    expect(eventsOf(res.payload).at(-1)).toEqual({ type: 'done', conversationId: shop.conversationId, intent: { qualified: false } });
    expect(chatCalls).toHaveLength(0);
    expect(await assistantMessages(shop.conversationId)).toEqual([{ content: ENQUIRY_FALLBACK_REPLY('Kek Lina') }]);
  });

  it('chat switched off: the fixed reply with no model call, and nothing on the meter', async () => {
    const shop = await aShopWithAnEnquiry();
    await chatSwitch(false);

    const res = await reply(shop.handle, shop.conversationId);

    expect(textOf(res.payload)).toBe(ENQUIRY_FALLBACK_REPLY('Kek Lina'));
    expect(chatCalls).toHaveLength(0);
    expect(await used(shop.pageId)).toBe(0);
    expect(await assistantMessages(shop.conversationId)).toEqual([{ content: ENQUIRY_FALLBACK_REPLY('Kek Lina') }]);
  });

  it('the model failing before a word: the fixed reply, written, and the failed call recorded', async () => {
    const shop = await aShopWithAnEnquiry();
    mode = 'throw';

    const res = await reply(shop.handle, shop.conversationId);

    expect(textOf(res.payload)).toBe(ENQUIRY_FALLBACK_REPLY('Kek Lina'));
    expect(eventsOf(res.payload).some((event) => event.type === 'error')).toBe(false);
    expect(eventsOf(res.payload).at(-1)).toMatchObject({ type: 'done', conversationId: shop.conversationId });
    expect(chatCalls).toHaveLength(1);
    expect(await assistantMessages(shop.conversationId)).toEqual([{ content: ENQUIRY_FALLBACK_REPLY('Kek Lina') }]);
    expect(await app.prisma.modelCall.count({ where: { conversationId: shop.conversationId, ok: false } })).toBe(1);
  });

  it('answers a suspended page 410 PAGE_UNAVAILABLE before any stream', async () => {
    const shop = await aShopWithAnEnquiry();
    await app.prisma.page.update({ where: { id: shop.pageId }, data: { suspendedAt: new Date(), suspendReason: 'x' } });
    const res = await reply(shop.handle, shop.conversationId);
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('PAGE_UNAVAILABLE');
    expect(chatCalls).toHaveLength(0);
  });
});
