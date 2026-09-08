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

/**
 * How much of a thread the model sees. Ten messages is five exchanges, which
 * is past the point a visitor is still building on one topic and well inside
 * what Haiku's context and this product's margin can carry.
 */
export const MAX_HISTORY_MESSAGES = 10;

export class ConversationNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'CONVERSATION_NOT_FOUND';
  constructor() {
    super('That conversation has expired. Ask again to start a new one.');
    this.name = 'ConversationNotFoundError';
  }
}

/** Billing period. The anniversary rule arrives with billing; the shape does not change. */
function currentPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export async function* answer(
  deps: ChatDeps,
  input: { handle: string; question: string; conversationId?: string },
): AsyncIterable<AnswerEvent> {
  const { prisma, gateway } = deps;

  const page = await prisma.page.findUnique({
    // An unpublished page is a draft: it has not been reviewed, so it must not
    // answer visitor questions -- doing so both shows unreviewed facts and
    // spends tokens on a page nobody was supposed to be able to reach yet.
    where: { handle: input.handle.toLowerCase(), published: true },
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

  // Resolved before anything is written. A conversation id is a bearer token
  // for a thread, so it is scoped to THIS page inside the query rather than
  // checked after the read -- the same shape as every other ownership check in
  // this codebase.
  let conversationId: string;
  let isNew = false;

  if (input.conversationId === undefined) {
    const created = await prisma.conversation.create({
      data: { pageId: page.id },
      select: { id: true },
    });
    conversationId = created.id;
    isNew = true;
  } else {
    const existing = await prisma.conversation.findFirst({
      where: { id: input.conversationId, pageId: page.id },
      select: { id: true },
    });
    if (!existing) throw new ConversationNotFoundError();
    conversationId = existing.id;
  }

  // Only on creation. The meter counts conversations, not messages, so a
  // chatty visitor costs the owner one unit -- true by accident while every
  // call created a conversation, and a rule now that threads are real. Atomic
  // upsert: two visitors opening the sheet at once on a popular page would
  // otherwise race a read-then-write.
  if (isNew) {
    await prisma.usageCounter.upsert({
      where: { pageId_period: { pageId: page.id, period: currentPeriod() } },
      create: { pageId: page.id, period: currentPeriod(), count: 1 },
      update: { count: { increment: 1 } },
    });
  }

  await prisma.message.create({
    data: { conversationId, role: 'USER', content: input.question },
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
      data: { conversationId, role: 'ASSISTANT', content: pinned.answer },
    });
    yield { type: 'done', conversationId };
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

  // Read back rather than concatenated in memory: one source of truth for what
  // the thread contains, and slice 4's transcript reads the same rows. Oldest
  // first, then the tail taken, so it is the oldest turns that fall off a long
  // conversation.
  const history = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });
  const messages = history.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
    role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }));

  let text = '';
  try {
    for await (const event of gateway.chat({ systemPrompt, messages })) {
      if (event.type === 'text') {
        text += event.text;
        yield { type: 'text', text: event.text };
      } else {
        // Persisted after the stream closes, never before the first token.
        // Same helper the worker uses -- one place computes cost, so the margin
        // numbers cannot drift between the two processes that produce them.
        await recordModelCall(prisma, {
          pageId: page.id,
          conversationId,
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
      conversationId,
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
      conversationId,
      role: 'ASSISTANT',
      content: text,
      citedFactIds: facts.map((f) => f.id),
    },
  });

  yield { type: 'done', conversationId };
}
