# Slice 4 Plan 1 — Conversations Become Real

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor can ask a follow-up question and the answer knows what came before, which is what makes a transcript worth sending to an owner.

**Architecture:** `POST /chat/:handle` gains an optional `conversationId`. Absent means create, present means append after checking the conversation belongs to this page. The gateway's `chat()` takes a bounded message list instead of one question. The sheet keeps a thread and grows a composer. Nothing generative changes: same model, same prompt builder, same streaming contract.

**Tech Stack:** TypeScript, Fastify, Prisma, Anthropic SDK (Haiku), React 19, Next 15, vitest + Testing Library.

**Spec:** `devDocs/slice-4-build-spec.md`. Read its "prerequisite nobody listed" section before Task 1 — it explains why a plan that ships nothing a visitor would name is the first half of this slice.

## Global Constraints

- **The usage meter counts conversations, not messages.** `UsageCounter` increments when a conversation is **created** and never when one is appended to. This is currently true by accident because every call creates a conversation; after Task 1 it is a rule. It is the meter the paid plan is priced against, and Task 1 tests it directly.
- **Nothing generative runs inside an HTTP request** beyond the streamed answer that already does.
- **An unpublished page never answers.** The existing `published: true` filter stays; a `conversationId` must never become a way around it.
- **Only verified facts reach a visitor.** Unchanged, and not this plan's business, but do not widen the fact select while editing near it.
- **Never log a full phone number.** Not relevant until plan 2, but the chat log lines this plan touches are the ones that would carry a transcript.
- **Copy voice:** sentence case, plain, active verbs. Errors explain and instruct, never apologise.
- **Design system:** every colour is a token in `packages/ui/src/tokens.css`; the type scale is `11 / 12.5 / 14 / 17 / 22 / 32`. `design-rules.test.ts` fails a hex or a seventh size. It does **not** catch `rgb()`.
- **Motion:** the sheet already owns the product's one orchestrated moment. New messages get the 8px rise that is already budgeted; nothing else animates.
- Node 22, ESM. **Every relative import ends in `.js`**, even from `.ts`/`.tsx`.
- Gates from the repo root: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `apps/api` and `packages/db-read` tests need Postgres. `docker compose up -d`, and after any restart of the `tmpfs` test container: `cd packages/db && DATABASE_URL="$DATABASE_URL_TEST" pnpm exec prisma migrate deploy`, then `docker exec -i curios-postgres-test psql -U curios -d curios_test < packages/db/prisma/sql/readonly-role.sql`.

---

### Task 1: The service threads a conversation

The whole change in one place, with the meter invariant nailed down before anything else can rot it.

**Files:**
- Modify: `packages/gateway/src/types.ts` (`ChatInput`)
- Modify: `packages/gateway/src/anthropic.gateway.ts:109-120` (`chat`)
- Modify: `apps/api/src/modules/chat/chat.service.ts`
- Test: `apps/api/src/modules/chat/chat.service.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `ChatInput` becomes `{ systemPrompt: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> }`.
  - `answer(deps, input)` where `input` is `{ handle: string; question: string; conversationId?: string }`.
  - `MAX_HISTORY_MESSAGES = 10`, exported from `chat.service.ts`.
  - A new `ConversationNotFoundError` — `statusCode = 404`, `code = 'CONVERSATION_NOT_FOUND'`.

- [x] **Step 1: Write the failing tests**

Add to `apps/api/src/modules/chat/chat.service.test.ts`. Follow the file's existing fixture style; it already stubs `Gateway`.

```ts
describe('threading a conversation', () => {
  it('creates a conversation when given no id, and returns it', async () => {
    const events = await collect(answer(deps, { handle: 'nadia', question: 'harga?' }));
    const done = events.find((e) => e.type === 'done');

    expect(done).toMatchObject({ type: 'done', conversationId: expect.any(String) });
  });

  it('appends to the conversation it is given rather than starting another', async () => {
    const first = await collect(answer(deps, { handle: 'nadia', question: 'harga kek?' }));
    const conversationId = (first.at(-1) as { conversationId: string }).conversationId;

    await collect(answer(deps, { handle: 'nadia', question: 'ada delivery?', conversationId }));

    // Four messages in one conversation, not two conversations of two.
    expect(await prisma.conversation.count()).toBe(1);
    expect(await prisma.message.count({ where: { conversationId } })).toBe(4);
  });

  it('counts one usage unit for a whole conversation, however chatty', async () => {
    // THE invariant. chat.service.ts has always claimed "the meter counts
    // conversations, not messages, so a chatty visitor costs the owner one
    // unit" -- true only by accident while every call made a conversation.
    // This is the meter the paid plan is priced against.
    const first = await collect(answer(deps, { handle: 'nadia', question: 'one' }));
    const conversationId = (first.at(-1) as { conversationId: string }).conversationId;

    await collect(answer(deps, { handle: 'nadia', question: 'two', conversationId }));
    await collect(answer(deps, { handle: 'nadia', question: 'three', conversationId }));

    const counter = await prisma.usageCounter.findFirstOrThrow({ where: { pageId } });
    expect(counter.count).toBe(1);
  });

  it('sends the earlier turns to the model, so a follow-up has context', async () => {
    const first = await collect(answer(deps, { handle: 'nadia', question: 'harga kek?' }));
    const conversationId = (first.at(-1) as { conversationId: string }).conversationId;

    await collect(answer(deps, { handle: 'nadia', question: 'ada delivery?', conversationId }));

    // The stub records what it was handed. Without history the model answers
    // "ada delivery?" with no idea what "delivery" refers to.
    const sent = messages();
    expect(sent.map((m) => m.content)).toEqual([
      'harga kek?',
      'an answer',
      'ada delivery?',
    ]);
  });

  it('bounds the history it sends, so a long thread cannot grow the prompt forever', async () => {
    const first = await collect(answer(deps, { handle: 'nadia', question: 'q0' }));
    const conversationId = (first.at(-1) as { conversationId: string }).conversationId;

    for (let i = 1; i <= 8; i += 1) {
      await collect(answer(deps, { handle: 'nadia', question: `q${i}`, conversationId }));
    }

    const sent = messages();
    expect(sent.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    // The most recent turn is always present; it is the oldest that falls off.
    expect(sent.at(-1)?.content).toBe('q8');
  });

  it('refuses a conversation belonging to another page', async () => {
    // A conversation id is a bearer token for a thread. Without the page
    // scope, one page's visitor could append to another page's conversation
    // and read its answers back.
    // This file's beforeEach creates one account and page. A second page is
    // needed here and nowhere else, so it is created inline rather than
    // widening the shared fixture for one test.
    const other = await prisma.account.create({
      data: {
        email: 'other@example.com',
        pages: { create: { handle: 'someoneelse', skeleton: 'someoneelse', displayName: 'Other', published: true } },
      },
      include: { pages: true },
    });
    const theirs = await prisma.conversation.create({
      data: { pageId: other.pages[0]?.id ?? '' },
    });

    await expect(
      collect(answer(deps, { handle: 'nadia', question: 'hi', conversationId: theirs.id })),
    ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
  });

  it('refuses a conversation id that does not exist', async () => {
    await expect(
      collect(answer(deps, { handle: 'nadia', question: 'hi', conversationId: 'nope' })),
    ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
  });
});
```

This file already has `gatewayCapturingPrompt()`, which records the `systemPrompt` it was
handed and returns `{ gateway, prompt }`. Add its sibling in the same shape rather than a
new pattern:

```ts
/** Records the exact message list the gateway received, for asserting on the thread. */
function gatewayCapturingMessages(): { gateway: Gateway; messages: () => ChatMessage[] } {
  let captured: ChatMessage[] = [];
  const gateway: Gateway = {
    extract: vi.fn(),
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
```

and import `ChatMessage` from `@curios/gateway`. In the two tests that assert on the thread,
build `deps` with this gateway and read `messages()` instead of `gateway.lastChatInput`. The
other tests keep using `gatewaySaying(...)`, which is unaffected by this change beyond its
`chat` signature.

- [x] **Step 2: Run to verify RED**

Run: `pnpm --filter @curios/api test chat.service`
Expected: FAIL — `conversationId` is not a property of the input, and `gatewayCapturingMessages` does not compile because `ChatInput` still has `question` rather than `messages`.

- [x] **Step 3: Widen the gateway's input**

`packages/gateway/src/types.ts`:

```ts
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatInput {
  systemPrompt: string;
  /**
   * The conversation so far, oldest first, ending with the question being
   * asked now. Bounded by the caller -- this interface does not know what a
   * sensible window is, and the caller does.
   */
  messages: ChatMessage[];
}
```

Export `ChatMessage` from `packages/gateway/src/index.ts` beside the other types.

`packages/gateway/src/anthropic.gateway.ts`, in `chat`:

```ts
    async *chat({ systemPrompt, messages }: ChatInput): AsyncIterable<ChatEvent> {
      const started = Date.now();

      // Haiku 4.5 predates adaptive thinking and effort: pass neither.
      // cache_control sits at the end of the system prompt so the stable fact
      // block is cached and the volatile conversation lands after the
      // breakpoint -- which is exactly why history goes in `messages` and is
      // never appended to the system prompt.
      const stream = client.messages.stream({
        model: CHAT_MODEL,
        max_tokens: 1024,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
```

The rest of the method is unchanged.

- [x] **Step 4: Thread the service**

In `apps/api/src/modules/chat/chat.service.ts`:

```ts
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
```

Replace the unconditional create with a resolve-or-create, and move the meter so it fires only on creation:

```ts
  // Resolved before anything is written. A conversation id is a bearer token
  // for a thread, so it is scoped to THIS page in the query rather than
  // checked after the read -- the same shape as every other ownership check
  // in this codebase.
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
  // chatty visitor costs the owner one unit -- which was true by accident
  // while every call created a conversation and is a rule now. Atomic upsert:
  // two visitors opening the sheet at once on a popular page would otherwise
  // race a read-then-write.
  if (isNew) {
    await prisma.usageCounter.upsert({
      where: { pageId_period: { pageId: page.id, period: currentPeriod() } },
      create: { pageId: page.id, period: currentPeriod(), count: 1 },
      update: { count: { increment: 1 } },
    });
  }
```

Then replace every remaining `conversation.id` in the function with `conversationId`, write the user message as before, and build the model's view of the thread **after** that write so the current question is included by the same code path as the history:

```ts
  await prisma.message.create({
    data: { conversationId, role: 'USER', content: input.question },
  });

  // Read back rather than concatenated in memory: one source of truth for
  // what the thread contains, and the slice-4 transcript will read the same
  // rows. Oldest first, then the tail taken, so it is the oldest turns that
  // fall off a long conversation.
  const history = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });
  const messages = history.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
    role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }));
```

and pass `{ systemPrompt, messages }` to `gateway.chat`.

**Leave the pinned-answer branch alone** except for the `conversationId` rename. It answers from a stored string, spends no tokens, and has no reason to see history.

- [x] **Step 5: Run to verify GREEN**

Run: `pnpm --filter @curios/api test chat.service && pnpm --filter @curios/gateway test`
Expected: PASS. A gateway failure means its own test still builds a `ChatInput` with `question`.

- [x] **Step 6: Commit**

```bash
git add apps/api packages/gateway
git commit -m "feat(api): a conversation that remembers the last thing you asked"
```

---

### Task 2: The route accepts an id and reports a dead one

**Files:**
- Modify: `apps/api/src/modules/chat/chat.routes.ts:16` and its handler
- Modify: `apps/api/src/plugins/errors.ts` (`DOMAIN_ERROR_CODES`)
- **Create**: `apps/api/src/modules/chat/chat.routes.test.ts` — checked, it does not exist. The chat route has never had a test of its own; `chat.service.test.ts` covers the service and `prompt.test.ts` the prompt. So this task writes the file, including its setup.

**Interfaces:**
- Consumes: `answer` and `ConversationNotFoundError` from Task 1.
- Produces: `POST /chat/:handle` accepting `{ question: string; conversationId?: string }`.

- [x] **Step 1: Write the failing test**

Create `apps/api/src/modules/chat/chat.routes.test.ts`. It needs a real app and a fresh
source address per request, both of which `ingest.authz.test.ts` already demonstrates —
follow that file for the `buildApp`/`beforeAll` shape and copy its address helper, which
exists because the chat route carries a per-IP limiter that a burst of test requests would
otherwise trip:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';

let app: FastifyInstance;

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  // A published page with one verified fact, so the route has something to
  // answer from. ANTHROPIC_API_KEY must be set for chatRoutes to register at
  // all, and these tests hit the real gateway construction path but never a
  // real model -- every assertion here is about the envelope, not the answer.
  await app.prisma.account.create({
    data: {
      email: `chat-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle: 'nadia',
          skeleton: 'nadia',
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
```

**If these tests would spend real model tokens, stop and say so rather than running them.**
`chatRoutes` builds its gateway from `ANTHROPIC_API_KEY` at registration time with no
injection seam, unlike `ingestRoutes`. If that turns out to be the case, the honest move is
to add an override to `AppOverrides` the way `ingest` has one — that is a small, real
improvement to a route that is currently untestable without a network, and it belongs in
this task.

Then the tests:

```ts
  it('carries a conversation id through two requests', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/chat/nadia',
      remoteAddress: from(),
      payload: { question: 'harga kek?' },
    });
    const conversationId = doneEventOf(first.payload).conversationId;

    const second = await app.inject({
      method: 'POST',
      url: '/chat/nadia',
      remoteAddress: from(),
      payload: { question: 'ada delivery?', conversationId },
    });

    expect(doneEventOf(second.payload).conversationId).toBe(conversationId);
  });

  it('reports a dead conversation inside the stream, not as a status code', async () => {
    // Headers are already sent by the time the service can throw, so this can
    // never be a 404 on the wire. It has to arrive as an error event, and the
    // visitor-facing message must say what to do next.
    const res = await app.inject({
      method: 'POST',
      url: '/chat/nadia',
      remoteAddress: from(),
      payload: { question: 'hi', conversationId: 'nope' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('"type":"error"');
  });
```

with a helper beside the file's existing ones:

```ts
function doneEventOf(payload: string): { conversationId: string } {
  const line = payload
    .split('\n\n')
    .filter((s) => s.startsWith('data: '))
    .map((s) => JSON.parse(s.slice(6)) as { type: string; conversationId?: string })
    .find((e) => e.type === 'done');
  if (!line?.conversationId) throw new Error(`no done event in: ${payload}`);
  return { conversationId: line.conversationId };
}
```

- [x] **Step 2: Run to verify RED**

Run: `pnpm --filter @curios/api test chat.routes`
Expected: FAIL — the body schema rejects the unknown `conversationId` key, or the second request starts a new conversation.

- [x] **Step 3: Widen the route**

`apps/api/src/modules/chat/chat.routes.ts`:

```ts
        body: z.object({
          question: z.string().min(1).max(500),
          // Capped because it becomes a database lookup key. A cuid is 25
          // characters; the ceiling is for anything that is not one.
          conversationId: z.string().min(1).max(64).optional(),
        }),
```

and pass it through:

```ts
      const stream = answer(
        { prisma: app.prisma, gateway },
        {
          handle: request.params.handle,
          question: request.body.question,
          conversationId: request.body.conversationId,
        },
      );
```

Add `'CONVERSATION_NOT_FOUND'` to `DOMAIN_ERROR_CODES` in `apps/api/src/plugins/errors.ts`, beside `PAGE_NOT_FOUND`, with a comment saying it reaches a client through the SSE error event rather than a status code — the allow-list is the one place that answers "which codes may reach a client", and a code that skips it is rewritten to `INTERNAL_ERROR`.

**The existing catch already writes a generic message into the stream.** That is correct and stays: the visitor sees *"That answer failed. Try again."* either way. The code matters for the client's own decision in Task 3, so also include the code in the error event:

```ts
        const code =
          error instanceof Error && 'code' in error && typeof error.code === 'string'
            ? error.code
            : undefined;
        reply.raw.write(
          `data: ${JSON.stringify({
            type: 'error',
            code,
            message: 'That answer failed. Try again.',
          })}\n\n`,
        );
```

- [x] **Step 4: Run to verify GREEN**

Run: `pnpm --filter @curios/api test chat`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): the chat route carries a thread"
```

---

### Task 3: The sheet becomes a thread

**Files:**
- Modify: `packages/ui/src/sheet/AskSheet.tsx`, `AskSheet.module.css`, `AskSheet.test.tsx`
- Create: `packages/ui/src/sheet/Composer.tsx`, `Composer.module.css`
- Modify: `apps/web/app/[handle]/ask.tsx`

**Interfaces:**
- Consumes: `Button`, `Field` from slice 3.
- Produces: `<AskSheet seed onClose onAsk />`, where

```ts
onAsk: (question: string, conversationId: string | null) => Promise<ReadableStream<Uint8Array> | null>
```

The sheet reads the conversation id back off the `done` event it already parses, rather
than from a second return value. The `done` event carries it, the parser already sees it,
and a separate channel would be a second place for one fact to live and drift.

- [x] **Step 1: Write the failing tests**

Add to `packages/ui/src/sheet/AskSheet.test.tsx`:

```tsx
  it('sends no conversation id on the first question and the returned one after', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValueOnce(
        streamOf('data: {"type":"text","text":"RM45"}\n\n', 'data: {"type":"done","conversationId":"c1"}\n\n'),
      )
      .mockResolvedValueOnce(streamOf('data: {"type":"done","conversationId":"c1"}\n\n'));

    render(<AskSheet seed="harga?" onClose={vi.fn()} onAsk={onAsk} />);
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith('harga?', null));

    await userEvent.type(screen.getByLabelText(/ask/i), 'ada delivery?');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onAsk).toHaveBeenLastCalledWith('ada delivery?', 'c1'));
  });

  it('keeps every turn on screen, because the thread is the point', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValueOnce(
        streamOf('data: {"type":"text","text":"RM45 sekilo"}\n\n', 'data: {"type":"done","conversationId":"c1"}\n\n'),
      )
      .mockResolvedValueOnce(
        streamOf('data: {"type":"text","text":"Ya, boleh"}\n\n', 'data: {"type":"done","conversationId":"c1"}\n\n'),
      );

    render(<AskSheet seed="harga?" onClose={vi.fn()} onAsk={onAsk} />);
    await waitFor(() => expect(screen.getByText(/RM45 sekilo/)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/ask/i), 'ada delivery?');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    // The first answer is still there. A sheet that replaces it has no
    // transcript to send an owner, which is the whole reason for this plan.
    await waitFor(() => expect(screen.getByText(/Ya, boleh/)).toBeInTheDocument());
    expect(screen.getByText(/RM45 sekilo/)).toBeInTheDocument();
    expect(screen.getByText('harga?')).toBeInTheDocument();
    expect(screen.getByText('ada delivery?')).toBeInTheDocument();
  });

  it('will not send an empty question', async () => {
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done","conversationId":"c1"}\n\n'));
    render(<AskSheet seed="q" onClose={vi.fn()} onAsk={onAsk} />);
    await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it('does not send while an answer is still streaming', async () => {
    // Two overlapping streams would interleave their text into one bubble.
    const onAsk = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<AskSheet seed="q" onClose={vi.fn()} onAsk={onAsk} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeDisabled());
  });

  it('starts a fresh thread when the conversation has expired', async () => {
    // CONVERSATION_NOT_FOUND is the one error the client acts on rather than
    // only displaying: the stored id is dead, so the next question must not
    // carry it or every subsequent turn fails too.
    const onAsk = vi
      .fn()
      .mockResolvedValueOnce(streamOf('data: {"type":"done","conversationId":"c1"}\n\n'))
      .mockResolvedValueOnce(
        streamOf('data: {"type":"error","code":"CONVERSATION_NOT_FOUND","message":"That answer failed. Try again."}\n\n'),
      )
      .mockResolvedValueOnce(streamOf('data: {"type":"done","conversationId":"c2"}\n\n'));

    render(<AskSheet seed="q" onClose={vi.fn()} onAsk={onAsk} />);
    await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByLabelText(/ask/i), 'two');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(2));

    await userEvent.type(screen.getByLabelText(/ask/i), 'three');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(onAsk).toHaveBeenLastCalledWith('three', null));
  });
```

- [x] **Step 2: Run to verify RED**

Run: `pnpm --filter @curios/ui test sheet`
Expected: FAIL — `onAsk` is called with one argument and there is no composer to type into.

- [x] **Step 3: Rebuild the sheet around a thread**

Replace `AskSheet`'s single `answer` string with a turn list, and extract the SSE reading into a helper inside the same file so the streaming loop is written once and used by both the seed question and every follow-up:

```tsx
interface Turn {
  question: string;
  answer: string;
}
```

State: `turns: Turn[]`, `draft: string`, `busy: boolean`, `conversationId: string | null`.

The streaming loop is the one already in this file — **keep its two comments verbatim**, the one about `{ stream: true }` holding back a split multi-byte sequence and the one about the tail of `split('\n\n')` being carried over. Both were paid for once already. Extend it to:

- set `conversationId` from a `done` event's `conversationId`;
- on an `error` event whose `code` is `CONVERSATION_NOT_FOUND`, clear `conversationId` to `null` so the next question starts a thread instead of failing forever;
- append streamed text to the **last** turn's answer rather than to a single string.

The composer is a labelled input and a Send button, disabled while `busy` or while the draft is blank. The label is visible, not a placeholder: FRONTEND.md bans blank prompt boxes, and a placeholder disappears the moment someone types.

Keep the focus trap, the escape handler, `role="dialog"`, `aria-modal`, and the polite live region exactly as they are. The live region now announces the newest answer.

- [x] **Step 4: Wire the wrapper**

`apps/web/app/[handle]/ask.tsx` — `onAsk` gains the second argument and sends it:

```tsx
  const onAsk = useCallback(
    async (question: string, conversationId: string | null) => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/chat/${handle}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // Omitted rather than sent as null: the route's schema marks it
          // optional, and `null` is not `undefined` to zod.
          body: JSON.stringify(conversationId === null ? { question } : { question, conversationId }),
        },
      );
      if (!response.ok) return null;
      return response.body;
    },
    [handle],
  );
```

- [x] **Step 5: Run the tests and the budget**

Run: `pnpm --filter @curios/ui test && pnpm --filter @curios/web test && pnpm --filter @curios/web build && pnpm --filter @curios/web test budget`

Expected: PASS. **The budget test is the one to watch** — the sheet just grew a thread and a composer, and it is inlined in the route chunk rather than split out. If it fails, report the number rather than raising the ceiling.

- [x] **Step 6: Commit**

```bash
git add packages/ui apps/web
git commit -m "feat(ui): the sheet keeps the conversation"
```

---

### Task 4: Gates, and a real conversation

- [x] **Step 1: All four gates**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build --force
```

- [x] **Step 2: Hold a conversation**

Start the stack, open `/nadia`, tap the bar, and ask three questions where the third only makes sense given the first two — for example *"berapa harga kek butter?"*, then *"yang 2kg?"*, then *"boleh hantar ke Klang?"*.

Check and write down:

1. The second answer understands what "yang 2kg" refers to. If it does not, history is not reaching the model.
2. Every turn stays on screen.
3. `select count(*) from "Conversation"` grew by one, not three.
4. `select count from "UsageCounter"` grew by one, not three.

Points 3 and 4 are the invariant, checked against the database rather than the screen.

```bash
docker exec -i curios-postgres psql -U curios -d curios -c 'SELECT count(*) FROM "Conversation";'
docker exec -i curios-postgres psql -U curios -d curios -c 'SELECT period, count FROM "UsageCounter";'
```

**Report what you find, including anything you did not run.**

- [x] **Step 3: Record the result and commit**

Append what was checked and what was found to this plan, then commit.

---

## Self-review

**Spec coverage.** The spec's plan-1 half is "the API's `conversationId`, the gateway's `messages[]`, the usage-meter invariant, and the sheet's thread and composer." Service and gateway are Task 1, the route is Task 2, the sheet is Task 3, and the meter invariant has its own test in Task 1 plus a database check in Task 4 — deliberately twice, because it is the one thing here that a passing suite could let rot silently while costing an owner money.

**Placeholder scan.** Task 3 Step 3 describes the sheet's new state and loop rather than pasting the whole component. That is the same trade plan 1 of slice 3 made for the same reason: the streaming loop is being *extended*, not written, and a full copy in the plan is a second version that drifts from the original. Six tests pin the behaviour that matters.

**Type consistency.** `ChatInput.messages` is `ChatMessage[]` in Task 1 and nothing redefines it. `answer`'s third input field is `conversationId?: string` throughout. The sheet's `onAsk` is `(question: string, conversationId: string | null) => Promise<ReadableStream<Uint8Array> | null>` in both Task 3's interface block and the wrapper that implements it — note `null` on the client where the service takes `undefined`, because `JSON.stringify` omits the key entirely rather than sending `null`.

**One thing deliberately not built.** Conversation continuity across a page reload. The id lives in React state, so closing the sheet and reopening it starts a new thread. Persisting it in `sessionStorage` is three lines and a decision about how long a stranger's conversation should follow them around, and the transcript this slice needs works without it.

**What no test here covers.** Whether the model actually uses the history well — whether "yang 2kg" resolves to the right cake. That needs a real model and a person reading the answer, and it is Task 4 Step 2.


---

## Execution record

**Gates:** lint, typecheck, build all pass. **520 tests** across 8 packages — core 121,
api 180, web 76, ui 55, workers 40, db-read 25, gateway 15, db 8.

### The conversation, held against the real model

Three turns through `POST /chat/nadia` with Haiku answering:

| Turn | Asked | Answered |
|---|---|---|
| 1 | *berapa harga kek butter?* | "Kek butter kami ada dua saiz: 1kg RM95, 2kg RM160…" |
| 2 | *yang 2kg tu ada perisa pandan?* | "Saya tidak pasti sama ada **kek butter 2kg** tersedia… Biar saya tanya Nadia dulu." |
| 3 | *boleh hantar ke Klang tak?* | "Boleh! Kami hantar ke kawasan Klang Valley…" |

**Turn 2 is the whole point.** *"yang 2kg tu"* names nothing on its own; the model resolved
it to "kek butter 2kg" from the previous turn, which it could not have done without the
history. It then refused rather than guessing at the flavour, which is the
tuned-towards-refusal behaviour BACKEND.md asks for, arriving for free.

**The invariants, checked against the database rather than the screen:**

| | Before | After three turns |
|---|---|---|
| `Conversation` rows | 8 | **9** |
| `sum(UsageCounter.count)` | 8 | **9** |

One conversation, one unit. Six `Message` rows in the thread, alternating.

### What execution found

**The route chunk grew from 7.16kB to 9.08kB** against the 40kB budget, which the sheet's
thread and composer account for.

**The conversation id had to be a ref, not state.** The streaming loop reads it after
awaits, so a state value captured at render time is the one from before the previous answer
finished — the second question would carry no id and silently open a third thread. Caught
while writing the component rather than by a test, which would have shown it as a puzzling
extra conversation row.

**`chatRoutes` had no injection seam**, which is why it had never had a test file. Adding
`ChatRouteOptions.gateway` was a prerequisite to testing the route at all, not a
convenience.

**Two things the new tests got wrong about themselves.** Every `apps/api` suite shares one
database and `chat.service.test.ts` already owns the handle `nadia`, so the route test
generates its own. And `recordModelCall` prices every call from a table and throws on a
model name it does not know, so a stub calling itself `'stub'` failed the request *after*
the answer had streamed — which looked exactly like a threading bug until the error was
printed.

### Not done

Conversation continuity across a page reload: the id lives in React state, so closing the
sheet and reopening it starts a new thread. Named in the plan as deliberately out, and
still is.

Nobody has used the sheet in a browser. The three turns above went through `curl` against
the real API and the real model; the composer, the thread rendering and the focus behaviour
are covered by unit tests and have not been seen by a person.
