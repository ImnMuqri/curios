import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Gateway } from '@curios/gateway';
import { answer, PageNotFoundError } from './chat.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

function gatewaySaying(text: string): Gateway {
  return {
    extract: vi.fn(),
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

async function collect(stream: AsyncIterable<{ type: string; text?: string }>) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account", "ModelCall" CASCADE');
  await prisma.account.create({
    data: {
      email: 'n@example.com',
      pages: {
        create: {
          handle: 'nadia',
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

describe('answer', () => {
  it('streams text and creates a conversation', async () => {
    const gateway = gatewaySaying('Kek 1kg butter bermula RM95.');
    const events = await collect(answer({ prisma, gateway }, { handle: 'nadia', question: 'harga kek' }));

    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toContain('RM95');
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('returns a pinned answer without calling the model at all', async () => {
    const gateway = gatewaySaying('should not be used');
    const chatSpy = vi.spyOn(gateway, 'chat');

    const events = await collect(
      answer({ prisma, gateway }, { handle: 'nadia', question: 'Berapa harga?' }),
    );

    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Bermula RM95.');
    expect(chatSpy).not.toHaveBeenCalled();
    expect(await prisma.modelCall.count()).toBe(0);
  });

  it('matches a pinned answer ignoring case and punctuation', async () => {
    const gateway = gatewaySaying('unused');
    const events = await collect(
      answer({ prisma, gateway }, { handle: 'nadia', question: 'berapa harga' }),
    );
    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Bermula RM95.');
  });

  it('persists both messages after the stream closes', async () => {
    const gateway = gatewaySaying('Kek 1kg butter bermula RM95.');
    await collect(answer({ prisma, gateway }, { handle: 'nadia', question: 'harga kek' }));

    const messages = await prisma.message.findMany({ orderBy: { createdAt: 'asc' } });
    expect(messages.map((m) => m.role)).toEqual(['USER', 'ASSISTANT']);
  });

  it('records a ModelCall with a non-zero cost', async () => {
    const gateway = gatewaySaying('Kek 1kg butter bermula RM95.');
    await collect(answer({ prisma, gateway }, { handle: 'nadia', question: 'harga kek' }));

    const call = await prisma.modelCall.findFirstOrThrow();
    expect(call.model).toBe('claude-haiku-4-5');
    expect(call.costMilliCents).toBeGreaterThan(0);
  });

  it('increments the usage counter once per conversation, not per message', async () => {
    const gateway = gatewaySaying('answer');
    await collect(answer({ prisma, gateway }, { handle: 'nadia', question: 'harga kek' }));
    await collect(answer({ prisma, gateway }, { handle: 'nadia', question: 'harga kek lagi' }));

    const counters = await prisma.usageCounter.findMany();
    expect(counters).toHaveLength(1);
    expect(counters[0]?.count).toBe(2);
  });

  it('records a failed ModelCall and keeps the user message when the gateway throws mid-stream', async () => {
    const gateway = gatewayThatFails();

    await expect(
      collect(answer({ prisma, gateway }, { handle: 'nadia', question: 'harga kek' })),
    ).rejects.toThrow('provider unavailable');

    const call = await prisma.modelCall.findFirstOrThrow();
    expect(call.ok).toBe(false);

    const messages = await prisma.message.findMany();
    expect(messages.map((m) => m.role)).toEqual(['USER']);
  });

  it('throws for an unknown handle', async () => {
    const gateway = gatewaySaying('unused');
    await expect(
      collect(answer({ prisma, gateway }, { handle: 'nobody', question: 'hi' })),
    ).rejects.toThrow(PageNotFoundError);
  });

  it('never sends an unverified fact\'s claim to the gateway', async () => {
    const { gateway, prompt } = gatewayCapturingPrompt();
    await collect(answer({ prisma, gateway }, { handle: 'nadia', question: 'harga kek' }));

    // Assert on the prompt the gateway actually received, not a rebuilt string.
    expect(prompt()).not.toContain('Unverified secret price RM1');
    expect(prompt()).toContain('Kek 1kg butter starts at RM95');
  });

  it('treats an unpublished page the same as a missing one: no answer, no tokens spent', async () => {
    const gateway = gatewaySaying('should not be used');
    const chatSpy = vi.spyOn(gateway, 'chat');

    await expect(
      collect(answer({ prisma, gateway }, { handle: 'draft', question: 'harga?' })),
    ).rejects.toThrow(PageNotFoundError);

    expect(chatSpy).not.toHaveBeenCalled();
    expect(await prisma.conversation.count()).toBe(0);
  });
});
