import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Gateway } from '@curios/gateway';
import { buildApp } from '../../app.js';
import { CAP_REACHED_REPLY } from './chat.service.js';

let app: FastifyInstance;

/**
 * Its own handle, not 'nadia'. Every suite in apps/api shares one database and
 * chat.service.test.ts already owns that handle -- and truncates between its
 * own tests, not between files, so a fixed name here collides on whichever
 * order vitest happens to pick.
 */
const handle = `nadia-${randomUUID().slice(0, 8)}`;

let nth = 0;
/** A fresh source address per request, so the per-IP limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

/**
 * A stub, injected through AppOverrides. Before this existed the chat route
 * built its gateway from ANTHROPIC_API_KEY at registration time, which made it
 * the one route in the app that could not be exercised without either a key or
 * real model spend -- which is why it had no test file at all until now.
 */
function stubGateway(): Gateway {
  return {
    extract: vi.fn(),
    slots: vi.fn(),
    chat: async function* () {
      yield { type: 'text' as const, text: 'Kek butter 1kg RM95.' };
      yield {
        type: 'done' as const,
        usage: { inputTokens: 900, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 },
        // A real model id, not 'stub': recordModelCall prices every call from
        // a table and throws on a name it does not know, so an invented one
        // fails the request after the answer has already streamed.
        model: 'claude-haiku-4-5',
        latencyMs: 1,
      };
    },
  };
}

/** The events an SSE body carries, parsed the way the browser client parses them. */
function eventsOf(
  payload: string,
): Array<{ type: string; text?: string; conversationId?: string; code?: string }> {
  return payload
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map(
      (chunk) =>
        JSON.parse(chunk.slice(6)) as {
          type: string;
          text?: string;
          conversationId?: string;
          code?: string;
        },
    );
}

/** The text an SSE body's `text` events carry, concatenated -- what the visitor actually reads. */
function textOf(payload: string): string {
  return eventsOf(payload)
    .filter((event) => event.type === 'text')
    .map((event) => event.text ?? '')
    .join('');
}

function conversationIdOf(payload: string): string {
  const done = eventsOf(payload).find((event) => event.type === 'done');
  if (!done?.conversationId) throw new Error(`no done event in: ${payload}`);
  return done.conversationId;
}

beforeAll(async () => {
  app = await buildApp({ chat: { gateway: stubGateway() } });
  await app.ready();

  await app.prisma.account.create({
    data: {
      email: `chat-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle,
          skeleton: handle,
          displayName: 'Nadia Bakes',
          published: true,
          facts: {
            create: {
              category: 'PRICE',
              claim: 'Kek butter 1kg RM95',
              normalizedClaim: 'kek butter 1kg rm95',
              confidence: 0.9,
              verified: true,
            },
          },
        },
      },
    },
  });
});

afterAll(async () => {
  await app.close();
});

describe('POST /chat/:handle', () => {
  it('carries a conversation id through two requests', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/chat/${handle}`,
      remoteAddress: from(),
      payload: { question: 'harga kek?' },
    });
    const conversationId = conversationIdOf(first.payload);

    const second = await app.inject({
      method: 'POST',
      url: `/chat/${handle}`,
      remoteAddress: from(),
      payload: { question: 'ada delivery?', conversationId },
    });

    expect(conversationIdOf(second.payload)).toBe(conversationId);
  });

  it('reports a dead conversation inside the stream, not as a status code', async () => {
    // Headers are already sent by the time the service can throw, so this can
    // never be a 404 on the wire. It has to arrive as an error event.
    const res = await app.inject({
      method: 'POST',
      url: `/chat/${handle}`,
      remoteAddress: from(),
      payload: { question: 'hi', conversationId: 'nope' },
    });

    expect(res.statusCode).toBe(200);
    const error = eventsOf(res.payload).find((event) => event.type === 'error');
    expect(error).toMatchObject({ type: 'error', code: 'CONVERSATION_NOT_FOUND' });
  });

  it('says what to do next rather than apologising', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/chat/${handle}`,
      remoteAddress: from(),
      payload: { question: 'hi', conversationId: 'nope' },
    });

    expect(res.payload).toContain('Try again');
    expect(res.payload).not.toMatch(/sorry|oops/i);
  });
});

describe('POST /chat/:handle, over the monthly cap', () => {
  /**
   * A page of its own, already over the cap -- not the shared `handle` above,
   * which the suite's other tests rely on staying under it. Mirrors
   * chat.service.test.ts's own `usageAt()`, but against a fresh page rather
   * than reusing 'nadia', since this file (unlike that one) has no
   * `beforeEach` truncate between tests to reset a shared counter.
   */
  async function aPageOverCap(count: number) {
    const capHandle = `cap-${randomUUID().slice(0, 8)}`;
    const account = await app.prisma.account.create({
      data: {
        email: `chat-cap-${randomUUID()}@example.com`,
        pages: {
          create: {
            handle: capHandle,
            skeleton: capHandle,
            displayName: 'Cap Bakes',
            published: true,
          },
        },
      },
      select: { pages: { select: { id: true } } },
    });
    const pageId = account.pages[0]?.id ?? '';
    // The period key currentPeriod() in chat.service.ts produces.
    const period = new Date().toISOString().slice(0, 7);
    await app.prisma.usageCounter.upsert({
      where: { pageId_period: { pageId, period } },
      create: { pageId, period, count },
      update: { count },
    });
    return { handle: capHandle, pageId, period };
  }

  it('degrades over real HTTP, counts a new conversation but not a continued one, and calls the model for neither', async () => {
    const { handle: capHandle, pageId, period } = await aPageOverCap(500);

    // A new conversation (no conversationId sent) over an already-over-cap
    // page: chat.service.ts's `isNew` branch runs, so the counter climbs by
    // one on top of the 500 aPageOverCap() seeded.
    const first = await app.inject({
      method: 'POST',
      url: `/chat/${capHandle}`,
      remoteAddress: from(),
      payload: { question: 'harga kek?' },
    });
    expect(first.statusCode).toBe(200);
    // Parsed and compared to the imported constant, not re-typed here -- the
    // audit that asked for this test found other documents quoting copy that
    // had since changed.
    expect(textOf(first.payload)).toBe(CAP_REACHED_REPLY);
    const conversationId = conversationIdOf(first.payload);

    const afterFirst = await app.prisma.usageCounter.findUniqueOrThrow({
      where: { pageId_period: { pageId, period } },
    });
    expect(afterFirst.count).toBe(501);

    // The second turn of the SAME conversation: input.conversationId is now
    // defined, so `isNew` is false and the counter must not move again. A
    // check gated on conversation creation alone would refuse this turn for
    // free while still counting it -- this is the distinction the caps
    // walkthrough itself got backwards (see devDocs/manual-verification-caps.md
    // drift note 3).
    const second = await app.inject({
      method: 'POST',
      url: `/chat/${capHandle}`,
      remoteAddress: from(),
      payload: { question: 'ada delivery?', conversationId },
    });
    expect(second.statusCode).toBe(200);
    expect(textOf(second.payload)).toBe(CAP_REACHED_REPLY);

    const afterSecond = await app.prisma.usageCounter.findUniqueOrThrow({
      where: { pageId_period: { pageId, period } },
    });
    expect(afterSecond.count).toBe(501);

    // The cap's whole economic point: a refused conversation must cost
    // nothing. Not "the gateway mock returned nothing" -- an actual absence of
    // ModelCall rows for this conversation, the table the worker prices from.
    const modelCalls = await app.prisma.modelCall.count({ where: { conversationId } });
    expect(modelCalls).toBe(0);
  });
});
