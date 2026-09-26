import { isOverCap, normalizeClaim, qualifies } from '@curios/core';
import { recordModelCall, type PrismaClient } from '@curios/db';
import { CHAT_MODEL, type Gateway } from '@curios/gateway';
import type { Embedder } from '@curios/embeddings';
import { buildSystemPrompt } from './prompt.js';
import { selectForQuestion } from './retrieval.js';
import { assignFaqSlug, type Log } from '../questions/faq-slug.js';

export type AnswerEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; conversationId: string; intent: { qualified: boolean } };

export interface ChatDeps {
  prisma: PrismaClient;
  gateway: Gateway;
  /**
   * The conversation cap in force, resolved ONCE by chatRoutes at process
   * boot and threaded through here rather than read per request.
   *
   * `conversationCap()` (from @curios/core) throws on a malformed
   * CONVERSATION_CAP_PER_MONTH. Calling it from inside this generator -- as
   * this file used to -- means that throw fires on some visitor's chat
   * request, long after boot, and lands in chat.routes.ts's catch-all as
   * "That answer failed. Try again." on every single turn: a silent,
   * total outage that looks like success from the operator's side, which is
   * the exact outcome cap.ts's own docstring says failing at boot avoids.
   * Resolving it once, at the same place `ANTHROPIC_API_KEY` is already
   * checked, makes a bad env var fail the deploy instead.
   *
   * Required, not optional: a test that forgets to supply it fails to
   * compile rather than silently never capping anything (`used > undefined`
   * is always `false`).
   */
  cap: number;
  /**
   * The embedder retrieval uses, or null for none.
   *
   * Required and explicitly nullable, for the reason `cap` above is required:
   * a deps object that simply omitted it would silently never retrieve, and
   * "every page sends every fact" is invisible from the outside -- it is a
   * roughly-twice-the-cost bug that looks exactly like success. `null` is a
   * legitimate value here -- a test that is not about retrieval -- but never
   * a production one: `chatRoutes` refuses to start when `OPENAI_API_KEY` is
   * unset, the same way it already refuses without `ANTHROPIC_API_KEY`, so a
   * running deployment never calls this function with no embedder. Writing
   * the field as required says so at the call site.
   */
  embedder: Embedder | null;
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

/**
 * The over-cap reply. Malay first, then English.
 *
 * prompt.ts's own rule for the model is "answer in the language the question
 * was asked in, including Malay, Manglish, or a mix" -- and this is the one
 * sentence where the product tells a Malaysian customer no on a surface that
 * makes no model call to honour that rule automatically. Register matches
 * this file's own pinned-answer fixtures ("Bermula RM95.", "RM95 sekilo."):
 * short, plain, colloquial, not a formal translation.
 *
 * Says only that the page's own links still work, never that a
 * most-asked-questions link exists: `/[handle]/faq` is gated on
 * `FAQ_MIN_ASKS` asks and an owner-written `PinnedAnswer`, so a page can be
 * over cap with zero FAQ entries. The page's other links render
 * unconditionally, so that much is true in every case.
 */
export const CAP_REACHED_REPLY =
  'Kami dah jawab banyak soalan bulan ini dan sampai had. Anda masih boleh ' +
  'hubungi kami terus melalui pautan di atas.\n\n' +
  "We've answered a lot of questions this month and reached the limit. " +
  'You can still reach us directly using the links on this page.';

export async function* answer(
  deps: ChatDeps,
  input: { handle: string; question: string; conversationId?: string },
): AsyncIterable<AnswerEvent> {
  const { prisma, gateway, cap } = deps;

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
  // what was sent to the model for an answer, not what the answer actually
  // used -- which is still not the same thing, so a signal drawn from it
  // would be no more reliable than one drawn from the whole fact list was.
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

  if (isOverCap({ used: used?.count ?? 0, cap })) {
    // The same two events the pinned branch yields, so the sheet renders this
    // through a path it already has. `intent` is untouched: a capped page
    // still offers the capture card, because the lead is what the owner is
    // here for and it is worth more when chat has stopped answering.
    //
    // Logged at `info`, not `error`: the cap firing is this control working
    // exactly as designed, not a failure needing attention. Without this
    // line the only way to learn a page hit its cap is the manual SQL in
    // manual-verification-caps.md's checks 6 and 7 -- a spend control whose
    // stated failure mode is being indistinguishable from success should not
    // also be invisible when it succeeds.
    deps.log?.info?.(
      { pageId: page.id, handle: input.handle, used: used?.count ?? 0, cap },
      'conversation cap reached; chat degraded to the fixed reply',
    );
    yield { type: 'text', text: CAP_REACHED_REPLY };
    await prisma.message.create({
      data: { conversationId, role: 'ASSISTANT', content: CAP_REACHED_REPLY },
    });
    yield { type: 'done', conversationId, intent };
    return;
  }

  // The visitor's own previous turn, for a follow-up like "yang coklat pula?"
  // that means nothing on its own. `history` already ends with the question
  // being asked now -- it was written above -- so the one before it is at -2.
  const previousUserTurn =
    history.filter((message) => message.role === 'USER').at(-2)?.content ?? null;

  // What this question needs, or everything, and always a correct answer
  // either way. See retrieval.ts for the order of the checks and why it is
  // the order.
  const selection = await selectForQuestion(
    { prisma, embedder: deps.embedder, log: deps.log },
    { pageId: page.id, facts: page.facts, question: input.question, previousUserTurn },
  );

  const systemPrompt = buildSystemPrompt({
    displayName: page.displayName,
    facts: selection.facts,
    neverSay: page.neverSay.map((n) => n.phrase),
  });

  let text = '';
  try {
    // Cached only in fallback, where the prefix is the page's whole fact list
    // and is the same for every visitor between owner edits. In retrieval mode
    // the prefix is built for this one question, so a cache entry would be
    // written at a 25% premium and read by nobody.
    for await (const event of gateway.chat({
      systemPrompt,
      messages,
      cachePrompt: selection.mode === 'fallback',
    })) {
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
      // The facts this answer was actually built from. Until retrieval it was
      // every verified fact on the page, which made the column true of every
      // message ever sent and useless as a signal -- see the `intent` comment
      // above, which still holds: qualification is computed from the visitor's
      // turns, never from this.
      citedFactIds: selection.facts.map((fact) => fact.id),
    },
  });

  yield { type: 'done', conversationId, intent };
}
