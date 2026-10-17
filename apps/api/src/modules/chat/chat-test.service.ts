import { isOverCap, normalizeClaim } from '@curios/core';
import { recordModelCall } from '@curios/db';
import { CHAT_MODEL } from '@curios/gateway';
import {
  ANSWER_PAGE_SELECT,
  answeredTopicFor,
  CAP_REACHED_REPLY,
  currentPeriod,
  MAX_HISTORY_MESSAGES,
  PageNotFoundError,
  promptFor,
  type ChatDeps,
} from './chat.service.js';

export interface TestTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** What the page would say, and where it came from: the owner's own answer, the facts, or the month's limit. */
export interface TestReply {
  reply: string;
  from: 'answer' | 'facts' | 'limit';
}

/**
 * The owner asking their own page a question, on Facts & sources.
 *
 * The same page read, the same pinned-answer match and the same prompt as the
 * live chat (`answer` in chat.service.ts), so what it says is what a visitor
 * would get. What it leaves out is everything a visitor's question does to
 * the owner's records:
 *
 * - No conversation and no message rows; the tester's history comes from the
 *   browser, and goes nowhere.
 * - No Question, QuestionAsk or Topic: the owner testing "Do you deliver?"
 *   must not show up on Questions as a customer asking it.
 * - No usage counter, so testing never spends the month's conversations.
 *   But it reads the counter: once a new visitor would get the limit's fixed
 *   reply, so does the tester (the Alerts board: "the tester shows the fixed
 *   reply too"), and no model is called.
 * - No `intent`, so the lead card is never offered.
 * - Works before the page is published: checking it is the point.
 *
 * The model calls it makes are recorded against the page like any other, so
 * their cost is visible; the per-account rate limit is what bounds them.
 */
export async function testAnswer(
  deps: Pick<ChatDeps, 'prisma' | 'gateway' | 'embedder' | 'log' | 'cap'>,
  input: { accountId: string; question: string; history: TestTurn[] },
): Promise<TestReply> {
  const { prisma, gateway } = deps;

  const page = await prisma.page.findFirst({
    where: { accountId: input.accountId },
    select: ANSWER_PAGE_SELECT,
  });
  if (!page) throw new PageNotFoundError();

  // The owner's own answer wins, as on the live chat: a wording already in
  // an answered topic, or (for a new wording) the same judge the chat uses.
  // Read-only here: the match is not saved as a new wording.
  const known = await prisma.question.findUnique({
    where: { pageId_normalizedQuestion: { pageId: page.id, normalizedQuestion: normalizeClaim(input.question) } },
    select: { topic: { select: { answer: true } } },
  });
  let pinned = known?.topic.answer ?? null;
  if (!known) {
    const topicId = await answeredTopicFor(deps, page, null, input.question);
    if (topicId) {
      pinned = (await prisma.topic.findUnique({ where: { id: topicId }, select: { answer: true } }))?.answer ?? null;
    }
  }
  if (pinned) return { reply: pinned, from: 'answer' };

  // As on the live chat, the limit falls where the spend starts: after the
  // owner's free answers. A new visitor's conversation would be one more on
  // the counter, so that is what is checked.
  const used = await prisma.usageCounter.findUnique({
    where: { pageId_period: { pageId: page.id, period: currentPeriod() } },
    select: { count: true },
  });
  if (isOverCap({ used: (used?.count ?? 0) + 1, cap: deps.cap })) return { reply: CAP_REACHED_REPLY, from: 'limit' };

  // The last turns, starting on the visitor's side as the model expects.
  const earlier = input.history.slice(-(MAX_HISTORY_MESSAGES - 1));
  while (earlier[0]?.role === 'assistant') earlier.shift();
  const previousUserTurn = earlier.filter((turn) => turn.role === 'user').at(-1)?.content ?? null;

  const prompt = await promptFor(deps, page, { question: input.question, previousUserTurn });

  let reply = '';
  try {
    for await (const event of gateway.chat({
      systemPrompt: prompt.systemPrompt,
      messages: [...earlier, { role: 'user', content: input.question }],
      cachePrompt: prompt.cachePrompt,
    })) {
      if (event.type === 'text') {
        reply += event.text;
      } else {
        await recordModelCall(prisma, {
          pageId: page.id,
          model: event.model,
          usage: event.usage,
          latencyMs: event.latencyMs,
          ok: true,
        });
      }
    }
  } catch (error) {
    // As on the live chat: a failed call still happened, so it is recorded.
    await recordModelCall(prisma, {
      pageId: page.id,
      model: CHAT_MODEL,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      latencyMs: 0,
      ok: false,
      errorCode: 'PROVIDER_UNAVAILABLE',
    });
    throw error;
  }

  return { reply, from: 'facts' };
}
