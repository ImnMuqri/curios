import { conversationCap, isOverCap, normalizeClaim, qualifies } from '@curios/core';
import { recordModelCall, type PrismaClient } from '@curios/db';
import { CHAT_MODEL, type Gateway } from '@curios/gateway';
import { buildSystemPrompt } from './prompt.js';
import { assignFaqSlug, type Log } from '../questions/faq-slug.js';

export type AnswerEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; conversationId: string; intent: { qualified: boolean } };

export interface ChatDeps {
  prisma: PrismaClient;
  gateway: Gateway;
  // Optional, and only for the faq-slug assignment below: without it, a
  // qualifying question that fails to get a URL -- an exhausted collision
  // loop, unsluggable text, a transient DB error -- leaves no trace anywhere,
  // which is exactly what assignFaqSlug's `log` parameter exists to prevent.
  log?: Log;
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
      // Read for qualification: a personal page never offers the capture card.
      mode: true,
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

  // Read here, above the pinned branch, so both paths share one source of
  // truth -- a pinned answer is still a turn in a conversation and still has
  // to say whether the card may be offered.
  const history = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });
  const messages = history.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
    role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }));

  // Whether the capture card may be offered, computed from the visitor's own
  // turns. Deliberately NOT from Message.citedFactIds: that column stores
  // every verified fact on the page rather than the ones an answer used, so a
  // signal drawn from it would be true of every message ever sent.
  const intent = {
    qualified: qualifies({
      mode: page.mode,
      visitorMessages: history.filter((m) => m.role === 'USER').map((m) => m.content),
    }),
  };

  // Logged for the Questions screen, clustered on the same key the pinned
  // answer below is looked up by. EVERY question, not only refused ones:
  // nothing in an answer is machine-readable enough to tell a refusal from a
  // confident one across Malay, Manglish and English, and a question asked
  // nine times is a gap either way. See BACKEND.md's refusal rule.
  const normalizedQuestion = normalizeClaim(input.question);
  const logged = await prisma.question.upsert({
    where: { pageId_normalizedQuestion: { pageId: page.id, normalizedQuestion } },
    // The first phrasing wins and is never overwritten: the owner reads what
    // somebody actually typed, and rewriting it on every ask would churn the
    // list for no gain.
    create: { pageId: page.id, text: input.question, normalizedQuestion },
    update: { askCount: { increment: 1 }, lastAskedAt: new Date() },
    select: { id: true },
  });

  // The other site. A question the owner answered when it had two asks
  // qualifies on its third, and that third ask happens here, with no owner
  // involved. See faq-slug.ts on why both sites exist.
  await assignFaqSlug(prisma, logged.id, deps.log);

  // A pinned answer wins over model output. Zero tokens, zero risk.
  const pinned = await prisma.pinnedAnswer.findUnique({
    where: {
      pageId_normalizedQuestion: {
        pageId: page.id,
        normalizedQuestion,
      },
    },
    select: { answer: true },
  });

  if (pinned) {
    yield { type: 'text', text: pinned.answer };
    await prisma.message.create({
      data: { conversationId, role: 'ASSISTANT', content: pinned.answer },
    });
    yield { type: 'done', conversationId, intent };
    return;
  }

  // The cap, and this is the line where it belongs.
  //
  // Everything above is database work that has already happened -- the
  // conversation row, the message, the question upsert, the pinned lookup.
  // The gateway call below is the only thing that costs money, so the boundary
  // sits exactly where the spend starts. BACKEND.md put this at step 1, above
  // the pinned branch; that predates pinned answers being free, and refusing a
  // free answer because a page has spent too much punishes an owner for having
  // answered the question well.
  //
  // Read on every turn, not only when the conversation is created. The counter
  // increments on creation alone, so a check gated on `isNew` would refuse the
  // first turn of a conversation started over cap and then hand the second to
  // the model for nothing.
  const used = await prisma.usageCounter.findUnique({
    where: { pageId_period: { pageId: page.id, period: currentPeriod() } },
    select: { count: true },
  });

  if (isOverCap({ used: used?.count ?? 0, cap: conversationCap() })) {
    // The same two events the pinned branch yields, so the sheet renders this
    // through a path it already has. `intent` is untouched: a capped page
    // still offers the capture card, because the lead is what the owner is
    // here for and it is worth more when chat has stopped answering.
    const text =
      'We have answered a lot of questions this month and have reached the limit. ' +
      'The answers people ask for most are linked on this page, and you can still ' +
      'reach us using the links above.';
    yield { type: 'text', text };
    await prisma.message.create({
      data: { conversationId, role: 'ASSISTANT', content: text },
    });
    yield { type: 'done', conversationId, intent };
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

  yield { type: 'done', conversationId, intent };
}
