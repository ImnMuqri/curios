# Slice 4 Plan 2 — Capture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shop owner receives an email carrying a customer's phone number and the conversation that produced it, with a `wa.me` link that opens WhatsApp on the reply already typed.

**Architecture:** The server decides qualification from signals it already has — no model call — and returns `intent.qualified` on the chat stream's `done` event. The capture card posts one field. Slot extraction is a queued job, because nothing generative runs inside a request, and that job enqueues the mail once the slots exist so the owner never gets a second email correcting the first.

**Tech Stack:** TypeScript, Fastify, Prisma, BullMQ, Anthropic SDK (Haiku), React 19, Next 15, vitest + Testing Library.

**Spec:** `devDocs/slice-4-build-spec.md`. Read its "Qualification" section before Task 1 — especially the paragraph on the signal that could not be used, which is why the rule reads the visitor's own words.

## Global Constraints

- **Never log a full phone number.** BACKEND.md asks for this explicitly and it is violated by accident, usually by logging a request body. The capture route logs nothing but an outcome.
- **Be conservative.** BACKEND.md: *"An inflated lead count is how you lose trust in every other number you show."* Under-capturing is the intended failure direction; a rule that fires on someone checking opening hours is worse than one that misses a real lead.
- **`Message.citedFactIds` is not citation data.** It stores every verified fact on the page, on every message. Do not build a signal on it — that is the trap the spec's qualification section exists to warn about.
- **Nothing generative runs inside an HTTP request.** Slot extraction is a job.
- **The usage meter counts conversations, not messages.** Established as a rule in plan 1; do not touch it, and do not add a second meter for leads without saying so.
- **Personal pages have capture off.** `Page.mode` is `PERSONAL | BUSINESS`, defaulting to `BUSINESS`.
- **Copy voice:** sentence case, plain, active verbs. Errors explain and instruct, never apologise. The consent line names who receives the number — the page owner, not us — and sits above the field, never in a tooltip.
- **Design system:** every colour is a token in `packages/ui/src/tokens.css`; the type scale is `11 / 12.5 / 14 / 17 / 22 / 32`. `kuning` means *a human needs to act* — the capture card is the first thing in the product that genuinely qualifies for it. `design-rules.test.ts` fails a hex or a seventh size, and does **not** catch `rgb()`.
- Node 22, ESM. **Every relative import ends in `.js`**, even from `.ts`/`.tsx`.
- Gates from the repo root: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `apps/api` and `packages/db-read` tests need Postgres. `docker compose up -d`, and after any restart of the `tmpfs` test container: `cd packages/db && DATABASE_URL="$DATABASE_URL_TEST" pnpm exec prisma migrate deploy`, then `docker exec -i curios-postgres-test psql -U curios -d curios_test < packages/db/prisma/sql/readonly-role.sql`.

---

### Task 1: The phone number, and the rule that qualifies a conversation

Two pure functions in `packages/core`, beside `handle.ts` — the other format rule in this codebase with a test table. Neither touches a network, a database, or a model, which is the whole argument for putting qualification here.

**Files:**
- Create: `packages/core/src/phone.ts`, `packages/core/src/phone.test.ts`
- Create: `packages/core/src/qualify.ts`, `packages/core/src/qualify.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, exported from `@curios/core`:
  - `normalizeMalaysianPhone(raw: string): string | null` — returns `+60…` or `null`.
  - `qualifies(input: { mode: 'PERSONAL' | 'BUSINESS'; visitorMessages: string[] }): boolean`
  - `MIN_VISITOR_TURNS = 3`

- [ ] **Step 1: Write the failing phone test**

`packages/core/src/phone.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeMalaysianPhone } from './phone.js';

describe('normalizeMalaysianPhone', () => {
  it.each([
    ['0123456789', '+60123456789', 'the way a Malaysian types their own number'],
    ['012-345 6789', '+60123456789', 'with the separators people actually use'],
    ['+60123456789', '+60123456789', 'already E.164'],
    ['60123456789', '+60123456789', 'country code, no plus'],
    ['+6012 345 6789', '+60123456789', 'E.164 with spaces'],
    ['01123456789', '+601123456789', 'an 011 number, which is one digit longer'],
  ])('reads %s as %s (%s)', (raw, expected) => {
    expect(normalizeMalaysianPhone(raw)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['12345', 'too short to be anything'],
    ['0323456789', 'a landline, not a mobile -- 03 is Klang Valley fixed line'],
    ['+65912345678', 'Singapore, not Malaysia'],
    ['0121234', 'a mobile prefix but too few digits'],
    ['012345678901234', 'too many digits'],
    ['abcdefghij', 'not a number at all'],
    ['+60123456789; DROP TABLE', 'a number with a payload stapled to it'],
  ])('refuses %s (%s)', (raw) => {
    expect(normalizeMalaysianPhone(raw)).toBeNull();
  });

  it('stores one form, so dedupe compares like with like', () => {
    // The 24-hour dedupe is a string comparison. If 012-345 6789 and
    // +60123456789 stored differently, the same person captured twice in an
    // hour would look like two leads, and the count an owner trusts is wrong.
    const spellings = ['0123456789', '012-345 6789', '+60123456789', '60123456789'];
    const stored = new Set(spellings.map(normalizeMalaysianPhone));
    expect(stored.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `pnpm --filter @curios/core test phone`
Expected: FAIL — cannot resolve `./phone.js`.

- [ ] **Step 3: Write it**

`packages/core/src/phone.ts`:

```ts
/**
 * Malaysian mobile numbers, in the spellings people actually type.
 *
 * One stored form, because the 24-hour dedupe is a string comparison: if
 * 012-345 6789 and +60123456789 stored differently, the same person captured
 * twice in an hour would look like two leads, and a lead count an owner cannot
 * trust makes every other number on the dashboard suspect too.
 *
 * Mobile only. A Malaysian mobile is 01X followed by 7 or 8 digits; 03 and the
 * other fixed-line prefixes are refused, because a lead we cannot WhatsApp is
 * not a lead this product can act on.
 */
export function normalizeMalaysianPhone(raw: string): string | null {
  const digits = raw.replace(/[\s-()]/g, '');

  // Anything that is not a leading + and digits is refused outright rather
  // than stripped: a number with a payload stapled to it is not a typo.
  if (!/^\+?\d+$/.test(digits)) return null;

  let national: string;
  if (digits.startsWith('+60')) national = digits.slice(3);
  else if (digits.startsWith('60')) national = digits.slice(2);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else return null;

  // 1 followed by 9 or 10 digits: 12 345 6789 is the common form, and 011
  // numbers carry one more.
  if (!/^1\d{8,9}$/.test(national)) return null;

  return `+60${national}`;
}
```

- [ ] **Step 4: Write the failing qualification test**

`packages/core/src/qualify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MIN_VISITOR_TURNS, qualifies } from './qualify.js';

const specific = ['nak order kek 2kg', 'untuk 20 Mac', 'hantar ke Klang boleh?'];

describe('qualifies', () => {
  it('qualifies a business conversation with enough turns and a specific ask', () => {
    expect(qualifies({ mode: 'BUSINESS', visitorMessages: specific })).toBe(true);
  });

  it('never qualifies a personal page', () => {
    // BACKEND.md's plan matrix: capture card off for personal, on for
    // business. A personal page has no leads to capture.
    expect(qualifies({ mode: 'PERSONAL', visitorMessages: specific })).toBe(false);
  });

  it('does not qualify before the third turn', () => {
    expect(qualifies({ mode: 'BUSINESS', visitorMessages: specific.slice(0, 2) })).toBe(false);
    expect(MIN_VISITOR_TURNS).toBe(3);
  });

  it('does not qualify a conversation with no specifics in it', () => {
    // Three turns of browsing is not a lead. This is the anti-signal that
    // stops every hours-check from becoming one, and BACKEND.md is explicit
    // that an inflated count costs more than a missed lead.
    expect(
      qualifies({
        mode: 'BUSINESS',
        visitorMessages: ['buka tak hari ni?', 'ada apa?', 'di mana kedai?'],
      }),
    ).toBe(false);
  });

  it.each([
    ['nak 2kg', 'a quantity'],
    ['untuk 20 Mac', 'a date'],
    ['boleh siap 3 hari?', 'a number of days'],
    ['nak 12 biji', 'a count'],
  ])('counts %s as specific (%s)', (message) => {
    expect(qualifies({ mode: 'BUSINESS', visitorMessages: ['hai', 'ada kek?', message] })).toBe(
      true,
    );
  });

  it('does not count a number that is part of a word', () => {
    // "kek2" and "b2b" are not specifics. A digit anywhere would make almost
    // any message qualify, which is the inflated count BACKEND.md warns about.
    expect(
      qualifies({ mode: 'BUSINESS', visitorMessages: ['hai', 'ada apa', 'b2b macam mana'] }),
    ).toBe(false);
  });

  it('ignores the assistant, which always talks about prices', () => {
    // The signal is the VISITOR's own specifics. The assistant quotes RM95 in
    // almost every answer, so counting its words would qualify everything.
    expect(qualifies({ mode: 'BUSINESS', visitorMessages: ['hai', 'ada apa', 'ok'] })).toBe(false);
  });
});
```

- [ ] **Step 5: Run to verify RED**

Run: `pnpm --filter @curios/core test qualify`
Expected: FAIL — cannot resolve `./qualify.js`.

- [ ] **Step 6: Write it**

`packages/core/src/qualify.ts`:

```ts
/** BACKEND.md's `turn_3`. Two turns is still browsing. */
export const MIN_VISITOR_TURNS = 3;

/**
 * A standalone number: a quantity, a count, a date. BACKEND.md calls this
 * `own_specifics`, and the word "own" is the load-bearing part -- it is the
 * visitor stating their own requirement, not the assistant quoting a price.
 *
 * Bounded by non-digits on both sides so "b2b" and "kek2" do not count. A bare
 * \d anywhere would qualify almost any message, which is exactly the inflated
 * lead count this rule exists to avoid.
 */
const SPECIFIC = /(?<!\d)\d{1,4}(?!\d)/;

/**
 * Whether the capture card may be offered.
 *
 * Deterministic, and deliberately so. BACKEND.md originally specified a model
 * returning a confidence score; the reasons that changed are in
 * devDocs/slice-4-build-spec.md, and the shortest one is that "be
 * conservative" is a requirement you can tune and unit-test in a function and
 * cannot in a 0.81.
 *
 * Under-capturing is the intended failure direction. A card offered to
 * somebody checking opening hours costs the owner's trust in every number on
 * their dashboard; a card not offered to a real lead costs one lead, and the
 * Questions dashboard is the named mechanism for finding those.
 */
export function qualifies(input: {
  mode: 'PERSONAL' | 'BUSINESS';
  visitorMessages: string[];
}): boolean {
  if (input.mode !== 'BUSINESS') return false;
  if (input.visitorMessages.length < MIN_VISITOR_TURNS) return false;
  return input.visitorMessages.some((message) => SPECIFIC.test(message));
}
```

- [ ] **Step 7: Export and run**

Append to `packages/core/src/index.ts`:

```ts
export { normalizeMalaysianPhone } from './phone.js';
export { MIN_VISITOR_TURNS, qualifies } from './qualify.js';
```

Run: `pnpm --filter @curios/core test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): one phone form, and a rule that errs towards missing a lead"
```

---

### Task 2: The chat stream says whether to offer the card

**Files:**
- Modify: `apps/api/src/modules/chat/chat.service.ts`
- Test: `apps/api/src/modules/chat/chat.service.test.ts`

**Interfaces:**
- Consumes: `qualifies` from Task 1.
- Produces: `AnswerEvent`'s `done` becomes `{ type: 'done'; conversationId: string; intent: { qualified: boolean } }`.

**Why `intent` is an object with one field:** FRONTEND.md's contract is *"the API returns `intent.qualified = true`"*, and BACKEND.md's original block had slots and signals beside it. Keeping the nesting means adding either later is a field, not a breaking change to every client.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/modules/chat/chat.service.test.ts`, inside the `threading a conversation` describe:

```ts
  it('does not offer capture on the first turn', async () => {
    const deps = depsSaying();
    const events = await ask(deps, 'nak order 2kg');
    expect(events.find((e) => e.type === 'done')).toMatchObject({
      intent: { qualified: false },
    });
  });

  it('offers capture once the conversation is three specific turns deep', async () => {
    const deps = depsSaying();
    const conversationId = conversationIdOf(await ask(deps, 'ada kek butter?'));
    await ask(deps, 'yang 2kg', conversationId);
    const third = await ask(deps, 'hantar ke Klang 20 Mac boleh?', conversationId);

    expect(third.find((e) => e.type === 'done')).toMatchObject({ intent: { qualified: true } });
  });

  it('never offers capture on a personal page', async () => {
    // The mode gate, asserted through the service rather than the pure
    // function, because this is where the page's mode is actually read.
    await prisma.page.updateMany({ where: { handle: 'nadia' }, data: { mode: 'PERSONAL' } });
    const deps = depsSaying();
    const conversationId = conversationIdOf(await ask(deps, 'nak 2kg'));
    await ask(deps, 'untuk 20 Mac', conversationId);
    const third = await ask(deps, 'hantar ke Klang?', conversationId);

    expect(third.find((e) => e.type === 'done')).toMatchObject({ intent: { qualified: false } });
  });

  it('counts only the visitor turns, not the answers', async () => {
    // Six messages, three of them the assistant's. Qualification must see
    // three visitor turns, not six -- the assistant quotes RM95 constantly and
    // counting its words would qualify every conversation on the page.
    const deps = depsSaying('Kek butter 2kg RM160.');
    const conversationId = conversationIdOf(await ask(deps, 'hai'));
    await ask(deps, 'ada apa', conversationId);
    const third = await ask(deps, 'ok', conversationId);

    expect(third.find((e) => e.type === 'done')).toMatchObject({ intent: { qualified: false } });
  });
```

- [ ] **Step 2: Run to verify RED**

Run: `pnpm --filter @curios/api test chat.service`
Expected: FAIL — the `done` event has no `intent`.

- [ ] **Step 3: Widen the event and compute it**

In `apps/api/src/modules/chat/chat.service.ts`:

```ts
export type AnswerEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; conversationId: string; intent: { qualified: boolean } };
```

Add `mode: true` to the `page` select. Then, just before the final `yield`, compute it from the history this function already read plus the answer it just produced:

```ts
  // Computed from the visitor's own turns. `history` above was read before the
  // answer was written, and already includes the question being answered now,
  // so it is exactly the visitor's side of the conversation as it stands.
  //
  // Deliberately NOT built on Message.citedFactIds: that column stores every
  // verified fact on the page rather than the ones an answer used, so any
  // signal drawn from it would be true of every message ever sent.
  const visitorMessages = history
    .filter((message) => message.role === 'USER')
    .map((message) => message.content);

  yield {
    type: 'done',
    conversationId,
    intent: { qualified: qualifies({ mode: page.mode, visitorMessages }) },
  };
```

importing `qualifies` from `@curios/core`.

**The pinned-answer branch yields `done` too**, and it must carry an `intent` as well — a pinned answer is still a turn in a conversation. It returns before `history` is read, so compute its `visitorMessages` from its own read or reuse the same helper; either way, do not leave that branch yielding a `done` without an `intent`, because the client's type says it always has one.

- [ ] **Step 4: Run to verify GREEN**

Run: `pnpm --filter @curios/api test chat`
Expected: PASS, including the route tests, whose `done` events now carry an extra field they do not assert on.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): the stream says whether to ask for a number"
```

---

### Task 3: The lead, and the guards around it

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: a migration under `packages/db/prisma/migrations/`
- Create: `apps/api/src/modules/leads/lead.service.ts`, `lead.service.test.ts`
- Create: `apps/api/src/modules/leads/lead.routes.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/plugins/errors.ts`, `apps/api/src/plugins/rate-limit.ts`
- Modify: `packages/core/src/types.ts` (`LEAD_QUEUE`, `LeadJobData`)

**Interfaces:**
- Consumes: `normalizeMalaysianPhone`, `qualifies` from Task 1.
- Produces:
  - `captureLead(deps, input: { conversationId: string; phone: string }): Promise<{ leadId: string }>`
  - `LEAD_QUEUE = 'lead'` and `LeadJobData = { leadId: string }`, from `@curios/core`.
  - Errors: `InvalidPhoneError` (400, `INVALID_PHONE`), `NotQualifiedError` (400, `NOT_QUALIFIED`), `AlreadyCapturedError` (409, `ALREADY_CAPTURED`).

- [ ] **Step 1: Add the model**

`packages/db/prisma/schema.prisma`:

```prisma
enum LeadStatus {
  NEW
  CONTACTED
  CLOSED
}

model Lead {
  id             String       @id @default(cuid())
  pageId         String
  page           Page         @relation(fields: [pageId], references: [id], onDelete: Cascade)
  // Unique, not indexed: BACKEND.md's "one capture attempt per conversation"
  // is an invariant, and an invariant the database enforces cannot be skipped
  // by a code path someone adds later.
  conversationId String       @unique
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  /** E.164, one stored form. normalizeMalaysianPhone in packages/core owns that form. */
  phone          String
  /** { product, date, location }, filled by the extraction job. Null until it runs. */
  slots          Json?
  /** How many slots are filled. A number an owner can verify by looking, not a model opinion. */
  score          Int          @default(0)
  status         LeadStatus   @default(NEW)
  createdAt      DateTime     @default(now())

  @@index([pageId, createdAt])
  // The 24-hour dedupe reads this. It cannot be a unique index, because the
  // rule has a time window and an index does not.
  @@index([pageId, phone, createdAt])
}
```

Add `leads Lead[]` to `Page` and `lead Lead?` to `Conversation`.

Then, from `packages/db`:

```bash
DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | head -1 | cut -d= -f2- | tr -d '"')" npx prisma migrate dev --name lead
DATABASE_URL="$(grep '^DATABASE_URL_TEST=' ../../.env | head -1 | cut -d= -f2- | tr -d '"')" npx prisma migrate deploy
```

- [ ] **Step 2: Write the failing service test**

`apps/api/src/modules/leads/lead.service.test.ts`. Follow `ingest.service.test.ts` for the real-Postgres fixture shape.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { captureLead, type LeadQueueLike } from './lead.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let pageId = '';
let conversationId = '';

/** Three visitor turns, the last with a quantity in it: a qualifying thread. */
async function aQualifyingConversation(): Promise<string> {
  const conversation = await prisma.conversation.create({ data: { pageId } });
  for (const [role, content] of [
    ['USER', 'ada kek butter?'],
    ['ASSISTANT', 'Ada, RM95 sekilo.'],
    ['USER', 'yang besar'],
    ['ASSISTANT', 'RM160 untuk 2kg.'],
    ['USER', 'nak 2kg untuk 20 Mac'],
    ['ASSISTANT', 'Boleh.'],
  ] as const) {
    await prisma.message.create({ data: { conversationId: conversation.id, role, content } });
  }
  return conversation.id;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  const account = await prisma.account.create({
    data: {
      email: 'n@example.com',
      pages: {
        create: { handle: 'nadia', skeleton: 'nadia', displayName: 'Nadia Bakes', published: true },
      },
    },
    include: { pages: true },
  });
  pageId = account.pages[0]?.id ?? '';
  conversationId = await aQualifyingConversation();
});

describe('captureLead', () => {
  it('stores the number in one form and queues the extraction', async () => {
    const add = vi.fn<LeadQueueLike['add']>(async () => ({ id: 'job-1' }));

    const { leadId } = await captureLead({ prisma, queue: { add } }, {
      conversationId,
      phone: '012-345 6789',
    });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.phone).toBe('+60123456789');
    expect(lead.slots).toBeNull();
    expect(add).toHaveBeenCalledOnce();
  });

  it('refuses a number it cannot dial', async () => {
    const add = vi.fn<LeadQueueLike['add']>(async () => ({ id: 'job-1' }));
    await expect(
      captureLead({ prisma, queue: { add } }, { conversationId, phone: '0323456789' }),
    ).rejects.toMatchObject({ code: 'INVALID_PHONE' });

    expect(await prisma.lead.count()).toBe(0);
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses a conversation that never qualified', async () => {
    // The client is told when to show the card, but the client is not trusted
    // to be the only thing that checks -- anyone can POST this endpoint.
    const browsing = await prisma.conversation.create({ data: { pageId } });
    await prisma.message.create({
      data: { conversationId: browsing.id, role: 'USER', content: 'buka tak?' },
    });
    const add = vi.fn<LeadQueueLike['add']>(async () => ({ id: 'job-1' }));

    await expect(
      captureLead({ prisma, queue: { add } }, { conversationId: browsing.id, phone: '0123456789' }),
    ).rejects.toMatchObject({ code: 'NOT_QUALIFIED' });
  });

  it('allows one capture per conversation and no more', async () => {
    const add = vi.fn<LeadQueueLike['add']>(async () => ({ id: 'job-1' }));
    await captureLead({ prisma, queue: { add } }, { conversationId, phone: '0123456789' });

    await expect(
      captureLead({ prisma, queue: { add } }, { conversationId, phone: '0129999999' }),
    ).rejects.toMatchObject({ code: 'ALREADY_CAPTURED' });

    expect(await prisma.lead.count()).toBe(1);
  });

  it('refuses the same number on the same page within a day', async () => {
    const add = vi.fn<LeadQueueLike['add']>(async () => ({ id: 'job-1' }));
    await captureLead({ prisma, queue: { add } }, { conversationId, phone: '0123456789' });

    // A different conversation, so the per-conversation guard is not what
    // refuses this one.
    const second = await aQualifyingConversation();
    await expect(
      captureLead({ prisma, queue: { add } }, { conversationId: second, phone: '012-345 6789' }),
    ).rejects.toMatchObject({ code: 'ALREADY_CAPTURED' });
  });

  it('accepts the same number again after the window has passed', async () => {
    const add = vi.fn<LeadQueueLike['add']>(async () => ({ id: 'job-1' }));
    const { leadId } = await captureLead({ prisma, queue: { add } }, {
      conversationId,
      phone: '0123456789',
    });
    // 25 hours ago. Someone who comes back the next day with a new order is a
    // new lead, not a duplicate.
    await prisma.lead.update({
      where: { id: leadId },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const second = await aQualifyingConversation();
    await expect(
      captureLead({ prisma, queue: { add } }, { conversationId: second, phone: '0123456789' }),
    ).resolves.toMatchObject({ leadId: expect.any(String) });
  });

  it('does not refuse the same number on a different page', async () => {
    const add = vi.fn<LeadQueueLike['add']>(async () => ({ id: 'job-1' }));
    await captureLead({ prisma, queue: { add } }, { conversationId, phone: '0123456789' });

    const other = await prisma.account.create({
      data: {
        email: 'other@example.com',
        pages: {
          create: { handle: 'other', skeleton: 'other', displayName: 'Other', published: true },
        },
      },
      include: { pages: true },
    });
    const theirPage = other.pages[0]?.id ?? '';
    const theirConversation = await prisma.conversation.create({ data: { pageId: theirPage } });
    for (const [role, content] of [
      ['USER', 'nak 2kg'],
      ['ASSISTANT', 'ok'],
      ['USER', 'untuk 20 Mac'],
      ['ASSISTANT', 'ok'],
      ['USER', 'hantar Klang?'],
    ] as const) {
      await prisma.message.create({ data: { conversationId: theirConversation.id, role, content } });
    }

    // Dedupe is per page. One customer shopping two bakeries is two leads.
    await expect(
      captureLead(
        { prisma, queue: { add } },
        { conversationId: theirConversation.id, phone: '0123456789' },
      ),
    ).resolves.toMatchObject({ leadId: expect.any(String) });
  });
});
```

- [ ] **Step 3: Run to verify RED**

Run: `pnpm --filter @curios/api test lead.service`
Expected: FAIL — cannot resolve `./lead.service.js`.

- [ ] **Step 4: Write the service**

`apps/api/src/modules/leads/lead.service.ts`. Add `LEAD_QUEUE = 'lead'` and `LeadJobData` to `packages/core/src/types.ts` first, exported from its index beside `INGEST_QUEUE`:

```ts
export const LEAD_QUEUE = 'lead';

export interface LeadJobData {
  leadId: string;
}
```

Then the service:

```ts
import { normalizeMalaysianPhone, qualifies, LEAD_QUEUE, type LeadJobData } from '@curios/core';
import type { PrismaClient } from '@curios/db';

export interface LeadQueueLike {
  add(name: string, data: LeadJobData, opts?: unknown): Promise<{ id?: string }>;
}

export interface LeadDeps {
  prisma: PrismaClient;
  queue: LeadQueueLike;
}

export class InvalidPhoneError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_PHONE';
  constructor() {
    super('That does not look like a Malaysian mobile number. Try 012-345 6789.');
    this.name = 'InvalidPhoneError';
  }
}

export class NotQualifiedError extends Error {
  readonly statusCode = 400;
  readonly code = 'NOT_QUALIFIED';
  constructor() {
    super('Keep chatting first, then we can pass your number on.');
    this.name = 'NotQualifiedError';
  }
}

export class AlreadyCapturedError extends Error {
  readonly statusCode = 409;
  readonly code = 'ALREADY_CAPTURED';
  constructor() {
    super('Your number is already with the shop. They will be in touch.');
    this.name = 'AlreadyCapturedError';
  }
}

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Anonymous, so every guard here is the only guard.
 *
 * The client is told when to offer the card, and the client is not trusted to
 * be the thing that decides: anyone can POST this route, so qualification is
 * re-checked from the stored conversation rather than taken on the caller's
 * word.
 */
export async function captureLead(
  deps: LeadDeps,
  input: { conversationId: string; phone: string },
): Promise<{ leadId: string }> {
  const phone = normalizeMalaysianPhone(input.phone);
  if (!phone) throw new InvalidPhoneError();

  const conversation = await deps.prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: {
      id: true,
      pageId: true,
      page: { select: { mode: true } },
      lead: { select: { id: true } },
      messages: { where: { role: 'USER' }, select: { content: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!conversation) throw new NotQualifiedError();
  if (conversation.lead) throw new AlreadyCapturedError();

  const eligible = qualifies({
    mode: conversation.page.mode,
    visitorMessages: conversation.messages.map((message) => message.content),
  });
  if (!eligible) throw new NotQualifiedError();

  // Per page, per 24 hours. A window cannot be a unique index, so this is a
  // query -- and it is per page on purpose: one customer shopping two bakeries
  // is two leads, not a duplicate.
  const recent = await deps.prisma.lead.findFirst({
    where: {
      pageId: conversation.pageId,
      phone,
      createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (recent) throw new AlreadyCapturedError();

  const lead = await deps.prisma.lead.create({
    data: { pageId: conversation.pageId, conversationId: conversation.id, phone },
    select: { id: true },
  });

  // Slots and the notification are the job's business. Extraction is a model
  // call and nothing generative runs inside a request -- and doing it in that
  // order means the owner never gets a second email correcting the first.
  await deps.queue.add(LEAD_QUEUE, { leadId: lead.id }, { jobId: lead.id, attempts: 3 });

  return { leadId: lead.id };
}
```

- [ ] **Step 5: Run to verify GREEN**

Run: `pnpm --filter @curios/api test lead.service`
Expected: PASS, eight tests.

- [ ] **Step 6: The route**

`apps/api/src/modules/leads/lead.routes.ts`, following `ingest.routes.ts` for shape — including its `errorSchema`, which is defined per module rather than shared:

```ts
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { captureLead } from './lead.service.js';

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export const leadRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/leads',
    {
      schema: {
        body: z.object({
          conversationId: z.string().min(1).max(64),
          phone: z.string().min(1).max(24),
          // Present and true or the request is refused by the schema. PDPA
          // consent is a thing the visitor did, not a default we assume.
          consent: z.literal(true),
        }),
        response: { 201: z.object({ leadId: z.string() }), 400: errorSchema, 409: errorSchema },
      },
    },
    async (request, reply) => {
      const result = await captureLead(
        { prisma: app.prisma, queue: app.leadQueue },
        { conversationId: request.body.conversationId, phone: request.body.phone },
      );
      // Nothing about the number reaches the log. BACKEND.md asks for this
      // explicitly and a request body logged on a failure is how it gets
      // violated by accident.
      request.log.info({ leadId: result.leadId }, 'lead captured');
      return reply.status(201).send(result);
    },
  );
};
```

Register it in `app.ts` inside **its own** scope carrying **only** `chatPerIpLimit`:

```ts
  // Its own scope, with the per-IP limiter only. It cannot join the chat scope
  // above: chatPerPageLimit's key generator reads the `handle` route param,
  // which /leads does not have, so every request here would key on undefined
  // and share one bucket across every visitor on every page.
  await app.register(async (scope) => {
    await scope.register(rateLimit, chatPerIpLimit(app.rateLimitRedis));
    await scope.register(leadRoutes);
  });
```

and add `leadQueue` to `plugins/queue.ts` beside `ingestQueue` and `mailQueue`. Add `'INVALID_PHONE'`, `'NOT_QUALIFIED'` and `'ALREADY_CAPTURED'` to `DOMAIN_ERROR_CODES`, each with a one-line comment saying why a visitor may see it.

- [ ] **Step 7: Run the API suite and commit**

Run: `pnpm --filter @curios/api test`
Expected: PASS.

```bash
git add apps/api packages/db packages/core
git commit -m "feat(api): a lead, and the four guards that decide there is one"
```

---

### Task 4: The job that fills the slots and sends the mail

**Files:**
- Create: `apps/workers/src/leads/lead.worker.ts`, `lead.worker.test.ts`
- Create: `apps/workers/src/leads/notify.ts`, `notify.test.ts`
- Modify: `apps/workers/src/main.ts`
- Modify: `packages/gateway/src/types.ts`, `anthropic.gateway.ts` (a `slots` method)

**Interfaces:**
- Consumes: `LeadJobData`, `LEAD_QUEUE` from Task 3.
- Produces:
  - `Gateway.slots(input: { transcript: string }): Promise<{ product: string | null; date: string | null; location: string | null }>`
  - `buildNotification(input: { displayName: string; phone: string; transcript: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>; slots: … }): { subject: string; text: string }`
  - `runLeadJob(deps, data: LeadJobData): Promise<void>`

- [ ] **Step 1: Write the failing notification test**

`apps/workers/src/leads/notify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildNotification } from './notify.js';

const transcript = [
  { role: 'USER' as const, content: 'nak kek butter 2kg' },
  { role: 'ASSISTANT' as const, content: 'RM160 untuk 2kg.' },
  { role: 'USER' as const, content: 'hantar Klang 20 Mac boleh?' },
];

describe('buildNotification', () => {
  it('carries the transcript, which is the thing people pay for', () => {
    // BACKEND.md: "Notification carries the transcript, not just the number.
    // That is the feature people pay for: she opens WhatsApp already knowing
    // what they want."
    const mail = buildNotification({
      displayName: 'Nadia Bakes',
      phone: '+60123456789',
      transcript,
      slots: { product: 'kek butter 2kg', date: '20 Mac', location: 'Klang' },
    });

    expect(mail.text).toContain('nak kek butter 2kg');
    expect(mail.text).toContain('hantar Klang 20 Mac boleh?');
  });

  it('builds a wa.me link WhatsApp will actually open', () => {
    const mail = buildNotification({
      displayName: 'Nadia Bakes',
      phone: '+60123456789',
      transcript,
      slots: { product: null, date: null, location: null },
    });

    // wa.me takes digits with no plus and no separators. A link carrying the
    // plus opens WhatsApp on a broken number, which looks like the product not
    // working at the exact moment it matters most.
    expect(mail.text).toContain('https://wa.me/60123456789');
    expect(mail.text).not.toContain('wa.me/+60');
  });

  it('prefills the reply, so one tap is enough', () => {
    const mail = buildNotification({
      displayName: 'Nadia Bakes',
      phone: '+60123456789',
      transcript,
      slots: { product: 'kek butter 2kg', date: null, location: null },
    });

    const link = /https:\/\/wa\.me\/60123456789\?text=(\S+)/.exec(mail.text);
    expect(link).not.toBeNull();
    expect(decodeURIComponent(link?.[1] ?? '')).toContain('kek butter 2kg');
  });

  it('says how many slots were filled, because the score is just that count', () => {
    const two = buildNotification({
      displayName: 'Nadia Bakes',
      phone: '+60123456789',
      transcript,
      slots: { product: 'kek', date: '20 Mac', location: null },
    });
    expect(two.subject).toContain('Nadia Bakes');
  });

  it('works when the model filled nothing in', () => {
    // Extraction can come back empty. A notification that needs slots to be
    // readable would then be worse than no product at all.
    const mail = buildNotification({
      displayName: 'Nadia Bakes',
      phone: '+60123456789',
      transcript,
      slots: { product: null, date: null, location: null },
    });
    expect(mail.text).toContain('+60123456789');
    expect(mail.text).toContain('nak kek butter 2kg');
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `pnpm --filter @curios/workers test notify`
Expected: FAIL — cannot resolve `./notify.js`.

- [ ] **Step 3: Write the notification builder**

`apps/workers/src/leads/notify.ts`. The subject names the shop, the body leads with the number and the slots, then the whole transcript, then the link. The `wa.me` number is `phone.replace('+', '')`, and the prefilled text is `encodeURIComponent` of a short reply naming the product when there is one.

- [ ] **Step 4: Write the failing worker test**

`apps/workers/src/leads/lead.worker.test.ts` — a real Postgres fixture like `extract.service.test.ts`, a stub gateway whose `slots` returns a known object, and a stub mail queue:

```ts
  it('fills the slots, scores them, and enqueues one mail', async () => {
    await runLeadJob({ prisma, gateway, mailQueue }, { leadId });

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.slots).toMatchObject({ product: 'kek butter 2kg', location: 'Klang' });
    // The score is how many slots are filled. Not a model opinion -- a number
    // an owner can check by looking at the three fields.
    expect(lead.score).toBe(2);
    expect(mailQueue.add).toHaveBeenCalledOnce();
  });

  it('still sends the mail when extraction fails', async () => {
    // A lead with no slots is worth far more than no lead. The owner has a
    // number and a transcript either way, and that is the product.
    const failing = { slots: vi.fn().mockRejectedValue(new Error('provider down')) };
    await runLeadJob({ prisma, gateway: failing, mailQueue }, { leadId });

    expect(mailQueue.add).toHaveBeenCalledOnce();
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).score).toBe(0);
  });

  it('sends to the account that owns the page, not to the visitor', async () => {
    await runLeadJob({ prisma, gateway, mailQueue }, { leadId });
    expect(mailQueue.add.mock.calls[0]?.[1]).toMatchObject({ to: 'n@example.com' });
  });
```

- [ ] **Step 5: Write the worker**

`runLeadJob` reads the lead with its conversation's messages and its page's owner email, calls `gateway.slots` inside a try/catch, writes `slots` and `score`, then enqueues the mail built by `buildNotification`. **Extraction failing must not stop the mail** — the test above pins that.

Add `slots` to the `Gateway` interface and implement it on the Anthropic gateway with a single non-streaming call returning JSON, in the same shape `extract` already uses.

Register the worker in `apps/workers/src/main.ts` beside the ingestion and mail workers, with its own Redis connection for the reason `main.ts` already documents.

- [ ] **Step 6: Run and commit**

Run: `pnpm --filter @curios/workers test && pnpm --filter @curios/gateway test`

```bash
git add apps/workers packages/gateway
git commit -m "feat(workers): the message that tells an owner what someone wants"
```

---

### Task 5: The capture card

**Files:**
- Create: `packages/ui/src/capture/CaptureCard.tsx`, `CaptureCard.module.css`, `CaptureCard.test.tsx`
- Modify: `packages/ui/src/index.ts`, `packages/ui/src/sheet/AskSheet.tsx`
- Modify: `apps/web/app/[handle]/ask.tsx`

**Interfaces:**
- Consumes: `Button`, `Field` from slice 3; `intent.qualified` from Task 2.
- Produces: `<CaptureCard onSubmit={(phone: string) => Promise<void>} />`, and `AskSheet` gains `onCapture?: (phone: string) => Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`packages/ui/src/capture/CaptureCard.test.tsx`:

```tsx
  it('names who receives the number, above the field', () => {
    // PDPA, and BACKEND.md is specific: the consent line names the page owner
    // as the recipient, and it is not hidden in a tooltip.
    render(<CaptureCard shopName="Nadia Bakes" onSubmit={vi.fn()} />);
    expect(screen.getByText(/Nadia Bakes/)).toBeInTheDocument();
  });

  it('asks for one field and no more', () => {
    // BACKEND.md: "Capture takes one field, the phone." Slots come from the
    // transcript. A second field here is a form, and a form is a bounce.
    render(<CaptureCard shopName="Nadia Bakes" onSubmit={vi.fn()} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('does not submit an empty number', async () => {
    const onSubmit = vi.fn();
    render(<CaptureCard shopName="Nadia Bakes" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows what the server said when the number is refused', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('That does not look like a Malaysian mobile number. Try 012-345 6789.'));
    render(<CaptureCard shopName="Nadia Bakes" onSubmit={onSubmit} />);

    await userEvent.type(screen.getByRole('textbox'), '0323456789');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Malaysian mobile/);
  });

  it('confirms rather than leaving the form sitting there', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CaptureCard shopName="Nadia Bakes" onSubmit={onSubmit} />);

    await userEvent.type(screen.getByRole('textbox'), '0123456789');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
```

and in `AskSheet.test.tsx`:

```tsx
  it('offers the card only when the server says the conversation qualified', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValue(
        streamOf('data: {"type":"done","conversationId":"c1","intent":{"qualified":false}}\n\n'),
      );
    render(<AskSheet seed="q" shopName="Nadia" onClose={vi.fn()} onAsk={onAsk} onCapture={vi.fn()} />);

    await waitFor(() => expect(onAsk).toHaveBeenCalled());
    // FRONTEND.md: "The client never decides this."
    expect(screen.queryByText(/nombor/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify RED, then write both**

`CaptureCard` uses `kuning` — its border, per DESIGN.md, because this is the first thing in the product that genuinely means *a human needs to act*. One `Field`, one `Button`, a `Callout` for the error, and a confirmation that replaces the form on success.

`AskSheet` renders it after the last turn when the most recent `done` carried `intent.qualified === true` and `onCapture` was provided, and hides it once submitted.

- [ ] **Step 3: Wire `ask.tsx`**

`onCapture` posts `{ conversationId, phone, consent: true }` to `/leads` and throws the API's message on failure, the way `apiFetch` already does for the owner surface.

- [ ] **Step 4: Run everything and commit**

Run: `pnpm --filter @curios/ui test && pnpm --filter @curios/web test && pnpm --filter @curios/web build && pnpm --filter @curios/web test budget`

```bash
git add packages/ui apps/web
git commit -m "feat(ui): the one field that turns a chat into a lead"
```

---

### Task 6: Gates, and a lead end to end

- [ ] **Step 1: All four gates**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build --force
```

- [ ] **Step 2: Capture a lead against the running stack**

`docker compose up -d && pnpm dev`, then at `http://localhost:3000/nadia`: open the sheet and hold a three-turn conversation with a quantity and a place in it. The card should appear only on the third turn. Enter `012-345 6789`.

Then check, and write down what you find:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c 'SELECT phone, score, slots, status FROM "Lead" ORDER BY "createdAt" DESC LIMIT 1;'
```

1. `phone` is stored as `+60123456789`, whatever spelling was typed.
2. `slots` is filled and `score` matches the number of non-null slots.
3. The mail is in Mailpit at `http://localhost:8075`, carrying the whole transcript.
4. The `wa.me` link in it opens WhatsApp on the right number with a prefilled reply.
5. Submitting a second number in the same conversation is refused.
6. **No phone number appears in the API log.**

**Report each honestly, including any you could not run.**

- [ ] **Step 3: Record the result and commit**

---

## Self-review

**Spec coverage.** Qualification is Tasks 1 and 2; `Lead` with its four guards is Task 3; slot extraction and the notification are Task 4; the capture card and its consent line are Task 5. The spec's PDPA in-scope items are covered — the consent line in Task 5, and "never log a phone number" as a global constraint plus a check in Task 6. The out-of-scope PDPA items, retention and owner-facing delete, appear nowhere by design, because the spec defers them to a slice with a screen to host them.

**Placeholder scan.** Tasks 4 and 5 describe some implementations in prose rather than pasting them — `notify.ts`'s body layout, `CaptureCard`'s markup, `AskSheet`'s render condition. Each is pinned by the tests immediately above it, and each is a component whose shape the design system already dictates. The parts where a mistake is invisible rather than obvious — the `wa.me` number format, the score being a count, extraction failing without losing the mail — all have explicit tests.

**Type consistency.** `qualifies` takes `{ mode, visitorMessages }` in Tasks 1, 2 and 3. `LeadJobData` is `{ leadId }` in Tasks 3 and 4. The three error codes are the same strings in the service, the allow-list, and the card's expectations. `slots` is `{ product, date, location }` with `string | null` fields everywhere it appears.

**One thing worth flagging before execution.** Task 3's dedupe test manipulates `createdAt` directly to simulate a 25-hour-old lead. That is a test writing a column the application never writes, which is usually a smell — here it is the only way to test a time window without either waiting a day or injecting a clock, and injecting a clock into one query to serve one test is the worse trade.

**What no test covers.** Whether the rule fires at a rate an owner finds useful. That needs traffic, and the spec says so: shipping something that under-captures is the intended direction, and slice 5's Questions dashboard is where the gaps get found.
