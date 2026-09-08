import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Gateway } from '@curios/gateway';
import { buildApp } from '../../app.js';

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
function eventsOf(payload: string): Array<{ type: string; conversationId?: string; code?: string }> {
  return payload
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)) as { type: string; conversationId?: string });
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
