# Slice 5 Plan 1 — Questions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner opens `/app/questions`, sees what customers actually ask ranked by how often, writes an answer to the top one, and the next person to ask it gets those exact words.

**Architecture:** Every visitor question is upserted into a `Question` row keyed on `(pageId, normalizedQuestion)` from inside the chat path, incrementing an ask count. The screen reads that through `packages/db-read` like every other owner screen. Answering writes a `PinnedAnswer` on the same key, which `chat.service.ts` already checks before calling the model.

**Tech Stack:** TypeScript, Fastify, Prisma, React 19, Next 15 App Router, vitest + Testing Library.

**Spec:** `devDocs/slice-5-build-spec.md`. Read its "The Question model, and the sentence it does not implement" section before Task 1 — the reasons refusal detection is absent are the reasons this plan looks the way it does.

## Global Constraints

- **`normalizeClaim` is the one cluster key**, used here for the third time — it already keys `Fact.normalizedClaim` and `PinnedAnswer.normalizedQuestion`. Never write a second normaliser; a question, its pinned answer, and the fact that might cover it must agree on "the same question" by construction.
- **Nothing generative runs inside an HTTP request.** Logging a question is one upsert, no model call.
- **The usage meter counts conversations, not messages.** Do not touch it, and do not let question logging near it.
- **A pinned answer wins over model output, at zero tokens.** That is why the writeback is worth anything; do not weaken it.
- **`apps/web` reads through `packages/db-read` as `curios_readonly`** and cannot write. Every mutation goes to `apps/api` via `apiFetch`.
- **Only the owner's own rows.** Scope inside the query, never filter after the read — the shape every ownership check in this codebase uses.
- **Copy voice:** sentence case, plain, active verbs. Errors explain and instruct, never apologise. **Empty states are instructions, not moods.**
- **Dashboard rules from FRONTEND.md:** one primary action per screen. On this screen it is "Answer this".
- **Design system:** every colour a token in `packages/ui/src/tokens.css`; the type scale is `11 / 12.5 / 14 / 17 / 22 / 32`. `design-rules.test.ts` fails a hex or a seventh size and does **not** catch `rgb()`.
- Node 22, ESM. **Every relative import ends in `.js`**, even from `.ts`/`.tsx`.
- Gates from the repo root: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `apps/api` and `packages/db-read` tests need Postgres. `docker compose up -d`, and after any restart of the `tmpfs` test container: `cd packages/db && DATABASE_URL="$DATABASE_URL_TEST" pnpm exec prisma migrate deploy`, then `docker exec -i curios-postgres-test psql -U curios -d curios_test < packages/db/prisma/sql/readonly-role.sql`.

---

### Task 1: The model, and the row that counts

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: a migration under `packages/db/prisma/migrations/`
- Modify: `apps/api/src/modules/chat/chat.service.ts`
- Modify: `apps/api/src/modules/chat/chat.service.test.ts`

**Interfaces:**
- Consumes: `normalizeClaim` from `@curios/core`.
- Produces: a `Question` row per `(pageId, normalizedQuestion)`, with `text`, `askCount`, `answered`, `lastAskedAt`.

- [ ] **Step 1: Add the model**

`packages/db/prisma/schema.prisma`:

```prisma
model Question {
  id                 String   @id @default(cuid())
  pageId             String
  page               Page     @relation(fields: [pageId], references: [id], onDelete: Cascade)
  /// The first phrasing seen, kept verbatim so the owner reads what a customer typed.
  text               String
  /// normalizeClaim(text). The cluster key, and the same key PinnedAnswer uses.
  normalizedQuestion String
  askCount           Int      @default(1)
  /// True once the owner has written a pinned answer. NOT whether the model coped
  /// -- see the refusal rule in BACKEND.md for why that is not detected.
  answered           Boolean  @default(false)
  firstAskedAt       DateTime @default(now())
  lastAskedAt        DateTime @default(now())

  @@unique([pageId, normalizedQuestion])
  // The screen's only ordering: most asked first, then most recent.
  @@index([pageId, askCount])
}
```

Add `questions Question[]` to `Page`.

Then, from `packages/db`:

```bash
DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | head -1 | cut -d= -f2- | tr -d '"')" npx prisma migrate dev --name question
DATABASE_URL="$(grep '^DATABASE_URL_TEST=' ../../.env | head -1 | cut -d= -f2- | tr -d '"')" npx prisma migrate deploy
```

- [ ] **Step 2: Write the failing tests**

Add to `apps/api/src/modules/chat/chat.service.test.ts`, inside the `threading a conversation` describe:

```ts
  it('logs the question a visitor asked', async () => {
    await ask(depsSaying(), 'berapa harga kek butter?');

    const question = await prisma.question.findFirstOrThrow({});
    // Verbatim, not normalised: the owner should read what a customer typed.
    expect(question.text).toBe('berapa harga kek butter?');
    expect(question.askCount).toBe(1);
    expect(question.answered).toBe(false);
  });

  it('counts two phrasings of one question as one question', async () => {
    // The whole point of clustering. normalizeClaim strips punctuation and
    // case, so these are the same row and the count is what tells an owner
    // this is a real gap rather than one person being curious.
    const deps = depsSaying();
    await ask(deps, 'Berapa harga kek butter?');
    await ask(deps, 'berapa harga kek butter');

    const questions = await prisma.question.findMany({});
    expect(questions).toHaveLength(1);
    expect(questions[0]?.askCount).toBe(2);
  });

  it('keeps genuinely different questions apart', async () => {
    const deps = depsSaying();
    await ask(deps, 'berapa harga kek butter?');
    await ask(deps, 'buka pukul berapa?');

    expect(await prisma.question.count()).toBe(2);
  });

  it('counts across conversations, not just within one', async () => {
    // Two visitors on different days asking the same thing is the signal.
    // Counting only within a conversation would report every gap as askCount 1.
    const deps = depsSaying();
    await ask(deps, 'ada delivery?');
    await ask(deps, 'ada delivery?');

    const question = await prisma.question.findFirstOrThrow({});
    expect(question.askCount).toBe(2);
    expect(await prisma.conversation.count()).toBe(2);
  });

  it('logs a question the pinned answer handled, too', async () => {
    // A pinned answer means the owner already answered this once. The row
    // still has to exist and still has to count, or the screen would show a
    // question dropping off the list the moment it gets popular enough to pin.
    await prisma.pinnedAnswer.create({
      data: {
        pageId,
        question: 'berapa harga?',
        normalizedQuestion: 'berapa harga',
        answer: 'RM95.',
      },
    });

    await ask(depsSaying(), 'berapa harga?');

    const question = await prisma.question.findFirstOrThrow({});
    expect(question.askCount).toBe(1);
  });

  it('keeps the questions of one page out of another', async () => {
    const other = await prisma.account.create({
      data: {
        email: 'other@example.com',
        pages: {
          create: { handle: 'other', skeleton: 'other', displayName: 'Other', published: true },
        },
      },
      include: { pages: true },
    });

    await ask(depsSaying(), 'berapa harga?');
    await collect(
      answer(depsSaying(), { handle: 'other', question: 'berapa harga?' }),
    );

    // Same normalised text, two pages, two rows. The unique index is on the
    // pair, and a global one would merge every shop's questions into one list.
    expect(await prisma.question.count()).toBe(2);
    expect(other.pages).toHaveLength(1);
  });
```

`pageId` is already a module-level binding in this file's `beforeEach`; if it is not, read it there rather than re-querying.

- [ ] **Step 3: Run to verify RED**

Run: `pnpm --filter @curios/api test chat.service`
Expected: FAIL — `prisma.question` does not exist, or no rows are written.

- [ ] **Step 4: Log the question**

In `apps/api/src/modules/chat/chat.service.ts`, immediately after the user's `Message` is created and **before** the pinned-answer lookup:

```ts
  // Logged for the Questions screen, clustered on the same key the pinned
  // answer below is looked up by. Every question, not only refused ones:
  // nothing in the answer is machine-readable enough to tell a refusal from a
  // confident answer across Malay, Manglish and English, and a question asked
  // nine times is a gap either way. See BACKEND.md's refusal rule.
  const normalizedQuestion = normalizeClaim(input.question);
  await prisma.question.upsert({
    where: { pageId_normalizedQuestion: { pageId: page.id, normalizedQuestion } },
    // The first phrasing wins and is never overwritten -- the owner reads what
    // somebody actually typed, and rewriting it on every ask would make the
    // list churn for no gain.
    create: { pageId: page.id, text: input.question, normalizedQuestion },
    update: { askCount: { increment: 1 }, lastAskedAt: new Date() },
  });
```

`normalizeClaim` is already imported in this file for the pinned lookup.

- [ ] **Step 5: Run to verify GREEN**

Run: `pnpm --filter @curios/api test chat`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db apps/api
git commit -m "feat(api): every question a visitor asks, counted"
```

---

### Task 2: The read, and the write that answers it

**Files:**
- Create: `packages/db-read/src/questions.query.ts`, `questions.query.test.ts`
- Modify: `packages/db-read/src/index.ts`
- Create: `apps/api/src/modules/questions/question.service.ts`, `question.service.test.ts`
- Create: `apps/api/src/modules/questions/question.routes.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/plugins/errors.ts`

**Interfaces:**
- Consumes: the `Question` model from Task 1.
- Produces:
  - `getQuestions(accountId: string, options?: { limit?: number }): Promise<OwnerQuestion[]>` where `OwnerQuestion` is `{ id, text, askCount, answered, lastAskedAt }`.
  - `answerQuestion(prisma, accountId: string, questionId: string, answer: string): Promise<void>`
  - `POST /questions/:id/answer` with body `{ answer: string }`.
  - `QuestionNotYoursError` — 404, code `NOT_FOUND`.

- [ ] **Step 1: Write the failing read test**

`packages/db-read/src/questions.query.test.ts`, following `review.query.test.ts` for the fixture shape:

```ts
describe('getQuestions', () => {
  it('ranks by ask count, most asked first', async () => {
    // The one ordering this screen has. An owner scanning a list wants the
    // gap that costs them most at the top, and that is frequency.
    const questions = await getQuestions(mine);
    expect(questions.map((q) => q.text)).toEqual([
      'berapa harga kek',
      'ada delivery',
      'buka pukul berapa',
    ]);
  });

  it('returns nothing for an account that owns none of them', async () => {
    // Scoped in the query rather than filtered after the read, the same shape
    // as every other ownership check here.
    expect(await getQuestions(theirs)).toEqual([]);
  });

  it('reports whether each has been answered', async () => {
    const questions = await getQuestions(mine);
    expect(questions.find((q) => q.text === 'ada delivery')?.answered).toBe(true);
  });

  it('does not write, so the read-only role can run it', async () => {
    // apps/web connects as curios_readonly. A write here fails in Postgres
    // with 42501 rather than in review.
    await expect(getQuestions(mine)).resolves.toBeDefined();
  });
});
```

Seed three questions with ask counts 9, 4 and 1, the middle one answered.

- [ ] **Step 2: Write the read**

`packages/db-read/src/questions.query.ts`:

```ts
import { prismaRead } from './client.js';

export interface OwnerQuestion {
  id: string;
  text: string;
  askCount: number;
  answered: boolean;
  lastAskedAt: Date;
}

/**
 * What customers actually ask, most asked first.
 *
 * Frequency is the only ranking. BACKEND.md's original design ranked by
 * whether the model refused; that is not detected, and is not detectable
 * across three languages -- see the refusal rule. A question asked nine times
 * is a gap whether the model refused it or answered it badly, which makes the
 * count the more honest signal anyway.
 *
 * Scoped through the page's owner inside the query. A read-then-filter is one
 * careless early return away from showing a stranger's customers.
 */
export async function getQuestions(
  accountId: string,
  options: { limit?: number } = {},
): Promise<OwnerQuestion[]> {
  return prismaRead.question.findMany({
    where: { page: { accountId } },
    orderBy: [{ askCount: 'desc' }, { lastAskedAt: 'desc' }],
    take: Math.min(options.limit ?? 50, 100),
    select: { id: true, text: true, askCount: true, answered: true, lastAskedAt: true },
  });
}
```

Export it and its type from `packages/db-read/src/index.ts`.

- [ ] **Step 3: Write the failing writeback test**

`apps/api/src/modules/questions/question.service.test.ts`:

```ts
describe('answerQuestion', () => {
  it('creates a pinned answer on the same key the chat path looks up', async () => {
    await answerQuestion(prisma, accountId, questionId, 'RM95 sekilo.');

    const pinned = await prisma.pinnedAnswer.findFirstOrThrow({});
    expect(pinned.answer).toBe('RM95 sekilo.');
    // The same normalised key, which is the whole reason this works.
    expect(pinned.normalizedQuestion).toBe('berapa harga kek');
  });

  it('marks the question answered', async () => {
    await answerQuestion(prisma, accountId, questionId, 'RM95 sekilo.');

    expect((await prisma.question.findUniqueOrThrow({ where: { id: questionId } })).answered).toBe(
      true,
    );
  });

  it('replaces an answer rather than failing on the second edit', async () => {
    // PinnedAnswer is unique on (pageId, normalizedQuestion). An owner fixing
    // a typo must not hit a constraint error.
    await answerQuestion(prisma, accountId, questionId, 'RM95.');
    await answerQuestion(prisma, accountId, questionId, 'RM95 sekilo, minimum dua.');

    const pinned = await prisma.pinnedAnswer.findFirstOrThrow({});
    expect(pinned.answer).toBe('RM95 sekilo, minimum dua.');
    expect(await prisma.pinnedAnswer.count()).toBe(1);
  });

  it('refuses a question belonging to someone else', async () => {
    // 404, not 403: a 403 confirms the id exists, which is itself a leak --
    // the same reasoning as PageNotYoursError in the ingest service.
    await expect(
      answerQuestion(prisma, strangerAccountId, questionId, 'mine now'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await prisma.pinnedAnswer.count()).toBe(0);
  });
});
```

- [ ] **Step 4: Write the writeback**

`apps/api/src/modules/questions/question.service.ts`:

```ts
import type { PrismaClient } from '@curios/db';

export class QuestionNotYoursError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // 404, not 403. A 403 confirms the id exists, which is itself a leak.
    super('No such question.');
    this.name = 'QuestionNotYoursError';
  }
}

/**
 * The writeback, and the one thing this screen is for.
 *
 * A PinnedAnswer on the same normalised key chat.service.ts already checks
 * before calling the model -- so the next person to ask gets the owner's exact
 * words, at zero tokens and zero risk of a paraphrase.
 *
 * Matching is exact on that key. Answering "berapa harga kek" does not cover
 * "harga kek berapa", which falls through to the model. That is a known limit,
 * argued in devDocs/slice-5-build-spec.md, and not a bug to fix here.
 */
export async function answerQuestion(
  prisma: PrismaClient,
  accountId: string,
  questionId: string,
  answer: string,
): Promise<void> {
  // Scoped in the query. A read-then-check leaks through timing and is one
  // careless early return from writing into a stranger's page.
  const question = await prisma.question.findFirst({
    where: { id: questionId, page: { accountId } },
    select: { id: true, pageId: true, text: true, normalizedQuestion: true },
  });
  if (!question) throw new QuestionNotYoursError();

  await prisma.$transaction([
    prisma.pinnedAnswer.upsert({
      where: {
        pageId_normalizedQuestion: {
          pageId: question.pageId,
          normalizedQuestion: question.normalizedQuestion,
        },
      },
      create: {
        pageId: question.pageId,
        question: question.text,
        normalizedQuestion: question.normalizedQuestion,
        answer,
      },
      // An owner fixing a typo must not hit the unique constraint.
      update: { answer },
    }),
    prisma.question.update({ where: { id: question.id }, data: { answered: true } }),
  ]);
}
```

- [ ] **Step 5: The route**

`apps/api/src/modules/questions/question.routes.ts`, following `fact.routes.ts` exactly — it is the closest existing shape:

```ts
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnauthenticatedError } from '../../plugins/session.js';
import { answerQuestion } from './question.service.js';

export const questionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/questions/:id/answer',
    {
      schema: {
        params: z.object({ id: z.string().min(1).max(64) }),
        // 2000, not 500: this is one of the two places FRONTEND.md says a
        // human writes real prose, and an owner explaining a delivery policy
        // needs more room than a fact claim.
        body: z.object({ answer: z.string().min(1).max(2000) }),
      },
    },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await answerQuestion(app.prisma, request.account.id, request.params.id, request.body.answer);
      return reply.send({ status: 'answered' });
    },
  );
};
```

Register it in `app.ts` inside the existing session-guarded scope beside `factRoutes` — that scope already has `requireSession` on it.

`NOT_FOUND` is already in `DOMAIN_ERROR_CODES` (`errors.ts:50`) — checked, so `errors.ts` needs no change. The session-guarded scope is `app.ts:95`, where `requireSession` is added as an `onRequest` hook before `pageRoutes` and `factRoutes`; register `questionRoutes` there.

- [ ] **Step 6: Run and commit**

Run: `pnpm --filter @curios/db-read test && pnpm --filter @curios/api test`

```bash
git add packages/db-read apps/api
git commit -m "feat(api): answering a question pins it"
```

---

### Task 3: The screen

**Files:**
- Create: `apps/web/app/app/questions/page.tsx`
- Create: `apps/web/app/app/questions/question-list.tsx`, `question-list.test.tsx`
- Create: `apps/web/app/app/questions/questions.module.css`

**Interfaces:**
- Consumes: `getQuestions` and `OwnerQuestion` from Task 2; `POST /questions/:id/answer`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

`apps/web/app/app/questions/question-list.test.tsx`, following `review-queue.test.tsx` for the wrapper/presentational split this codebase uses:

```tsx
const questions: OwnerQuestion[] = [
  { id: 'q1', text: 'berapa harga kek', askCount: 9, answered: false, lastAskedAt: new Date() },
  { id: 'q2', text: 'ada delivery', askCount: 4, answered: true, lastAskedAt: new Date() },
];

describe('QuestionList', () => {
  it('shows how often each was asked, because that is the ranking', async () => {
    render(<QuestionList questions={questions} onAnswer={vi.fn()} />);
    expect(screen.getByText(/asked 9/i)).toBeInTheDocument();
  });

  it('offers one primary action per question', async () => {
    render(<QuestionList questions={questions} onAnswer={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /answer this/i })).toHaveLength(1);
    // The answered one shows its state instead of a second Answer button --
    // FRONTEND.md allows one primary action, and an already-answered question
    // is not where an owner should spend it.
    expect(screen.getByText(/answered/i)).toBeInTheDocument();
  });

  it('sends what the owner wrote', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<QuestionList questions={questions} onAnswer={onAnswer} />);

    await userEvent.click(screen.getByRole('button', { name: /answer this/i }));
    await userEvent.type(screen.getByLabelText(/answer/i), 'RM95 sekilo.');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onAnswer).toHaveBeenCalledWith('q1', 'RM95 sekilo.');
  });

  it('keeps the draft when saving fails', async () => {
    // The same rule the fact editor learned: this is one of two places a human
    // writes real prose, and throwing it away on a failed save means retyping
    // from memory.
    const onAnswer = vi.fn().mockRejectedValue(new Error('That failed. Try again.'));
    render(<QuestionList questions={questions} onAnswer={onAnswer} />);

    await userEvent.click(screen.getByRole('button', { name: /answer this/i }));
    await userEvent.type(screen.getByLabelText(/answer/i), 'RM95 sekilo.');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/try again/i);
    expect(screen.getByLabelText(/answer/i)).toHaveValue('RM95 sekilo.');
  });

  it('does not submit twice on a double tap', async () => {
    const onAnswer = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<QuestionList questions={questions} onAnswer={onAnswer} />);

    await userEvent.click(screen.getByRole('button', { name: /answer this/i }));
    await userEvent.type(screen.getByLabelText(/answer/i), 'RM95.');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('says what to do when there is nothing yet', async () => {
    // Empty states are instructions, not moods.
    render(<QuestionList questions={[]} onAnswer={vi.fn()} />);
    expect(screen.getByText(/share your link/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify RED, then write the components**

`question-list.tsx` holds `QuestionList` (presentational, takes `questions` and `onAnswer`) and `Questions` (the `'use client'` wrapper closing over `apiFetch` and calling `router.refresh()` on success) — the same split `review-queue.tsx`, `claim-form.tsx` and `publish-button.tsx` all use, and for the same reason: a Server Component may not pass a function across the RSC boundary.

Use `Button`, `Field` (with `multiline`) and `Callout` from `@curios/ui`. The ask count uses `var(--font-mono)` — DESIGN.md gives counts to the utility voice.

`page.tsx` is a Server Component: `resolveOwner`, `redirect('/signin')` if none, `getQuestions(owner.accountId)`, render `<Questions questions={…} />` inside `Shell title="Questions"`.

- [ ] **Step 3: Run everything**

Run: `pnpm --filter @curios/web test && pnpm lint && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): the questions an owner can finally see"
```

---

### Task 4: Gates, and a question answered end to end

- [ ] **Step 1: All four gates**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build --force
```

- [ ] **Step 2: Prove the loop closes**

`docker compose up -d && pnpm dev`, then:

1. On `/nadia`, ask the same question twice in two separate sheet sessions.
2. Sign in, open `/app/questions`, and confirm it shows once with "asked 2×".
3. Answer it, then ask it again on the public page.
4. **The answer should be the owner's exact words**, arriving instantly.

That last step is the only one that matters — it is the difference between a screen that lists questions and a screen that changes what the product says. Check the model was not called:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c 'SELECT count(*) FROM "ModelCall" ORDER BY 1;'
```

Run it before and after step 4; a pinned hit adds no row.

**Report each honestly, including any not run.**

- [ ] **Step 3: Record the result and commit**

---

## Self-review

**Spec coverage.** The `Question` model, the cluster key and logging are Task 1; the read and the writeback are Task 2; the screen is Task 3. The spec's "no refusal detection" decision needs no task — it is a thing not built — but the reason is quoted in the code comment where someone would otherwise wonder why `answered` starts false.

**Placeholder scan.** Task 3 Step 2 describes the components rather than pasting them. That is the same trade slices 3 and 4 made for the same reason: the wrapper/presentational split is an established pattern with three existing examples in this repo, and copying one into the plan creates a fourth version to drift from. The six tests above it pin the behaviour, including the two that were learned the hard way elsewhere — a surviving draft and a double-tap guard.

**Type consistency.** `OwnerQuestion` is `{ id, text, askCount, answered, lastAskedAt }` in Tasks 2 and 3. `answerQuestion(prisma, accountId, questionId, answer)` keeps that argument order in the service, its tests and the route. `normalizedQuestion` is the field name on both `Question` and `PinnedAnswer`, which is what makes the writeback a straight copy.

**One thing worth watching in execution.** Task 1 adds a database write to the chat path, which runs on every visitor question. It is one upsert on a unique index, next to the two `Message` writes already there — but if it shows up in latency, the honest fix is to move it after the stream rather than to drop the feature, and that is a decision for whoever sees the number.

**What no test covers.** Whether ask-count ranking is the right ranking. That needs a real page with real visitors, and the spec says so: it is also the only thing that will show whether refusal detection was worth skipping.
