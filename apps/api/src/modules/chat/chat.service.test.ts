import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteQuestion } from '../questions/question.service.js';
import { PrismaClient } from '@prisma/client';
import { FREE_CONVERSATIONS_PER_MONTH, normalizeClaim, RETRIEVAL_MIN_FACTS } from '@curios/core';
import type { ChatInput, ChatMessage, Gateway } from '@curios/gateway';
import {
  encodeVector,
  EMBEDDING_DIMS,
  EMBEDDING_MODEL,
  type Embedder,
} from '@curios/embeddings';
import { answer, CAP_REACHED_REPLY, MAX_HISTORY_MESSAGES, PageNotFoundError } from './chat.service.js';

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
          pinnedAnswers: {
            create: {
              question: 'Berapa harga?',
              normalizedQuestion: 'berapa harga',
              answer: 'Bermula RM95.',
            },
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

describe('answer', () => {
  it('streams text and creates a conversation', async () => {
    const gateway = gatewaySaying('Kek 1kg butter bermula RM95.');
    const events = await collect(answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'harga kek' }));

    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toContain('RM95');
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('returns a pinned answer without calling the model at all', async () => {
    const gateway = gatewaySaying('should not be used');
    const chatSpy = vi.spyOn(gateway, 'chat');

    const events = await collect(
      answer({ prisma, gateway, cap, embedder: null }, { handle: 'nadia', question: 'Berapa harga?' }),
    );

    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Bermula RM95.');
    expect(chatSpy).not.toHaveBeenCalled();
    expect(await prisma.modelCall.count()).toBe(0);
  });

  it('matches a pinned answer ignoring case and punctuation', async () => {
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
    expect(question.answered).toBe(false);
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

  it('logs a question the pinned answer handled, too', async () => {
    // This file's fixture already pins "Berapa harga?", so this ask never
    // reaches the model. The row still has to exist and still has to count, or
    // a question would drop off the screen the moment it got popular enough to
    // be worth pinning.
    await ask(depsSaying(), 'berapa harga?');

    const question = await prisma.question.findFirstOrThrow({});
    expect(question.askCount).toBe(1);
    expect(question.text).toBe('berapa harga?');
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

    await ask(depsSaying(), 'berapa harga?');
    await collect(answer(depsSaying(), { handle: 'someoneelse', question: 'berapa harga?' }));

    expect(await prisma.question.count()).toBe(2);
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
    const page = await prisma.page.findFirstOrThrow({
      where: { handle: 'nadia' },
      select: { id: true },
    });
    const normalizedQuestion = 'berapa harga kek coklat';
    await prisma.question.create({
      data: {
        pageId: page.id,
        text: 'Berapa harga kek coklat?',
        normalizedQuestion,
        askCount: 2,
        answered: true,
      },
    });

    await collect(
      answer(
        { prisma, gateway: gatewaySaying('RM80.'), cap, embedder: null },
        { handle: 'nadia', question: 'Berapa harga kek coklat?' },
      ),
    );

    const question = await prisma.question.findFirstOrThrow({ where: { normalizedQuestion } });
    expect(question.askCount).toBe(3);
    expect(question.faqSlug).toBe('berapa-harga-kek-coklat');
  });
});

describe('an erased question, asked again', () => {
  it('comes back as a stranger: no answer, no slug, and the model answers it', async () => {
    // Right-to-erasure only means something if it survives the next customer.
    // The chat path upserts questions by normalised text, so an erased row
    // returns the moment somebody asks the same thing -- which is fine, as long
    // as it returns as a stranger. The answer is the part that matters: chat
    // serves a PinnedAnswer ahead of the model, so one left behind by an
    // incomplete erasure puts the erased words straight back in front of the
    // very next visitor.
    const page = await prisma.page.findFirstOrThrow({
      where: { handle: 'nadia' },
      select: { id: true, accountId: true },
    });
    // The same phrasing and key as the slug test above, which already proves
    // chat normalises this text to exactly this key -- so the erased row, the
    // pinned answer and the re-asked question all line up without guessing.
    const text = 'Berapa harga kek coklat?';
    const normalizedQuestion = 'berapa harga kek coklat';
    const erased = await prisma.question.create({
      data: {
        pageId: page.id,
        text,
        normalizedQuestion,
        askCount: 3,
        answered: true,
        faqSlug: 'berapa-harga-kek-coklat',
      },
      select: { id: true },
    });
    await prisma.pinnedAnswer.create({
      data: {
        pageId: page.id,
        question: text,
        normalizedQuestion,
        answer: 'RM80. WhatsApp saya terus di 0123456789.',
      },
    });

    await deleteQuestion(prisma, page.accountId, erased.id);

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

    // The model answered, not the erased owner text. Had deleteQuestion left
    // the PinnedAnswer behind, chat would have served it here instead.
    expect(reply).toBe('A model answer.');
    expect(await prisma.pinnedAnswer.count({ where: { pageId: page.id, normalizedQuestion } })).toBe(0);

    const back = await prisma.question.findUniqueOrThrow({
      where: { pageId_normalizedQuestion: { pageId: page.id, normalizedQuestion } },
    });
    expect(back.id).not.toBe(erased.id);
    // One ask: the one just made. The walkthrough once said to ask "twice more"
    // and expect a count of one, which the upsert makes two.
    expect(back.askCount).toBe(1);
    expect(back.answered).toBe(false);
    expect(back.faqSlug).toBeNull();
  });
});

describe('the monthly cap', () => {
  /**
   * Puts the page at `count` conversations for the current period, without
   * driving that many chats. The period key is `YYYY-MM`, which is what
   * `currentPeriod()` in chat.service.ts produces.
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

  it('still serves a pinned answer over the cap, because it costs nothing', async () => {
    // The argument of this slice. BACKEND.md checked the cap above the pinned
    // branch; a pinned answer makes no model call, so refusing it punishes an
    // owner for having answered the question well.
    const pageId = await usageAt(500);
    await prisma.pinnedAnswer.create({
      data: {
        pageId,
        question: 'Berapa harga?',
        normalizedQuestion: 'harga',
        answer: 'RM95 sekilo.',
      },
    });
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
    expect(text.indexOf('Kami dah jawab')).toBeLessThan(text.indexOf("We've answered"));

    const assistantMessage = await prisma.message.findFirstOrThrow({
      where: { role: 'ASSISTANT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(assistantMessage.content).toBe(CAP_REACHED_REPLY);
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

  it('a pinned answer still costs nothing, whatever retrieval would have done', async () => {
    await seedLargePage();
    const { embedder, embed } = embedderAnswering();
    await prisma.pinnedAnswer.create({
      data: {
        pageId: await pageIdFor('katalog'),
        question: 'berapa harga',
        normalizedQuestion: normalizeClaim('berapa harga'),
        answer: 'Bermula RM95.',
      },
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
