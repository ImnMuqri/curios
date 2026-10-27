import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteWording } from '../topics/topic.service.js';
import { PrismaClient } from '@prisma/client';
import { refreshTopic } from '@curios/db';
import { FREE_CONVERSATIONS_PER_MONTH, GROUP_QUEUE, normalizeClaim, RETRIEVAL_MIN_FACTS } from '@curios/core';
import type { ChatInput, ChatMessage, Gateway } from '@curios/gateway';
import {
  encodeVector,
  EMBEDDING_DIMS,
  EMBEDDING_MODEL,
  type Embedder,
} from '@curios/embeddings';
import { answer, CAP_REACHED_REPLY, MAX_HISTORY_MESSAGES, PageNotFoundError } from './chat.service.js';
import { REPLY_FALLBACK } from './reply-guard.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

// ChatDeps.cap is resolved once at boot in production (see chat.routes.ts);
// this file calls `answer()` directly, below that boundary, so every deps
// object supplies it explicitly. The free allowance, not an arbitrary number:
// the `the monthly cap` tests below rely on it being the same value
// `conversationCap()` used to return with no env override set, which is what
// every test in this file ran against before ChatDeps.cap existed.
const cap = FREE_CONVERSATIONS_PER_MONTH;

function gatewaySaying(text: string): Gateway {
  return {
    extract: vi.fn(),
    slots: vi.fn(),
    sameQuestion: async () => {
      throw new Error('not used');
    },
    chat: async function* () {
      yield { type: 'text' as const, text };
      yield {
        type: 'done' as const,
        usage: { inputTokens: 900, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 },
        model: 'claude-haiku-4-5',
        latencyMs: 700,
      };
    },
  };
}

function gatewayThatFails(): Gateway {
  return {
    extract: vi.fn(),
    slots: vi.fn(),
    sameQuestion: async () => {
      throw new Error('not used');
    },
    chat: async function* () {
      throw new Error('provider unavailable');
    },
  };
}

/** Records the exact systemPrompt the gateway received, for asserting on it directly. */
function gatewayCapturingPrompt(): { gateway: Gateway; prompt: () => string } {
  let captured = '';
  const gateway: Gateway = {
    extract: vi.fn(),
    slots: vi.fn(),
    sameQuestion: async () => {
      throw new Error('not used');
    },
    chat: async function* ({ systemPrompt }) {
      captured = systemPrompt;
      yield { type: 'text' as const, text: 'ok' };
      yield {
        type: 'done' as const,
        usage: { inputTokens: 900, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 },
        model: 'claude-haiku-4-5',
        latencyMs: 700,
      };
    },
  };
  return { gateway, prompt: () => captured };
}

/** Records the exact `cachePrompt` flag the gateway received. */
function gatewayCapturingCachePrompt(): { gateway: Gateway; cachePrompt: () => boolean | undefined } {
  let captured: boolean | undefined;
  const gateway: Gateway = {
    extract: vi.fn(),
    slots: vi.fn(),
    sameQuestion: async () => {
      throw new Error('not used');
    },
    chat: async function* ({ cachePrompt }) {
      captured = cachePrompt;
      yield { type: 'text' as const, text: 'ok' };
      yield {
        type: 'done' as const,
        usage: { inputTokens: 900, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 },
        model: 'claude-haiku-4-5',
        latencyMs: 700,
      };
    },
  };
  return { gateway, cachePrompt: () => captured };
}

/** Records the exact message list the gateway received, for asserting on the thread. */
function gatewayCapturingMessages(): { gateway: Gateway; messages: () => ChatMessage[] } {
  let captured: ChatMessage[] = [];
  const gateway: Gateway = {
    extract: vi.fn(),
    slots: vi.fn(),
    sameQuestion: async () => {
      throw new Error('not used');
    },
    chat: async function* ({ messages }) {
      captured = messages;
      yield { type: 'text' as const, text: 'an answer' };
      yield {
        type: 'done' as const,
        usage: { inputTokens: 900, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 },
        model: 'claude-haiku-4-5',
        latencyMs: 700,
      };
    },
  };
  return { gateway, messages: () => captured };
}

/** Records the whole ChatInput the gateway received, for asserting on retrieval's wiring. */
function gatewayCapturingCall(): { gateway: Gateway; call: () => ChatInput } {
  let captured: ChatInput | undefined;
  const gateway: Gateway = {
    extract: vi.fn(),
    slots: vi.fn(),
    sameQuestion: async () => {
      throw new Error('not used');
    },
    chat: async function* (input) {
      captured = input;
      yield { type: 'text' as const, text: 'ok' };
      yield {
        type: 'done' as const,
        usage: { inputTokens: 900, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 },
        model: 'claude-haiku-4-5',
        latencyMs: 700,
      };
    },
  };
  return {
    gateway,
    call: () => {
      if (!captured) throw new Error('gateway.chat was never called');
      return captured;
    },
  };
}

function axis(index: number): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIMS);
  vector[index] = 1;
  return vector;
}

/**
 * A claim exactly 200 characters long, unique per index -- the same fixture
 * shape retrieval.test.ts uses, and for the same reason: the ~85-character
 * claim this fixture used to carry left a 30-fact page under the budget as
 * it then stood (4,000), so the budget never bound and "sends a chosen few"
 * could not tell a chosen few apart from the whole page.
 */
function claimOfLength(index: number, length = 200): string {
  const prefix = `Fakta nombor ${index}: `;
  const filler =
    'lapan puluh aksara sahaja tidak mencukupi untuk menguji bajet retrieval, jadi fakta ini ' +
    'sengaja dipanjangkan supaya jumlah kandungan tiga puluh fakta melebihi bajet retrieval ' +
    'yang ditetapkan bagi halaman ini. '.repeat(3);
  return (prefix + filler).slice(0, length);
}

/** An embedder that always answers with `axis(0)` and counts its calls. Copied from retrieval.test.ts. */
function embedderAnswering(vector: Float32Array = axis(0)) {
  const embed = vi.fn(async (texts: string[]) => texts.map(() => vector));
  const embedder: Embedder = { model: EMBEDDING_MODEL, dims: EMBEDDING_DIMS, embed };
  return { embedder, embed };
}

async function collect(stream: AsyncIterable<{ type: string; text?: string }>) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

// This clears QuestionEmbedding before every test but not after the last one.
// This file's own describe('retrieval in the chat path') writes rows to it,
// so -- run alone, and depending on which test happens to be declared last --
// a row can be left behind: QuestionEmbedding hangs off nothing, so no
// CASCADE from Account reaches it. The afterAll below is the guaranteed
// cleanup; relying on "the last test never calls the embedder" is an accident
// of declaration order, not a property this file enforces.
afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account", "ModelCall", "QuestionEmbedding" CASCADE');
});

beforeEach(async () => {
  // QuestionEmbedding hangs off nothing, so CASCADE from Account does not
  // reach it -- the same defect ModelCall was fixed for last slice.
  await prisma.$executeRawUnsafe('TRUNCATE "Account", "ModelCall", "QuestionEmbedding" CASCADE');
  await prisma.account.create({
    data: {
      email: 'n@example.com',
      pages: {
        create: {
          handle: 'nadia',
          skeleton: 'nadia',
          displayName: 'Nadia Bakes',
          published: true,
          facts: {
            create: [
              {
                category: 'PRICE',
                claim: 'Kek 1kg butter starts at RM95',
                normalizedClaim: 'kek 1kg butter starts at rm95',
                confidence: 0.9,
                verified: true,
              },
              // Unverified: never reviewed by the owner. This is the fixture
              // the most dangerous line in the product (`verified: true` in
              // the facts query above) exists to guard -- deleting that
              // filter must make this fact reach the gateway, and every test
              // in this file must still be green if it does not.
              {
                category: 'PRICE',
                claim: 'Unverified secret price RM1',
                normalizedClaim: 'unverified secret price rm1',
                confidence: 0.5,
                verified: false,
              },
            ],
          },
        },
      },
    },
  });
  await prisma.account.create({
    data: {
      email: 'unpublished@example.com',
      pages: {
        create: {
          handle: 'draft',
          skeleton: 'draft',
          displayName: 'Not Live Yet',
          published: false,
          facts: {
            create: {
              category: 'PRICE',
              claim: 'Draft price RM1',
              normalizedClaim: 'draft price rm1',
              confidence: 0.9,
              verified: true,
            },
          },
        },
      },
    },
  });
});

/**
 * A page with RETRIEVAL_MIN_FACTS + 5 facts, all carrying a current vector.
 * Its own handle and account -- 'nadia' above is this file's small fixture
 * page and stays under the retrieval minimum on purpose, so the two never
 * need to share a shape.
 *
 * Fact 0 gets `axis(0)`, matching the question vector `embedderAnswering()`
 * hands out by default, so it always scores best; every other fact gets
 * `axis(1)`, orthogonal to it. Mirrors retrieval.test.ts's own seedPage.
 */
async function seedLargePage(): Promise<string> {
  const count = RETRIEVAL_MIN_FACTS + 5;
  const claims = Array.from({ length: count }, (_unused, index) => claimOfLength(index));

  const account = await prisma.account.create({
    data: {
      email: `katalog-${Date.now()}@example.com`,
      pages: {
        create: {
          handle: 'katalog',
          skeleton: 'katalog',
          displayName: 'Katalog Besar',
          published: true,
          facts: {
            create: claims.map((claim) => ({
              category: 'PRICE' as const,
              claim,
              normalizedClaim: claim.toLowerCase(),
              confidence: 1,
              verified: true,
            })),
          },
        },
      },
    },
    include: { pages: { include: { facts: true } } },
  });

  const page = account.pages[0];
  if (!page) throw new Error('seedLargePage produced no page');

  await prisma.factEmbedding.createMany({
    data: page.facts.map((fact, index) => ({
      factId: fact.id,
      vector: encodeVector(index === 0 ? axis(0) : axis(1)),
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
    })),
  });

  return page.id;
}

async function pageIdFor(handle: string): Promise<string> {
  const page = await prisma.page.findUniqueOrThrow({ where: { handle }, select: { id: true } });
  return page.id;
}

/**
 * A topic holding the given wordings, answered when `answerText` is given.
 * The topic's count is the sum of its wordings', as refreshTopic keeps it.
 */
async function seedTopic(
  pageId: string,
  input: { title?: string; answer?: string; wordings: { text: string; askCount?: number }[] },
) {
  const asks = input.wordings.map((w) => w.askCount ?? 1);
  return prisma.topic.create({
    data: {
      pageId,
      title: input.title ?? input.wordings[0]?.text ?? '',
      answer: input.answer ?? null,
      answeredAt: input.answer ? new Date() : null,
      askCount: asks.reduce((a, b) => a + b, 0),
      questions: {
        create: input.wordings.map((w, i) => ({
          pageId,
          text: w.text,
          normalizedQuestion: normalizeClaim(w.text),
          askCount: asks[i] ?? 1,
          groupedAt: new Date(),
        })),
      },
    },
    select: { id: true },
  });
}

/** The nadia fixture's answered topic: one wording, "Berapa harga?". */
async function seedNadiaPrice() {
  return seedTopic(await pageIdFor('nadia'), {
    answer: 'Bermula RM95.',
    wordings: [{ text: 'Berapa harga?' }],
  });
}

describe('answer', () => {
  it('streams text and creates a conversation', async () => {
    const gateway = gatewaySaying('Kek 1kg butter bermula RM95.');
    const events = await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga kek' }));

    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toContain('RM95');
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('returns a topic answer without calling the model at all', async () => {
    await seedNadiaPrice();
    const gateway = gatewaySaying('should not be used');
    const chatSpy = vi.spyOn(gateway, 'chat');

    const events = await collect(
      answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'Berapa harga?' }),
    );

    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Bermula RM95.');
    expect(chatSpy).not.toHaveBeenCalled();
    expect(await prisma.modelCall.count()).toBe(0);
  });

  it('matches a topic answer ignoring case and punctuation', async () => {
    await seedNadiaPrice();
    const gateway = gatewaySaying('unused');
    const events = await collect(
      answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'berapa harga' }),
    );
    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Bermula RM95.');
  });

  it('persists both messages after the stream closes', async () => {
    const gateway = gatewaySaying('Kek 1kg butter bermula RM95.');
    await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga kek' }));

    const messages = await prisma.message.findMany({ orderBy: { createdAt: 'asc' } });
    expect(messages.map((m) => m.role)).toEqual(['USER', 'ASSISTANT']);
  });

  it('records a ModelCall with a non-zero cost', async () => {
    const gateway = gatewaySaying('Kek 1kg butter bermula RM95.');
    await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga kek' }));

    const call = await prisma.modelCall.findFirstOrThrow();
    expect(call.model).toBe('claude-haiku-4-5');
    expect(call.costMilliCents).toBeGreaterThan(0);
  });

  it('increments the usage counter once per conversation, not per message', async () => {
    const gateway = gatewaySaying('answer');
    await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga kek' }));
    await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga kek lagi' }));

    const counters = await prisma.usageCounter.findMany();
    expect(counters).toHaveLength(1);
    expect(counters[0]?.count).toBe(2);
  });

  it('records a failed ModelCall and keeps the user message when the gateway throws mid-stream', async () => {
    const gateway = gatewayThatFails();

    await expect(
      collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga kek' })),
    ).rejects.toThrow('provider unavailable');

    const call = await prisma.modelCall.findFirstOrThrow();
    expect(call.ok).toBe(false);

    const messages = await prisma.message.findMany();
    expect(messages.map((m) => m.role)).toEqual(['USER']);
  });

  it('throws for an unknown handle', async () => {
    const gateway = gatewaySaying('unused');
    await expect(
      collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nobody', question: 'hi' })),
    ).rejects.toThrow(PageNotFoundError);
  });

  it('sends cachePrompt: true, since with no embedder it falls back and caches the prompt', async () => {
    const { gateway, cachePrompt } = gatewayCapturingCachePrompt();
    await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga kek' }));

    expect(cachePrompt()).toBe(true);
  });

  it('never sends an unverified fact\'s claim to the gateway', async () => {
    const { gateway, prompt } = gatewayCapturingPrompt();
    await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga kek' }));

    // Assert on the prompt the gateway actually received, not a rebuilt string.
    expect(prompt()).not.toContain('Unverified secret price RM1');
    expect(prompt()).toContain('Kek 1kg butter starts at RM95');
  });

  it('treats an unpublished page the same as a missing one: no answer, no tokens spent', async () => {
    const gateway = gatewaySaying('should not be used');
    const chatSpy = vi.spyOn(gateway, 'chat');

    await expect(
      collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'draft', question: 'harga?' })),
    ).rejects.toThrow(PageNotFoundError);

    expect(chatSpy).not.toHaveBeenCalled();
    expect(await prisma.conversation.count()).toBe(0);
  });

  it('refuses a suspended page with PAGE_UNAVAILABLE: no answer, no tokens spent, no conversation', async () => {
    await prisma.page.update({ where: { handle: 'nadia' }, data: { suspendedAt: new Date(), suspendReason: 'x' } });
    const gateway = gatewaySaying('should not be used');
    const chatSpy = vi.spyOn(gateway, 'chat');

    await expect(
      collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga?' })),
    ).rejects.toMatchObject({ code: 'PAGE_UNAVAILABLE', statusCode: 410 });

    expect(chatSpy).not.toHaveBeenCalled();
    expect(await prisma.conversation.count()).toBe(0);
  });
});

describe('threading a conversation', () => {
  function depsSaying(text = 'an answer') {
    return { prisma, gateway: gatewaySaying(text), cap, embedder: null };
  }

  async function ask(
    deps: { prisma: typeof prisma; gateway: Gateway; cap: number; embedder: Embedder | null },
    question: string,
    conversationId?: string,
  ) {
    return collect(answer(deps, { handle: 'nadia', question, conversationId }));
  }

  function conversationIdOf(events: Array<{ type: string; conversationId?: string }>): string {
    const done = events.find((e) => e.type === 'done');
    if (!done?.conversationId) throw new Error('no done event with a conversation id');
    return done.conversationId;
  }

  it('never lets a never-say word through: the sentence goes, in the stream and in what is stored', async () => {
    const pageId = await pageIdFor('nadia');
    await prisma.neverSay.create({ data: { pageId, phrase: 'jamin' } });
    const events = await ask(depsSaying('Saya tak boleh jamin harga tak naik. Kek butter 1kg RM95.'), 'boleh jamin harga tak naik?');
    const streamed = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');
    expect(streamed).toBe('Kek butter 1kg RM95.');
    const stored = await prisma.message.findFirstOrThrow({ where: { role: 'ASSISTANT' } });
    expect(stored.content).toBe('Kek butter 1kg RM95.');
  });

  it('never states an amount the model was not given: a worked-out price and an unreviewed one both go', async () => {
    const events = await ask(
      depsSaying('Kek butter 1kg RM95. Untuk 2kg, harga akan jadi RM190. Ada juga yang RM1.'),
      'kek butter 2kg berapa?',
    );
    const streamed = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');
    // RM95 is a verified fact; RM190 is the 1kg price doubled; RM1 is only in a fact the owner has not accepted.
    expect(streamed).toBe('Kek butter 1kg RM95. ');
    expect((await prisma.message.findFirstOrThrow({ where: { role: 'ASSISTANT' } })).content).toBe('Kek butter 1kg RM95. ');
  });

  it('answers with the fallback, counted as not answered, when every sentence carried a never-say word', async () => {
    const pageId = await pageIdFor('nadia');
    await prisma.neverSay.create({ data: { pageId, phrase: 'halal' } });
    const events = await ask(depsSaying('Ya, kek kami halal.'), 'kek halal ke?');
    const streamed = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');
    expect(streamed).toBe(REPLY_FALLBACK);
    expect(streamed.toLowerCase()).not.toContain('halal');
    const asked = await prisma.questionAsk.findFirstOrThrow({ select: { answered: true } });
    expect(asked.answered).toBe(false);
  });

  it('creates a conversation when given no id, and returns it', async () => {
    const events = await ask(depsSaying(), 'harga?');
    expect(events.find((e) => e.type === 'done')).toMatchObject({
      type: 'done',
      conversationId: expect.any(String),
    });
  });

  it('appends to the conversation it is given rather than starting another', async () => {
    const deps = depsSaying();
    const conversationId = conversationIdOf(await ask(deps, 'harga kek?'));
    await ask(deps, 'ada delivery?', conversationId);

    // Four messages in one conversation, not two conversations of two.
    expect(await prisma.conversation.count()).toBe(1);
    expect(await prisma.message.count({ where: { conversationId } })).toBe(4);
  });

  it('counts one usage unit for a whole conversation, however chatty', async () => {
    // THE invariant. chat.service.ts has always claimed "the meter counts
    // conversations, not messages, so a chatty visitor costs the owner one
    // unit" -- true only by accident while every call made a conversation.
    // This is the meter the paid plan is priced against.
    const deps = depsSaying();
    const conversationId = conversationIdOf(await ask(deps, 'one'));
    await ask(deps, 'two', conversationId);
    await ask(deps, 'three', conversationId);

    const counter = await prisma.usageCounter.findFirstOrThrow({});
    expect(counter.count).toBe(1);
  });

  it('sends the earlier turns to the model, so a follow-up has context', async () => {
    const captured = gatewayCapturingMessages();
    const deps = { prisma, gateway: captured.gateway, cap, embedder: null };

    const conversationId = conversationIdOf(await ask(deps, 'harga kek?'));
    await ask(deps, 'ada delivery?', conversationId);

    // Without history the model answers "ada delivery?" with no idea what
    // "delivery" refers to.
    expect(captured.messages().map((m) => m.content)).toEqual([
      'harga kek?',
      'an answer',
      'ada delivery?',
    ]);
  });

  it('bounds the history it sends, so a long thread cannot grow the prompt forever', async () => {
    const captured = gatewayCapturingMessages();
    const deps = { prisma, gateway: captured.gateway, cap, embedder: null };

    const conversationId = conversationIdOf(await ask(deps, 'q0'));
    for (let i = 1; i <= 8; i += 1) await ask(deps, `q${i}`, conversationId);

    expect(captured.messages().length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    // The newest turn is always present; it is the oldest that falls off.
    expect(captured.messages().at(-1)?.content).toBe('q8');
  });

  it('logs the question a visitor asked', async () => {
    await ask(depsSaying(), 'berapa harga kek butter?');

    const question = await prisma.question.findFirstOrThrow({});
    // Verbatim, not normalised: the owner should read what a customer typed.
    expect(question.text).toBe('berapa harga kek butter?');
    expect(question.askCount).toBe(1);
    const topic = await prisma.topic.findUniqueOrThrow({ where: { id: question.topicId } });
    expect(topic.answer).toBeNull();
  });

  it('keeps the wording without a number or email typed into it, while the message keeps them', async () => {
    await ask(depsSaying(), 'boleh hantar? wasap 012-345 6789 atau aina@gmail.com');

    const question = await prisma.question.findFirstOrThrow({});
    expect(question.text).toBe('boleh hantar? wasap [removed] atau [removed]');
    const topic = await prisma.topic.findUniqueOrThrow({ where: { id: question.topicId } });
    expect(topic.title).toBe('boleh hantar? wasap [removed] atau [removed]');
    const message = await prisma.message.findFirstOrThrow({ where: { role: 'USER' } });
    expect(message.content).toBe('boleh hantar? wasap 012-345 6789 atau aina@gmail.com');
  });

  it('counts two phrasings of one question as one question', async () => {
    // The whole point of clustering. normalizeClaim strips punctuation and
    // case, so these are the same row -- and the count is what tells an owner
    // this is a real gap rather than one person being curious.
    const deps = depsSaying();
    await ask(deps, 'Berapa harga kek butter?');
    await ask(deps, 'berapa harga kek butter');

    const questions = await prisma.question.findMany({});
    expect(questions).toHaveLength(1);
    expect(questions[0]?.askCount).toBe(2);
  });

  it('logs when each ask happened, new wording or repeat, for the week of asks', async () => {
    const deps = depsSaying();
    const before = new Date();
    await ask(deps, 'Berapa harga kek butter?');
    await ask(deps, 'berapa harga kek butter');

    const question = await prisma.question.findFirstOrThrow({});
    const asks = await prisma.questionAsk.findMany({ where: { questionId: question.id } });
    expect(asks).toHaveLength(2);
    expect(asks.every((a) => a.askedAt >= before)).toBe(true);
  });

  it('records whether the chat could answer each ask, for "Of asks the chat can answer"', async () => {
    await ask(depsSaying('Kek butter 1kg RM95.'), 'Berapa harga kek butter?');
    await ask(depsSaying('[?] Tak pasti, saya akan tanya Nadia.'), 'Ada delivery ke Klang?');
    await seedNadiaPrice();
    await ask(depsSaying('unused'), 'Berapa harga?');

    const answered = async (text: string) =>
      (await prisma.questionAsk.findFirstOrThrow({ where: { question: { text } }, select: { answered: true } })).answered;
    expect(await answered('Berapa harga kek butter?')).toBe(true);
    expect(await answered('Ada delivery ke Klang?')).toBe(false);
    // The owner's own answer is an answer.
    expect(await answered('Berapa harga?')).toBe(true);
  });

  it("keeps the model's reply on the ask, as the visitor saw it, and none for the owner's answer", async () => {
    await ask(depsSaying('Kek butter 1kg RM95.'), 'Berapa harga kek butter?');
    await ask(depsSaying('[?] Tak pasti, saya akan tanya Nadia.'), 'Ada delivery ke Klang?');
    await seedNadiaPrice();
    await ask(depsSaying('unused'), 'Berapa harga?');

    const reply = async (text: string) =>
      (await prisma.questionAsk.findFirstOrThrow({ where: { question: { text } }, select: { reply: true } })).reply;
    expect(await reply('Berapa harga kek butter?')).toBe('Kek butter 1kg RM95.');
    // Without the marker the visitor never saw.
    expect(await reply('Ada delivery ke Klang?')).toBe('Tak pasti, saya akan tanya Nadia.');
    // The owner wrote that one; it says nothing about what the chat can answer on its own.
    expect(await reply('Berapa harga?')).toBeNull();
  });

  it('never lets a visitor see the not-sure marker, in the stream or the stored reply', async () => {
    const events = await ask(depsSaying('[?] Tak pasti, saya akan tanya Nadia.'), 'Ada delivery ke Klang?');

    const said = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
    expect(said).toBe('Tak pasti, saya akan tanya Nadia.');
    const stored = await prisma.message.findFirstOrThrow({ where: { role: 'ASSISTANT' }, orderBy: { createdAt: 'desc' } });
    expect(stored.content).toBe('Tak pasti, saya akan tanya Nadia.');
  });

  it('keeps genuinely different questions apart', async () => {
    const deps = depsSaying();
    await ask(deps, 'berapa harga kek butter?');
    await ask(deps, 'buka pukul berapa?');

    expect(await prisma.question.count()).toBe(2);
  });

  it('counts across conversations, not just within one', async () => {
    // Two visitors on different days asking the same thing is the signal.
    // Counting only within a conversation would report every gap as askCount 1.
    const deps = depsSaying();
    await ask(deps, 'ada delivery?');
    await ask(deps, 'ada delivery?');

    const question = await prisma.question.findFirstOrThrow({});
    expect(question.askCount).toBe(2);
    expect(await prisma.conversation.count()).toBe(2);
  });

  it('counts a question the topic answer handled, too', async () => {
    // This file's fixture already answers "Berapa harga?", so this ask never
    // reaches the model. The wording still has to count, or a question would
    // drop off the screen the moment it got popular enough to be answered.
    await seedNadiaPrice();
    await ask(depsSaying(), 'berapa harga?');

    const question = await prisma.question.findFirstOrThrow({
      where: { normalizedQuestion: 'berapa harga' },
    });
    expect(question.askCount).toBe(2);
    // The first phrasing wins and is never overwritten.
    expect(question.text).toBe('Berapa harga?');
    const topic = await prisma.topic.findUniqueOrThrow({ where: { id: question.topicId } });
    expect(topic.askCount).toBe(2);
  });

  it('keeps the questions of one page out of another', async () => {
    // Same normalised text, two pages, two rows. The unique index is on the
    // pair; a global one would merge every shop's questions into one list.
    const other = await prisma.account.create({
      data: {
        email: 'other@example.com',
        pages: {
          create: { handle: 'someoneelse', skeleton: 'someoneelse', displayName: 'Other', published: true },
        },
      },
    });

    await ask(depsSaying(), 'ada delivery?');
    await collect(answer(depsSaying(), { handle: 'someoneelse', question: 'ada delivery?' }));

    expect(await prisma.question.count({ where: { normalizedQuestion: 'ada delivery' } })).toBe(2);
    expect(other.id).toBeTruthy();
  });

  it('refuses a conversation belonging to another page', async () => {
    // A conversation id is a bearer token for a thread. Without the page
    // scope, one page's visitor could append to another page's conversation
    // and read its answers back.
    const other = await prisma.account.create({
      data: {
        email: 'other@example.com',
        pages: {
          create: { handle: 'someoneelse', skeleton: 'someoneelse', displayName: 'Other', published: true },
        },
      },
      include: { pages: true },
    });
    const theirs = await prisma.conversation.create({
      data: { pageId: other.pages[0]?.id ?? '' },
    });

    await expect(ask(depsSaying(), 'hi', theirs.id)).rejects.toMatchObject({
      code: 'CONVERSATION_NOT_FOUND',
    });
  });

  it('does not offer capture on the first turn', async () => {
    const events = await ask(depsSaying(), 'nak order 2kg');
    expect(events.find((e) => e.type === 'done')).toMatchObject({
      intent: { qualified: false },
    });
  });

  it('offers capture on the first turn to a visitor who asks to leave their number', async () => {
    const events = await ask(depsSaying(), 'Can I left my number here');
    expect(events.find((e) => e.type === 'done')).toMatchObject({ intent: { qualified: true } });
  });

  it('never repeats a phone number from a fact, and keeps the rest of the reply', async () => {
    const events = await ask(depsSaying('You can reach Nadia at +60 11-2953 9716. Or ask here.'), 'how can I contact nadia');
    const streamed = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');
    expect(streamed).toBe('Or ask here.');
  });

  it('offers capture once the conversation is three specific turns deep', async () => {
    const deps = depsSaying();
    const conversationId = conversationIdOf(await ask(deps, 'ada kek butter?'));
    await ask(deps, 'yang 2kg', conversationId);
    const third = await ask(deps, 'hantar ke Klang 20 Mac boleh?', conversationId);

    expect(third.find((e) => e.type === 'done')).toMatchObject({ intent: { qualified: true } });
  });

  it('never offers capture on a personal page', async () => {
    // The mode gate, asserted through the service rather than the pure
    // function, because this is where a page's mode is actually read.
    await prisma.page.updateMany({ where: { handle: 'nadia' }, data: { mode: 'PERSONAL' } });
    const deps = depsSaying();
    const conversationId = conversationIdOf(await ask(deps, 'nak 2kg'));
    await ask(deps, 'untuk 20 Mac', conversationId);
    const third = await ask(deps, 'hantar ke Klang?', conversationId);

    expect(third.find((e) => e.type === 'done')).toMatchObject({ intent: { qualified: false } });
  });

  it('counts only the visitor turns, not the answers', async () => {
    // Six messages, three of them the assistant's, and the assistant is the
    // one saying "RM160". If the answers were counted this would qualify, and
    // so would every conversation on the page.
    const deps = depsSaying('Kek butter 2kg RM160.');
    const conversationId = conversationIdOf(await ask(deps, 'hai'));
    await ask(deps, 'ada apa', conversationId);
    const third = await ask(deps, 'ok', conversationId);

    expect(third.find((e) => e.type === 'done')).toMatchObject({ intent: { qualified: false } });
  });

  it('refuses a conversation id that does not exist', async () => {
    await expect(ask(depsSaying(), 'hi', 'nope')).rejects.toMatchObject({
      code: 'CONVERSATION_NOT_FOUND',
    });
  });
});

describe('faq slug assignment', () => {
  it('assigns a faq slug when a third ask is the last condition to arrive', async () => {
    // The site this task adds to chat.service.ts. A question already answered
    // while it had two asks qualifies right here, on its third, with no owner
    // involved -- see faq-slug.ts on why the writeback alone is not enough.
    const pageId = await pageIdFor('nadia');
    const topic = await seedTopic(pageId, {
      answer: 'RM80.',
      wordings: [{ text: 'Berapa harga kek coklat?', askCount: 2 }],
    });

    await collect(
      answer(
        { prisma, gateway: gatewaySaying('unused'), cap, embedder: null },
        { handle: 'nadia', question: 'Berapa harga kek coklat?' },
      ),
    );

    const after = await prisma.topic.findUniqueOrThrow({ where: { id: topic.id } });
    expect(after.askCount).toBe(3);
    expect(after.faqSlug).toBe('berapa-harga-kek-coklat');
  });
});

describe('an erased question, asked again', () => {
  it('comes back as a stranger: no answer, no slug, and the model answers it', async () => {
    // Right-to-erasure only means something if it survives the next customer.
    // The chat path upserts questions by normalised text, so an erased row
    // returns the moment somebody asks the same thing -- which is fine, as long
    // as it returns as a stranger. The answer is the part that matters: chat
    // serves a topic's answer ahead of the model, so one left behind by an
    // incomplete erasure puts the erased words straight back in front of the
    // very next visitor.
    const page = await prisma.page.findFirstOrThrow({
      where: { handle: 'nadia' },
      select: { id: true, accountId: true },
    });
    const text = 'Berapa harga kek coklat?';
    const normalizedQuestion = 'berapa harga kek coklat';
    const topic = await seedTopic(page.id, {
      answer: 'RM80. WhatsApp saya terus di 0123456789.',
      wordings: [{ text, askCount: 3 }],
    });
    await prisma.topic.update({ where: { id: topic.id }, data: { faqSlug: 'berapa-harga-kek-coklat' } });
    const erased = await prisma.question.findFirstOrThrow({
      where: { topicId: topic.id },
      select: { id: true },
    });

    // The topic's only wording: erasing it takes the topic and its answer too.
    await deleteWording(prisma, page.accountId, erased.id);
    expect(await prisma.topic.count({ where: { id: topic.id } })).toBe(0);

    const events = await collect(
      answer(
        { prisma, gateway: gatewaySaying('A model answer.'), cap, embedder: null },
        { handle: 'nadia', question: text },
      ),
    );
    const reply = events
      .filter((event) => event.type === 'text')
      .map((event) => event.text ?? '')
      .join('');

    // The model answered, not the erased owner text.
    expect(reply).toBe('A model answer.');

    const back = await prisma.question.findUniqueOrThrow({
      where: { pageId_normalizedQuestion: { pageId: page.id, normalizedQuestion } },
      include: { topic: true },
    });
    expect(back.id).not.toBe(erased.id);
    expect(back.topicId).not.toBe(topic.id);
    expect(back.askCount).toBe(1);
    expect(back.topic.answer).toBeNull();
    // Retired with the old topic, never reissued; and one ask is not enough anyway.
    expect(back.topic.faqSlug).toBeNull();
  });
});

describe('the monthly cap', () => {
  /**
   * Puts the page at `count` conversations for the current period, without
   * driving that many chats. The period key is `YYYY-MM`, which is what
   * `currentPeriod()` in @curios/core (period.ts) produces.
   */
  async function usageAt(count: number) {
    const page = await prisma.page.findUniqueOrThrow({
      where: { handle: 'nadia' },
      select: { id: true },
    });
    const period = new Date().toISOString().slice(0, 7);
    await prisma.usageCounter.upsert({
      where: { pageId_period: { pageId: page.id, period } },
      create: { pageId: page.id, period, count },
      update: { count },
    });
    return page.id;
  }

  const chatSpyGateway = () => {
    const gateway = gatewaySaying('a model answer');
    const spy = vi.spyOn(gateway, 'chat');
    return { gateway, spy };
  };

  it('answers normally below the cap', async () => {
    await usageAt(10);
    const { gateway, spy } = chatSpyGateway();

    const events = await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga?' }));

    expect(spy).toHaveBeenCalled();
    expect(events.some((e) => e.type === 'text' && e.text === 'a model answer')).toBe(true);
  });

  it('spends nothing at all once over the cap', async () => {
    // Asserted against the gateway, not against the reply text. A test that
    // only checked the words would pass against an implementation that called
    // the model and then threw the answer away -- which is the expensive
    // version of this feature.
    await usageAt(500);
    const { gateway, spy } = chatSpyGateway();

    const events = await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga?' }));

    expect(spy).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('still serves a topic answer over the cap, because it costs nothing', async () => {
    // The argument of this slice. BACKEND.md checked the cap above the answered
    // branch; a topic answer makes no model call, so refusing it punishes an
    // owner for having answered the question well.
    const pageId = await usageAt(500);
    await seedTopic(pageId, { answer: 'RM95 sekilo.', wordings: [{ text: 'harga' }] });
    const { gateway, spy } = chatSpyGateway();

    const events = await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga' }));

    expect(spy).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'text' && e.text === 'RM95 sekilo.')).toBe(true);
  });

  it('refuses the second turn of a conversation that began over the cap', async () => {
    // The hole that gating on `isNew` would open. The counter only increments
    // when a conversation is created, so a check that ran only there would
    // refuse turn one and then hand turn two to the model for free.
    await usageAt(500);
    const { gateway, spy } = chatSpyGateway();

    const first = await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'one' }));
    const done = first.find((e) => e.type === 'done');
    const conversationId = (done as { conversationId?: string } | undefined)?.conversationId;
    expect(conversationId).toBeTruthy();

    await collect(
      answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'two', conversationId }),
    );

    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps counting while refusing, because refused demand is the data', async () => {
    // A page recorded as 200 forever says nothing about what a paid tier
    // should cost. A page sitting at 340 in a 200 cap is the argument.
    const pageId = await usageAt(500);
    const { gateway } = chatSpyGateway();

    await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga?' }));

    // findUnique on the exact key usageAt() wrote, not findFirst: this is the
    // only assertion in the file that reads UsageCounter back by pageId
    // alone, and findFirst would pass or fail at random if the write key ever
    // diverged from this read key -- two rows for the page would make it
    // ambiguous which one "first" means.
    const period = new Date().toISOString().slice(0, 7);
    const counter = await prisma.usageCounter.findUniqueOrThrow({
      where: { pageId_period: { pageId, period } },
    });
    expect(counter.count).toBe(501);
  });

  it('emails the owner once a month when the limit is reached, and never twice', async () => {
    await usageAt(500);
    const { gateway } = chatSpyGateway();
    const mailQueue = { add: vi.fn(async (_name: string, _data: { subject: string; html?: string }, _opts?: unknown) => ({})) };

    await collect(answer({ prisma, gateway, cap, embedder: null, mailQueue }, { handle: 'nadia', question: 'harga?' }));
    await collect(answer({ prisma, gateway, cap, embedder: null, mailQueue }, { handle: 'nadia', question: 'ada delivery?' }));

    expect(mailQueue.add).toHaveBeenCalledTimes(1);
    const mail = mailQueue.add.mock.calls[0]?.[1];
    expect(mail?.subject).toBe('Your page reached its monthly limit');
    expect(mail?.html).toContain('Limit reached');
  });

  it('answers in Malay first, then English, and persists that reply as an assistant message', async () => {
    // #4/#5 of the fix wave: the degraded reply used to be English-only,
    // contradicting prompt.ts's own rule that the model answers in the
    // language it was asked in -- and it promised a most-asked-questions
    // link that a page over cap need not have. Pinning the exact text here is
    // what makes either regression a broken test rather than a silent one.
    await usageAt(500);
    const { gateway, spy } = chatSpyGateway();

    const events = await collect(
      answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'Berapa harga kek?' }),
    );

    expect(spy).not.toHaveBeenCalled();
    const text = events
      .filter((e) => e.type === 'text')
      .map((e) => e.text)
      .join('');
    expect(text).toBe(CAP_REACHED_REPLY);
    // Malay first, then English, not the other way around.
    expect(text.indexOf('Kami dah jawab')).toBeLessThan(text.indexOf('We’ve answered'));

    const assistantMessage = await prisma.message.findFirstOrThrow({
      where: { role: 'ASSISTANT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(assistantMessage.content).toBe(CAP_REACHED_REPLY);
  });
});

describe('the shop in the chat path', () => {
  async function seedShelf(storeEnabled: boolean, mode: 'BUSINESS' | 'PERSONAL' = 'BUSINESS') {
    const pageId = await pageIdFor('nadia');
    await prisma.page.update({ where: { id: pageId }, data: { storeEnabled, mode } });
    await prisma.item.create({
      data: { pageId, name: 'Kek Batik', slug: 'kek-batik', priceCents: 2500, position: 1, available: true },
    });
    await prisma.item.create({
      data: { pageId, name: 'Hidden Tart', slug: 'hidden-tart', priceCents: 900, position: 0, available: false },
    });
  }

  it('sends an available item and not an unavailable one while the shop is open', async () => {
    await seedShelf(true);
    const { gateway, prompt } = gatewayCapturingPrompt();
    await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga kek' }));

    expect(prompt()).toContain('<item name="Kek Batik">RM25</item>');
    expect(prompt()).not.toContain('Hidden Tart');
  });

  it('sends no SHOP while the shop is closed', async () => {
    await seedShelf(false);
    const { gateway, prompt } = gatewayCapturingPrompt();
    await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga kek' }));

    expect(prompt()).not.toContain('SHOP');
    expect(prompt()).not.toContain('Kek Batik');
  });

  it('sends no SHOP on a personal page, even with items and an open flag', async () => {
    await seedShelf(true, 'PERSONAL');
    const { gateway, prompt } = gatewayCapturingPrompt();
    await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga kek' }));

    expect(prompt()).not.toContain('SHOP');
  });
});

describe('retrieval in the chat path', () => {
  it('sends every fact on a small page, and caches the prompt', async () => {
    const captured = gatewayCapturingCall();

    await collect(
      answer(
        { prisma, gateway: captured.gateway, cap, embedder: embedderAnswering().embedder },
        { handle: 'nadia', question: 'harga kek' },
      ),
    );

    // The fixture page has two facts, far under RETRIEVAL_MIN_FACTS.
    expect(captured.call().systemPrompt).toContain('Kek 1kg butter starts at RM95');
    expect(captured.call().cachePrompt).toBe(true);
  });

  it('sends a chosen few on a large page, and does not cache the prompt', async () => {
    const pageId = await seedLargePage(); // RETRIEVAL_MIN_FACTS + 5 facts, all with vectors
    const captured = gatewayCapturingCall();

    await collect(
      answer(
        { prisma, gateway: captured.gateway, cap, embedder: embedderAnswering().embedder },
        { handle: 'katalog', question: 'berapa harga' },
      ),
    );

    const prompt = captured.call().systemPrompt;
    expect(prompt.match(/<fact /g)?.length).toBeLessThan(RETRIEVAL_MIN_FACTS + 5);
    expect(captured.call().cachePrompt).toBe(false);
    expect(pageId).toBeTruthy();
  });

  it('records only the facts it sent', async () => {
    await seedLargePage();
    const captured = gatewayCapturingCall();

    await collect(
      answer(
        { prisma, gateway: captured.gateway, cap, embedder: embedderAnswering().embedder },
        { handle: 'katalog', question: 'berapa harga' },
      ),
    );

    const message = await prisma.message.findFirstOrThrow({
      where: { role: 'ASSISTANT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(message.citedFactIds.length).toBeLessThan(RETRIEVAL_MIN_FACTS + 5);
  });

  it('answers from every fact when the embedder is down', async () => {
    await seedLargePage();
    const captured = gatewayCapturingCall();
    const failing: Embedder = {
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      embed: async () => {
        throw new Error('provider unavailable');
      },
    };

    const events = await collect(
      answer(
        { prisma, gateway: captured.gateway, cap, embedder: failing },
        { handle: 'katalog', question: 'berapa harga' },
      ),
    );

    expect(events.some((event) => event.type === 'text')).toBe(true);
    expect(captured.call().systemPrompt.match(/<fact /g)?.length).toBe(RETRIEVAL_MIN_FACTS + 5);
    expect(captured.call().cachePrompt).toBe(true);
  });

  // Step 9's own mutation table flags this exact mutant: `.at(-2)` for the
  // previous turn mutated to `.at(-1)` survives every test above, because
  // none of them drives two turns of one conversation while also asserting on
  // what was actually embedded for the second. This one does both: `.at(-1)`
  // would hand the second turn its OWN question as "the previous turn",
  // embedding it twice instead of carrying the first question as context.
  it('embeds the first turn as context on a follow-up, not the follow-up question twice', async () => {
    await seedLargePage();
    const { embedder, embed } = embedderAnswering();

    const first = await collect(
      answer(
        { prisma, gateway: gatewaySaying('answer one'), cap, embedder },
        { handle: 'katalog', question: 'berapa harga kek' },
      ),
    );
    const done = first.find((event) => event.type === 'done') as
      | { conversationId?: string }
      | undefined;
    const conversationId = done?.conversationId;
    expect(conversationId).toBeTruthy();

    await collect(
      answer(
        { prisma, gateway: gatewaySaying('answer two'), cap, embedder },
        { handle: 'katalog', question: 'yang coklat pula?', conversationId },
      ),
    );

    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed.mock.calls[1]?.[0]).toEqual(['berapa harga kek\nyang coklat pula?']);
  });

  // A gap the brief's own Step 9 table missed: nothing in this file asserted
  // that chat.service.ts actually threads its own `log` through to
  // selectForQuestion. retrieval.test.ts already proves retrieval.ts logs
  // correctly when it IS given a logger; without this test, deleting `log:
  // deps.log` from the selectForQuestion call here would make every chosen
  // few, floor miss and fallback invisible in production logs, with every
  // other test in this file still green.
  it('passes its own logger through to retrieval, so a decision is visible in the log', async () => {
    await seedLargePage();
    const info = vi.fn();

    await collect(
      answer(
        {
          prisma,
          gateway: gatewaySaying('ok'),
          cap,
          embedder: embedderAnswering().embedder,
          log: { error: vi.fn(), info },
        },
        { handle: 'katalog', question: 'berapa harga' },
      ),
    );

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ mode: expect.any(String) }),
      'chat retrieval',
    );
  });

  it('a topic answer still costs nothing, whatever retrieval would have done', async () => {
    await seedLargePage();
    const { embedder, embed } = embedderAnswering();
    await seedTopic(await pageIdFor('katalog'), {
      answer: 'Bermula RM95.',
      wordings: [{ text: 'berapa harga' }],
    });

    const events = await collect(
      answer(
        { prisma, gateway: gatewaySaying('unused'), cap, embedder },
        { handle: 'katalog', question: 'berapa harga' },
      ),
    );

    expect(events[0]).toMatchObject({ type: 'text', text: 'Bermula RM95.' });
    expect(embed).not.toHaveBeenCalled();
  });
});

describe('topics in the chat', () => {
  function queueSpy() {
    return { add: vi.fn(async () => undefined) };
  }

  it('a new wording gets its own topic and queues exactly one grouping job, after the reply', async () => {
    const order: string[] = [];
    const groupQueue = {
      add: vi.fn(async () => {
        order.push('queued');
      }),
    };

    for await (const event of answer(
      { prisma, gateway: gatewaySaying('Dia pemilik.'), cap, embedder: null, groupQueue },
      { handle: 'nadia', question: 'Who is Iman' },
    )) {
      order.push(event.type);
    }

    const questions = await prisma.question.findMany({});
    const topics = await prisma.topic.findMany({});
    expect(questions).toHaveLength(1);
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ title: 'Who is Iman', askCount: 1 });
    expect(questions[0]?.topicId).toBe(topics[0]?.id);
    expect(groupQueue.add).toHaveBeenCalledTimes(1);
    expect(groupQueue.add).toHaveBeenCalledWith(
      GROUP_QUEUE,
      { questionId: questions[0]?.id },
      expect.objectContaining({
        jobId: questions[0]?.id,
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 3600 },
      }),
    );
    // The reply is complete before the job is queued.
    expect(order.at(-1)).toBe('queued');
    expect(order.indexOf('done')).toBeGreaterThan(-1);
    expect(order.indexOf('done')).toBeLessThan(order.indexOf('queued'));
  });

  it('a repeat of a known wording, whatever its capitals or punctuation, queues nothing and counts on its topic', async () => {
    const groupQueue = queueSpy();
    const deps = { prisma, gateway: gatewaySaying('Iman Muqri'), cap, embedder: null, groupQueue };

    await collect(answer(deps, { handle: 'nadia', question: 'What is his full name' }));
    await collect(answer(deps, { handle: 'nadia', question: 'WHAT is his full name??' }));

    const questions = await prisma.question.findMany({});
    expect(questions).toHaveLength(1);
    expect(questions[0]?.askCount).toBe(2);
    const topic = await prisma.topic.findUniqueOrThrow({ where: { id: questions[0]?.topicId ?? '' } });
    expect(topic.askCount).toBe(2);
    expect(groupQueue.add).toHaveBeenCalledTimes(1);
  });

  it('a repeat whose topic is answered streams the answer and still queues nothing', async () => {
    const groupQueue = queueSpy();
    await seedTopic(await pageIdFor('nadia'), {
      answer: 'Iman Muqri',
      wordings: [{ text: 'What is his full name' }],
    });

    const events = await collect(
      answer(
        { prisma, gateway: gatewaySaying('unused'), cap, embedder: null, groupQueue },
        { handle: 'nadia', question: 'WHAT is his full name??' },
      ),
    );

    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Iman Muqri');
    expect(groupQueue.add).not.toHaveBeenCalled();
  });

  it("streams the topic's answer word for word for any grouped wording", async () => {
    const gateway = gatewaySaying('should not be used');
    const chatSpy = vi.spyOn(gateway, 'chat');
    await seedTopic(await pageIdFor('nadia'), {
      answer: 'Iman Muqri',
      wordings: [{ text: "What is Iman's full name" }, { text: 'What is his full name' }],
    });

    const events = await collect(
      answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'what is his full name' }),
    );

    expect(events.filter((e) => e.type === 'text').map((e) => e.text)).toEqual(['Iman Muqri']);
    expect(chatSpy).not.toHaveBeenCalled();
    const topic = await prisma.topic.findFirstOrThrow({});
    expect(topic.askCount).toBe(3);
  });

  it('an unanswered topic goes to the model', async () => {
    const gateway = gatewaySaying('Dari model.');
    const chatSpy = vi.spyOn(gateway, 'chat');
    await seedTopic(await pageIdFor('nadia'), { wordings: [{ text: 'What is his full name' }] });

    const events = await collect(
      answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'what is his full name' }),
    );

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Dari model.');
  });

  it('queues after the reply on the model path and the cap path too', async () => {
    const groupQueue = queueSpy();
    const deps = { prisma, gateway: gatewaySaying('x'), cap, embedder: null, groupQueue };
    await collect(answer(deps, { handle: 'nadia', question: 'one' }));
    expect(groupQueue.add).toHaveBeenCalledTimes(1);

    const pageId = await pageIdFor('nadia');
    const period = new Date().toISOString().slice(0, 7);
    await prisma.usageCounter.upsert({
      where: { pageId_period: { pageId, period } },
      create: { pageId, period, count: 500 },
      update: { count: 500 },
    });
    const events = await collect(answer(deps, { handle: 'nadia', question: 'two' }));

    expect(events.some((e) => e.type === 'text' && e.text === CAP_REACHED_REPLY)).toBe(true);
    expect(groupQueue.add).toHaveBeenCalledTimes(2);
  });

  it('a failure to queue the job is logged, never thrown at the visitor', async () => {
    const groupQueue = { add: vi.fn(async () => Promise.reject(new Error('redis down'))) };
    const warn = vi.fn();

    const events = await collect(
      answer(
        { prisma, gateway: gatewaySaying('Masih jawab.'), cap, embedder: null, groupQueue, log: { error: vi.fn(), warn } },
        { handle: 'nadia', question: 'Who is Iman' },
      ),
    );

    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'redis down' }),
      'could not queue grouping',
    );
  });

  it('without a groupQueue, a new wording still answers and keeps its own topic', async () => {
    await collect(answer({ prisma, gateway: gatewaySaying('ok'), cap, embedder: null }, { handle: 'nadia', question: 'Who is Iman' }));
    expect(await prisma.topic.count()).toBe(1);
  });

  it('still queues a new wording when the model fails mid-answer', async () => {
    const groupQueue = queueSpy();

    await expect(
      collect(
        answer(
          { prisma, gateway: gatewayThatFails(), cap, embedder: null, groupQueue },
          { handle: 'nadia', question: 'Who is Iman' },
        ),
      ),
    ).rejects.toThrow('provider unavailable');

    expect(groupQueue.add).toHaveBeenCalledTimes(1);
  });

  it('two first asks of one new wording make one wording and one topic', async () => {
    const groupQueue = queueSpy();
    const deps = { prisma, gateway: gatewaySaying('ok'), cap, embedder: null, groupQueue };

    await Promise.all([
      collect(answer(deps, { handle: 'nadia', question: 'Who is Iman' })),
      collect(answer(deps, { handle: 'nadia', question: 'Who is Iman' })),
    ]);

    const questions = await prisma.question.findMany({});
    expect(questions).toHaveLength(1);
    expect(questions[0]?.askCount).toBe(2);
    const topics = await prisma.topic.findMany({});
    expect(topics).toHaveLength(1);
    expect(topics[0]?.askCount).toBe(2);
    expect(groupQueue.add).toHaveBeenCalledTimes(1);
  });

  it("a repeat that waits on the grouping job's lock counts on, and answers from, the topic the job moved it to", async () => {
    const pageId = await pageIdFor('nadia');
    const from = await seedTopic(pageId, { wordings: [{ text: 'What is his full name' }] });
    const into = await seedTopic(pageId, { answer: 'Iman Muqri', wordings: [{ text: 'Who is Iman', askCount: 2 }] });
    const wordingId = (await prisma.question.findFirstOrThrow({ where: { topicId: from.id } })).id;

    const jobClient = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const lockedDone = new Promise<void>((resolve) => (locked = resolve));

      // What the grouping job does: lock the wording, move it, merge-empty its old topic.
      const job = jobClient.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Question" WHERE "id" = ${wordingId} FOR UPDATE`;
        await tx.question.update({ where: { id: wordingId }, data: { topicId: into.id } });
        await refreshTopic(tx, into.id);
        await refreshTopic(tx, from.id);
        locked();
        await gate;
      });
      await lockedDone;

      const ask = collect(
        answer(
          { prisma, gateway: gatewaySaying('unused'), cap, embedder: null },
          { handle: 'nadia', question: 'what is his full name' },
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 400)); // let the ask reach its wait on the row
      release();
      const [events] = await Promise.all([ask, job]);

      expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Iman Muqri');
      const survivor = await prisma.topic.findUniqueOrThrow({ where: { id: into.id } });
      const sum = await prisma.question.aggregate({ where: { topicId: into.id }, _sum: { askCount: true } });
      expect(survivor.askCount).toBe(sum._sum.askCount);
      expect(survivor.askCount).toBe(4);
    } finally {
      await jobClient.$disconnect();
    }
  });
});


describe('an answered question, asked in new words', () => {
  const usage = { inputTokens: 300, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };

  /** An embedder that gives each text the axis named for it (axis 0 when unnamed). */
  function embedderFor(axes: Record<string, number>): Embedder {
    return {
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      embed: vi.fn(async (texts: string[]) => texts.map((t) => axis(axes[t] ?? 0))),
    };
  }

  /** A gateway whose judge answers as told, and whose chat says `reply` (or must not be called). */
  function gatewayJudging(verdict: 'first' | 'none' | 'throws', reply?: string) {
    const sameQuestion = vi.fn(async (input: { candidates: { id: string }[] }) => {
      if (verdict === 'throws') throw new Error('provider unavailable');
      return {
        match: verdict === 'first' ? (input.candidates[0]?.id ?? null) : null,
        usage,
        model: 'claude-haiku-4-5',
        latencyMs: 300,
      };
    });
    const chat = vi.fn(async function* () {
      if (reply === undefined) throw new Error('chat must not be called');
      yield { type: 'text' as const, text: reply };
      yield { type: 'done' as const, usage, model: 'claude-haiku-4-5', latencyMs: 700 };
    });
    const gateway: Gateway = { extract: vi.fn(), slots: vi.fn(), sameQuestion, chat };
    return { gateway, sameQuestion, chat };
  }

  const queue = () => ({ add: vi.fn(async () => undefined) });
  const textOf = (events: { type: string; text?: string }[]) =>
    events.filter((e) => e.type === 'text').map((e) => e.text).join('');

  // The bug the owner saw: "What's his age" asked after "What's is his age"
  // was answered got "I'm not sure", and only after the reply did the
  // grouping job fold it in.
  it("gets the owner's answer on its first ask, joins the answered topic decided, and queues nothing", async () => {
    const topic = await seedTopic(await pageIdFor('nadia'), { answer: '25 in 2026', wordings: [{ text: "What's is his age" }] });
    const { gateway, sameQuestion, chat } = gatewayJudging('first');
    const groupQueue = queue();

    const events = await collect(
      answer({ prisma, gateway, cap, embedder: embedderFor({}), groupQueue }, { handle: 'nadia', question: "What's his age" }),
    );

    expect(textOf(events)).toBe('25 in 2026');
    expect(chat).not.toHaveBeenCalled();
    expect(sameQuestion).toHaveBeenCalledTimes(1);
    const joined = await prisma.question.findFirstOrThrow({ where: { text: "What's his age" } });
    expect(joined.topicId).toBe(topic.id);
    expect(joined.groupedAt).not.toBeNull();
    expect(await prisma.topic.count()).toBe(1);
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: topic.id } })).askCount).toBe(2);
    expect(groupQueue.add).not.toHaveBeenCalled();
    // The judge's call is paid for like any other.
    expect(await prisma.modelCall.count({ where: { ok: true } })).toBe(1);
  });

  it('answers as a new question, grouped after the reply as before, when the judge says it is a different one', async () => {
    await seedTopic(await pageIdFor('nadia'), { answer: '25 in 2026', wordings: [{ text: "What's is his age" }] });
    const { gateway } = gatewayJudging('none', 'Tak pasti.');
    const groupQueue = queue();

    const events = await collect(
      answer({ prisma, gateway, cap, embedder: embedderFor({}), groupQueue }, { handle: 'nadia', question: 'Is he married' }),
    );

    expect(textOf(events)).toBe('Tak pasti.');
    expect(await prisma.topic.count()).toBe(2);
    expect(groupQueue.add).toHaveBeenCalledTimes(1);
  });

  it('never fails the visitor when the judge fails: the reply comes from chat and the failure is recorded', async () => {
    await seedTopic(await pageIdFor('nadia'), { answer: '25 in 2026', wordings: [{ text: "What's is his age" }] });
    const { gateway } = gatewayJudging('throws', 'Tak pasti.');
    const groupQueue = queue();

    const events = await collect(
      answer({ prisma, gateway, cap, embedder: embedderFor({}), groupQueue }, { handle: 'nadia', question: "What's his age" }),
    );

    expect(textOf(events)).toBe('Tak pasti.');
    expect(await prisma.modelCall.count({ where: { ok: false, errorCode: 'PROVIDER_UNAVAILABLE' } })).toBe(1);
    expect(groupQueue.add).toHaveBeenCalledTimes(1);
  });

  it('asks the judge nothing when no answered wording is close', async () => {
    await seedTopic(await pageIdFor('nadia'), { answer: '25 in 2026', wordings: [{ text: "What's is his age" }] });
    const { gateway, sameQuestion } = gatewayJudging('first', 'Ada.');

    await collect(
      answer(
        { prisma, gateway, cap, embedder: embedderFor({ "What's is his age": 1, 'Ada delivery?': 2 }), groupQueue: queue() },
        { handle: 'nadia', question: 'Ada delivery?' },
      ),
    );

    expect(sameQuestion).not.toHaveBeenCalled();
  });

  it('only ever offers answered topics: an unanswered one is left to the grouping job', async () => {
    await seedTopic(await pageIdFor('nadia'), { wordings: [{ text: "What's is his age" }] });
    const { gateway, sameQuestion } = gatewayJudging('first', 'Tak pasti.');

    await collect(
      answer({ prisma, gateway, cap, embedder: embedderFor({}), groupQueue: queue() }, { handle: 'nadia', question: "What's his age" }),
    );

    expect(sameQuestion).not.toHaveBeenCalled();
  });

  it("shows the model the owner's answers, for phrasings the judge was not asked about", async () => {
    await seedTopic(await pageIdFor('nadia'), { answer: '25 in 2026', wordings: [{ text: "What's is his age" }] });
    const captured = gatewayCapturingPrompt();

    await collect(answer({ prisma, gateway: captured.gateway, cap, embedder: null }, { handle: 'nadia', question: 'How old is he' }));

    expect(captured.prompt()).toContain(`<answer question="What's is his age">25 in 2026</answer>`);
  });
});

describe('the owner\'s answers and profile in the prompt', () => {
  /** Each text on its own axis, the question on axis 0: only wordings named here as 0 are close to it. */
  function embedderFor(axes: Record<string, number>): Embedder {
    return {
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      embed: vi.fn(async (texts: string[]) => texts.map((t) => axis(axes[t] ?? 0))),
    };
  }

  it('sends only the answers this question is about once they no longer fit the budget, and does not cache that prompt', async () => {
    const pageId = await pageIdFor('nadia');
    // Three long answers: together far past ANSWER_BUDGET_CHARS.
    await seedTopic(pageId, { answer: 'Delivery is RM10. ' + 'd'.repeat(900), wordings: [{ text: 'Ada delivery?' }] });
    await seedTopic(pageId, { answer: 'Halal certified. ' + 'h'.repeat(900), wordings: [{ text: 'Halal tak?' }] });
    await seedTopic(pageId, { answer: 'Open 10 to 7. ' + 'o'.repeat(900), wordings: [{ text: 'Buka pukul berapa?' }] });
    const captured = gatewayCapturingCall();

    await collect(
      answer(
        // The question and 'Halal tak?' share axis 0; the other wordings sit elsewhere.
        { prisma, gateway: captured.gateway, cap, embedder: embedderFor({ 'Ada delivery?': 1, 'Buka pukul berapa?': 2 }) },
        { handle: 'nadia', question: 'Is it halal?' },
      ),
    );

    const prompt = captured.call().systemPrompt;
    expect(prompt).toContain('Halal certified.');
    expect(prompt).not.toContain('Delivery is RM10.');
    expect(prompt).not.toContain('Open 10 to 7.');
    expect(captured.call().cachePrompt).toBe(false);
  });

  it('sends every answer while they fit the budget, and keeps the prompt cacheable', async () => {
    await seedTopic(await pageIdFor('nadia'), { answer: 'Delivery is RM10.', wordings: [{ text: 'Ada delivery?' }] });
    const captured = gatewayCapturingCall();
    // Off axis 0, so the pre-reply check for an answered topic finds nothing close and the model answers.
    const embedder = embedderFor({ 'Ada delivery?': 1 });

    await collect(answer({ prisma, gateway: captured.gateway, cap, embedder }, { handle: 'nadia', question: 'Is it halal?' }));

    expect(captured.call().systemPrompt).toContain('Delivery is RM10.');
    // Facts in fallback (a small page) and answers sent whole: the prefix repeats, so it is cached.
    expect(captured.call().cachePrompt).toBe(true);
  });

  it("sends the page's bio and links, so a contact question has its answer", async () => {
    const pageId = await pageIdFor('nadia');
    await prisma.page.update({ where: { id: pageId }, data: { bio: 'Kek butter, Shah Alam' } });
    await prisma.link.create({ data: { pageId, label: 'Order di WhatsApp', url: 'https://wa.me/60123', position: 0 } });
    const captured = gatewayCapturingCall();

    await collect(answer({ prisma, gateway: captured.gateway, cap, embedder: null }, { handle: 'nadia', question: 'How do I order?' }));

    expect(captured.call().systemPrompt).toContain('About: Kek butter, Shah Alam');
    expect(captured.call().systemPrompt).toContain('WhatsApp: Order di WhatsApp -- https://wa.me/60123');
  });
});

describe('"where is my order", by its code', () => {
  type Event = { type: string; text?: string; conversationId?: string; card?: unknown; orderChips?: unknown; intent?: { qualified: boolean } };

  async function seedOrder(handle = 'nadia', code = '7Q4M') {
    const pageId = await pageIdFor(handle);
    await prisma.page.update({ where: { id: pageId }, data: { mode: 'BUSINESS', storeEnabled: true } });
    return prisma.order.create({
      data: {
        pageId,
        number: 14,
        code,
        tokenHash: `hash-${code}-${handle}`,
        customerName: 'Mira Hassan',
        phone: '+60123456789',
        method: 'PICKUP',
        day: new Date('2026-12-05T00:00:00Z'),
        itemsCents: 2_500,
        deliveryCents: 0,
        totalCents: 2_500,
        lines: { create: [{ itemName: 'Kek Batik', optionLabel: null, unitPriceCents: 2_500, quantity: 1, position: 0 }] },
      },
    });
  }

  async function ask(gateway: Gateway, question: string, conversationId?: string): Promise<Event[]> {
    return collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question, conversationId }));
  }

  const said = (events: Event[]) => events.filter((e) => e.type === 'text').map((e) => e.text).join('');
  const idOf = (events: Event[]) => {
    const id = events.find((e) => e.type === 'done')?.conversationId;
    if (!id) throw new Error('no conversation id');
    return id;
  };

  it('asks for the last 4 digits, then shows the card', async () => {
    const order = await seedOrder();
    const gateway = gatewaySaying('unused');

    const first = await ask(gateway, 'Where’s my order 7Q4M?');
    expect(said(first)).toBe('Found order 7Q4M. To keep it private, what are the last 4 digits of the WhatsApp number on it?');
    expect(first.some((e) => e.type === 'order')).toBe(false);
    const conversationId = idOf(first);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).pendingOrderId).toBe(order.id);

    const second = await ask(gateway, '6789', conversationId);
    expect(said(second)).toBe('Thanks. Here’s order 7Q4M:');
    expect(second.map((e) => e.type)).toEqual(['text', 'order', 'done']);
    expect(second.find((e) => e.type === 'order')?.card).toMatchObject({
      number: 14,
      code: '7Q4M',
      pill: 'Waiting for payment',
      summary: '1× Kek Batik',
      when: 'Pickup · Sat 5 Dec',
      totalCents: 2_500,
    });
    expect(second.find((e) => e.type === 'done')).toMatchObject({ conversationId, intent: { qualified: false } });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).pendingOrderId).toBeNull();
  });

  it('takes a whole number typed with spaces and dashes', async () => {
    await seedOrder();
    const gateway = gatewaySaying('unused');
    const conversationId = idOf(await ask(gateway, 'status YVA4 or 7q4m'));
    expect(said(await ask(gateway, '012-345 6789', conversationId))).toBe('Thanks. Here’s order 7Q4M:');
  });

  it('never shows an order to the wrong digits', async () => {
    await seedOrder();
    const gateway = gatewaySaying('a model answer');
    const chat = vi.spyOn(gateway, 'chat');

    const conversationId = idOf(await ask(gateway, 'where is my order 7Q4M'));
    const wrong = await ask(gateway, '1234', conversationId);
    expect(said(wrong)).toBe('Those digits don’t match the number on order 7Q4M. Try again, or message Nadia Bakes on WhatsApp.');
    expect(wrong.some((e) => e.type === 'order')).toBe(false);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).pendingOrderId).toBeNull();

    // One try per mention of the code: the right digits now, without the
    // code again, are just a message for the model.
    const again = await ask(gateway, '6789', conversationId);
    expect(again.some((e) => e.type === 'order')).toBe(false);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('says a code is not this shop’s', async () => {
    await seedOrder();
    // Another page's order with the code asked for.
    await prisma.account.create({
      data: { email: 'other@example.com', pages: { create: { handle: 'other', skeleton: 'other', displayName: 'Other', published: true } } },
    });
    await seedOrder('other', 'ZZ99');
    const gateway = gatewaySaying('unused');
    const chat = vi.spyOn(gateway, 'chat');

    const events = await ask(gateway, 'where is my order ZZ99?');
    expect(said(events)).toBe('I can’t find an order ZZ99 with this shop. Check the code on your order page.');
    expect(chat).not.toHaveBeenCalled();
  });

  it('leaves an ordinary four-letter word to the model', async () => {
    await seedOrder();
    const gateway = gatewaySaying('We have kek batik.');
    const chat = vi.spyOn(gateway, 'chat');
    await ask(gateway, 'what cake do you have?');
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('sends a message about ordering, with no code in it, to the model', async () => {
    await seedOrder();
    for (const question of ['Can I order cake for Saturday?', 'nak buat tempahan baru', 'WHAT IS MY ORDER']) {
      const gateway = gatewaySaying('A model answer.');
      const chat = vi.spyOn(gateway, 'chat');
      const events = await ask(gateway, question);
      expect(chat, question).toHaveBeenCalledTimes(1);
      expect(said(events), question).toBe('A model answer.');
    }
  });

  it('never takes a word for a code, even when an order’s code is spelt like it', async () => {
    // orderCode() cannot make a code with no digit (orders.test.ts); this one
    // is written by hand, to prove the chat would not be captured by it.
    await seedOrder('nadia', 'MANA');
    const gateway = gatewaySaying('Kami di Shah Alam.');
    const chat = vi.spyOn(gateway, 'chat');
    expect(said(await ask(gateway, 'mana lokasi?'))).toBe('Kami di Shah Alam.');
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('finds a code typed in small letters', async () => {
    await seedOrder();
    const gateway = gatewaySaying('unused');
    expect(said(await ask(gateway, 'where is my order 7q4m'))).toBe(
      'Found order 7Q4M. To keep it private, what are the last 4 digits of the WhatsApp number on it?',
    );
  });

  it('spends no model call or conversation on a lookup', async () => {
    await seedOrder();
    const gateway = gatewaySaying('an answer');
    const chat = vi.spyOn(gateway, 'chat');

    const conversationId = idOf(await ask(gateway, 'where is my order 7Q4M'));
    await ask(gateway, '6789', conversationId);
    await ask(gateway, 'where is my order HX9T');

    expect(chat).not.toHaveBeenCalled();
    expect(await prisma.modelCall.count()).toBe(0);
    expect(await prisma.usageCounter.count()).toBe(0);
    expect(await prisma.question.count()).toBe(0);
    expect(await prisma.topic.count()).toBe(0);
    // Not even the digits are kept.
    expect(await prisma.message.count()).toBe(0);

    // A real question afterwards in the same thread is that thread's first, and counts it once.
    await ask(gateway, 'ada delivery?', conversationId);
    await ask(gateway, 'ke Klang?', conversationId);
    expect((await prisma.usageCounter.findFirstOrThrow()).count).toBe(1);
  });

  it('still looks an order up over the monthly cap, since it costs nothing', async () => {
    await seedOrder();
    await prisma.usageCounter.create({
      data: { pageId: await pageIdFor('nadia'), period: new Date().toISOString().slice(0, 7), count: cap + 5 },
    });
    const gateway = gatewaySaying('unused');
    const conversationId = idOf(await ask(gateway, 'order 7Q4M'));
    expect(said(await ask(gateway, '6789', conversationId))).toBe('Thanks. Here’s order 7Q4M:');
  });
});

describe('product card', () => {
  type Card = { itemId: string; slug: string; name: string; fromPriceCents: number | null; photoUrl: string | null; firstOptionId: string | null };
  type Event = { type: string; productCard?: Card | null; orderChips?: unknown; intent?: { qualified: boolean }; conversationId?: string };

  async function seedItems(storeEnabled: boolean) {
    const pageId = await pageIdFor('nadia');
    await prisma.page.update({ where: { id: pageId }, data: { storeEnabled, mode: 'BUSINESS' } });
    const batik = await prisma.item.create({ data: { pageId, name: 'Kek Batik', slug: 'kek-batik', priceCents: 2500, photoKey: 'items/p/batik.webp', position: 0, available: true } });
    const coklat = await prisma.item.create({
      data: { pageId, name: 'Kek Coklat Moist', slug: 'kek-coklat-moist', position: 1, available: true, options: { create: [{ label: '1kg', priceCents: 9500, position: 0 }, { label: '2kg', priceCents: 17000, position: 1 }] } },
      include: { options: { orderBy: { position: 'asc' } } },
    });
    await prisma.item.create({ data: { pageId, name: 'Tart Nenas', slug: 'tart-nenas', priceCents: 900, position: 2, available: true } });
    await prisma.item.create({ data: { pageId, name: 'Hidden Tart', slug: 'hidden-tart', priceCents: 900, position: 3, available: false } });
    return { batik, coklat };
  }

  async function ask(gateway: Gateway, question: string, conversationId?: string): Promise<Event[]> {
    return collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question, conversationId }));
  }

  it('sends one card, for the first item the answer names, and withholds the capture card on that turn', async () => {
    vi.stubEnv('STORAGE_PUBLIC_URL', 'https://files.example');
    try {
      const { batik } = await seedItems(true);
      const gateway = gatewaySaying('Ada! Kek batik RM25, kek coklat moist RM95, tart nenas dan hidden tart pun.');

      // Three specific turns: the turn that would otherwise offer the capture card.
      const first = await ask(gatewaySaying('Ya ada.'), 'ada kek butter?');
      const conversationId = first.find((e) => e.type === 'done')?.conversationId;
      await ask(gatewaySaying('Ya.'), 'yang 2kg', conversationId);
      const third = await ask(gateway, 'hantar ke Klang 20 Mac boleh?', conversationId);

      const done = third.find((e) => e.type === 'done');
      expect(done?.productCard).toEqual({
        itemId: batik.id,
        slug: 'kek-batik',
        name: 'Kek Batik',
        fromPriceCents: 2500,
        photoUrl: 'https://files.example/items/p/batik.webp',
        firstOptionId: null,
        buy: 'add',
      });
      expect(done?.orderChips).toBeUndefined();
      expect(done?.intent).toEqual({ qualified: false });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('gives an item with options its cheapest price and its first option', async () => {
    const { coklat } = await seedItems(true);
    const events = await ask(gatewaySaying('Kek coklat moist, ya.'), 'ada kek coklat?');
    expect(events.find((e) => e.type === 'done')?.productCard).toMatchObject({
      itemId: coklat.id,
      fromPriceCents: 9500,
      firstOptionId: coklat.options[0]?.id,
    });
  });

  it('offers the capture card on those same three turns with the shop off (the control)', async () => {
    await seedItems(false);
    const gateway = gatewaySaying('Ada! Kek batik RM25, kek coklat moist RM95, tart nenas dan hidden tart pun.');

    const first = await ask(gatewaySaying('Ya ada.'), 'ada kek butter?');
    const conversationId = first.find((e) => e.type === 'done')?.conversationId;
    await ask(gatewaySaying('Ya.'), 'yang 2kg', conversationId);
    const third = await ask(gateway, 'hantar ke Klang 20 Mac boleh?', conversationId);

    const done = third.find((e) => e.type === 'done');
    expect(done?.productCard).toBeUndefined();
    expect(done?.intent).toEqual({ qualified: true });
  });

  it('sends no card while the shop is off', async () => {
    await seedItems(false);
    const events = await ask(gatewaySaying('Kek batik RM25.'), 'berapa kek batik?');
    expect(events.find((e) => e.type === 'done')?.productCard).toBeUndefined();
  });

  it('sends no card when the answer names no item', async () => {
    await seedItems(true);
    const events = await ask(gatewaySaying('Boleh, hubungi kami.'), 'boleh hantar?');
    expect(events.find((e) => e.type === 'done')?.productCard).toBeUndefined();
  });

  it('sends no card on an owner’s pinned answer', async () => {
    await seedItems(true);
    await seedTopic(await pageIdFor('nadia'), { answer: 'Kek batik RM25.', wordings: [{ text: 'berapa kek batik?' }] });
    const events = await ask(gatewaySaying('unused'), 'berapa kek batik?');
    expect(events.find((e) => e.type === 'done')?.productCard).toBeUndefined();
  });
});
