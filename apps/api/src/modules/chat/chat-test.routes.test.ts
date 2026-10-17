import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Gateway } from '@curios/gateway';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;
let nth = 0;
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

/** What the model was asked, each time. */
const calls: Array<{ systemPrompt: string; messages: Array<{ role: string; content: string }> }> = [];

function stubGateway(): Gateway {
  return {
    extract: vi.fn(),
    slots: vi.fn(),
    sameQuestion: async () => {
      throw new Error('not used');
    },
    chat: async function* (request) {
      calls.push({ systemPrompt: request.systemPrompt, messages: request.messages });
      yield { type: 'text' as const, text: 'Kek butter 1kg ' };
      yield { type: 'text' as const, text: 'RM95.' };
      yield {
        type: 'done' as const,
        usage: { inputTokens: 900, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 },
        // A real model id: recordModelCall prices every call from a table.
        model: 'claude-haiku-4-5',
        latencyMs: 1,
      };
    },
  };
}

beforeAll(async () => {
  // embedder: null: no retrieval, and no same-question check for a new
  // wording, so the only model call is the answer itself.
  app = await buildApp({ chat: { gateway: stubGateway(), embedder: null } });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  calls.length = 0;
});

/** An owner whose page is NOT published, with one verified and one unreviewed fact. */
async function anOwner() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `ct-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle: `ct-${slug}`,
          skeleton: `ct-${slug}`,
          displayName: 'Nadia Bakes',
          published: false,
          facts: {
            create: [
              { category: 'PRICE', claim: 'Kek butter 1kg RM95', normalizedClaim: 'kek butter 1kg rm95', confidence: 0.9, verified: true },
              { category: 'PRICE', claim: 'Kek lapis RM60', normalizedClaim: 'kek lapis rm60', confidence: 0.9, verified: false },
            ],
          },
        },
      },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, pageId: account.pages[0]!.id };
}

const ask = (cookie: string | null, payload: unknown) =>
  app.inject({
    method: 'POST',
    url: '/chat/test',
    remoteAddress: from(),
    ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}),
    payload: payload as Record<string, unknown>,
  });

describe('POST /chat/test', () => {
  it('refuses a caller who is not signed in', async () => {
    const res = await ask(null, { question: 'Berapa kek butter?' });
    expect(res.statusCode).toBe(401);
  });

  it('answers before the page is published, from accepted facts only', async () => {
    const mine = await anOwner();

    const res = await ask(mine.cookie, { question: 'Berapa kek butter?' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: 'Kek butter 1kg RM95.', from: 'facts' });
    // The same rule as the live chat: nothing unreviewed reaches an answer.
    expect(calls[0]?.systemPrompt).toContain('Kek butter 1kg RM95');
    expect(calls[0]?.systemPrompt).not.toContain('Kek lapis RM60');
  });

  it('leaves no trace on Questions, the conversation count or the inbox, only the cost', async () => {
    const mine = await anOwner();

    await ask(mine.cookie, { question: 'Do you deliver to Klang?' });

    const where = { pageId: mine.pageId };
    expect(await app.prisma.question.count({ where })).toBe(0);
    expect(await app.prisma.topic.count({ where })).toBe(0);
    expect(await app.prisma.conversation.count({ where })).toBe(0);
    expect(await app.prisma.usageCounter.count({ where })).toBe(0);
    // The model call is recorded against the page, so its cost is visible.
    expect(await app.prisma.modelCall.count({ where })).toBe(1);
  });

  it("gives the owner's own answer for a wording they answered, without the model", async () => {
    const mine = await anOwner();
    await app.prisma.topic.create({
      data: {
        pageId: mine.pageId,
        title: 'Is it halal?',
        answer: 'Yes, every ingredient is halal certified.',
        questions: { create: { pageId: mine.pageId, text: 'Is it halal?', normalizedQuestion: 'is it halal' } },
      },
    });

    const res = await ask(mine.cookie, { question: 'Is it HALAL?' });

    expect(res.json()).toEqual({ reply: 'Yes, every ingredient is halal certified.', from: 'answer' });
    expect(calls).toHaveLength(0);
    // Read, not counted: the wording's asks are untouched.
    const wording = await app.prisma.question.findFirstOrThrow({ where: { pageId: mine.pageId } });
    expect(wording.askCount).toBe(1);
  });

  it('carries the earlier turns, starting on the visitor side', async () => {
    const mine = await anOwner();

    await ask(mine.cookie, {
      question: 'Yang 2kg pula?',
      history: [
        { role: 'assistant', content: 'Hi! Ask me anything.' },
        { role: 'user', content: 'Berapa kek butter?' },
        { role: 'assistant', content: 'Kek butter 1kg RM95.' },
      ],
    });

    expect(calls[0]?.messages).toEqual([
      { role: 'user', content: 'Berapa kek butter?' },
      { role: 'assistant', content: 'Kek butter 1kg RM95.' },
      { role: 'user', content: 'Yang 2kg pula?' },
    ]);
  });

  it('refuses an empty question', async () => {
    const mine = await anOwner();
    const res = await ask(mine.cookie, { question: '   ' });
    expect(res.statusCode).toBe(400);
  });

  it('gives the limit’s fixed reply once a new visitor would get it, and calls no model', async () => {
    const mine = await anOwner();
    const { conversationCap } = await import('@curios/core');
    await app.prisma.usageCounter.create({
      data: { pageId: mine.pageId, period: new Date().toISOString().slice(0, 7), count: conversationCap() },
    });

    const res = await ask(mine.cookie, { question: 'Berapa kek butter?' });

    expect(res.json()).toMatchObject({ from: 'limit' });
    expect(res.json().reply).toContain("We've answered a lot of questions this month");
    expect(calls).toHaveLength(0);
    // Read, not counted.
    expect((await app.prisma.usageCounter.findFirstOrThrow({ where: { pageId: mine.pageId } })).count).toBe(conversationCap());
  });

  it('still answers one under the limit', async () => {
    const mine = await anOwner();
    const { conversationCap } = await import('@curios/core');
    await app.prisma.usageCounter.create({
      data: { pageId: mine.pageId, period: new Date().toISOString().slice(0, 7), count: conversationCap() - 1 },
    });

    const res = await ask(mine.cookie, { question: 'Berapa kek butter?' });

    expect(res.json()).toMatchObject({ from: 'facts' });
  });
});
