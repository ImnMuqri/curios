import { normalizeClaim } from '@curios/core';
import { recordModelCall, type PrismaClient } from '@curios/db';
import { CHAT_MODEL, type Gateway } from '@curios/gateway';
import { buildSystemPrompt } from './prompt.js';

export type AnswerEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; conversationId: string };

export interface ChatDeps {
  prisma: PrismaClient;
  gateway: Gateway;
}

export class PageNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'PAGE_NOT_FOUND';
  constructor() {
    super('No such page.');
  }
}

/** Billing period. The anniversary rule arrives with billing; the shape does not change. */
function currentPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export async function* answer(
  deps: ChatDeps,
  input: { handle: string; question: string },
): AsyncIterable<AnswerEvent> {
  const { prisma, gateway } = deps;

  const page = await prisma.page.findUnique({
    where: { handle: input.handle.toLowerCase() },
    select: {
      id: true,
      displayName: true,
      facts: {
        where: { verified: true },
        select: { id: true, category: true, claim: true },
        orderBy: { createdAt: 'asc' },
      },
      neverSay: { select: { phrase: true } },
    },
  });

  if (!page) throw new PageNotFoundError();

  const conversation = await prisma.conversation.create({
    data: { pageId: page.id },
    select: { id: true },
  });

  // The meter counts conversations, not messages, so a chatty visitor costs the
  // owner one unit. Atomic upsert: two visitors opening the sheet at once on a
  // popular page would race a read-then-write.
  await prisma.usageCounter.upsert({
    where: { pageId_period: { pageId: page.id, period: currentPeriod() } },
    create: { pageId: page.id, period: currentPeriod(), count: 1 },
    update: { count: { increment: 1 } },
  });

  await prisma.message.create({
    data: { conversationId: conversation.id, role: 'USER', content: input.question },
  });

  // A pinned answer wins over model output. Zero tokens, zero risk.
  const pinned = await prisma.pinnedAnswer.findUnique({
    where: {
      pageId_normalizedQuestion: {
        pageId: page.id,
        normalizedQuestion: normalizeClaim(input.question),
      },
    },
    select: { answer: true },
  });

  if (pinned) {
    yield { type: 'text', text: pinned.answer };
    await prisma.message.create({
      data: { conversationId: conversation.id, role: 'ASSISTANT', content: pinned.answer },
    });
    yield { type: 'done', conversationId: conversation.id };
    return;
  }

  // Every verified fact, not a question-dependent subset. Filtering here would
  // vary the cached prefix per question and destroy cross-visitor cache reuse.
  const facts = page.facts;
  const systemPrompt = buildSystemPrompt({
    displayName: page.displayName,
    facts,
    neverSay: page.neverSay.map((n) => n.phrase),
  });

  let text = '';
  try {
    for await (const event of gateway.chat({ systemPrompt, question: input.question })) {
      if (event.type === 'text') {
        text += event.text;
        yield { type: 'text', text: event.text };
      } else {
        // Persisted after the stream closes, never before the first token.
        // Same helper the worker uses -- one place computes cost, so the margin
        // numbers cannot drift between the two processes that produce them.
        await recordModelCall(prisma, {
          pageId: page.id,
          conversationId: conversation.id,
          model: event.model,
          usage: event.usage,
          latencyMs: event.latencyMs,
          ok: true,
        });
      }
    }
  } catch (error) {
    // A call that fails mid-stream has already consumed tokens; recording
    // nothing would lose both the cost and the fact that the failure
    // happened, leaving the failure rate invisible in the one table meant to
    // show it. The zeros are a known-unknown, not a lie: unlike a crawl
    // failure where no model was ever called, a call genuinely happened here
    // and we simply do not know its usage.
    await recordModelCall(prisma, {
      pageId: page.id,
      conversationId: conversation.id,
      model: CHAT_MODEL,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      latencyMs: 0,
      ok: false,
      errorCode: 'PROVIDER_UNAVAILABLE',
    });
    throw error;
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'ASSISTANT',
      content: text,
      citedFactIds: facts.map((f) => f.id),
    },
  });

  yield { type: 'done', conversationId: conversation.id };
}
