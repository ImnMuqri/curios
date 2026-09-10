# Slice 5 Plan 2 — Leads, and a way between screens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner sees every lead their page has captured, reads the conversation that produced each one, deletes any of them, and can move between their four screens without typing a URL.

**Architecture:** A read through `packages/db-read` like every other owner screen, a delete through `apps/api` like every other mutation, and a nav in the `/app` layout using the `Shell` that already exists. The transcript comes back with each lead rather than on demand — a lead has at most ten or so messages, and a second round trip to read them would cost more than sending them.

**Tech Stack:** TypeScript, Fastify, Prisma, React 19, Next 15 App Router, vitest + Testing Library.

**Spec:** `devDocs/slice-5-build-spec.md`, sections "Leads" and "The dashboard has no nav". Slice 4's spec is worth a glance too — it deferred the delete endpoint here and says why.

## Global Constraints

- **Never log a full phone number.** BACKEND.md asks for this explicitly and it is violated by accident, usually by logging a request body or an error object. The delete route logs the lead id and nothing else.
- **Only the owner's own rows.** Scope inside the query, never filter after the read. A delete is the one place where getting this wrong destroys somebody else's data rather than merely showing it.
- **404, not 403,** for a lead that is not yours. A 403 confirms the id exists, which is itself a leak — the shape `PageNotYoursError` and `QuestionNotYoursError` already use.
- **`apps/web` reads through `packages/db-read` as `curios_readonly`** and cannot write. Every mutation goes to `apps/api` via `apiFetch`.
- **Copy voice:** sentence case, plain, active verbs. Errors explain and instruct, never apologise. **Empty states are instructions, not moods.**
- **Design system:** every colour a token in `packages/ui/src/tokens.css`; the type scale is `11 / 12.5 / 14 / 17 / 22 / 32`. `merah` means destructive — delete is the second thing in the product to earn it, after Reject. `design-rules.test.ts` fails a hex or a seventh size and does **not** catch `rgb()`.
- **Motion:** 120ms colour transitions on press states and nothing else on the dashboard. The drawer is not the public page's sheet and gets no spring.
- Node 22, ESM. **Every relative import ends in `.js`**, even from `.ts`/`.tsx`.
- Gates from the repo root: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `apps/api` and `packages/db-read` tests need Postgres. `docker compose up -d`, and after any restart of the `tmpfs` test container: `cd packages/db && DATABASE_URL="$DATABASE_URL_TEST" pnpm exec prisma migrate deploy`, then `docker exec -i curios-postgres-test psql -U curios -d curios_test < packages/db/prisma/sql/readonly-role.sql`. **That role has gone missing three times now; if `db-read` fails to authenticate, this is why.**

---

### Task 1: The read

**Files:**
- Create: `packages/db-read/src/leads.query.ts`, `leads.query.test.ts`
- Modify: `packages/db-read/src/index.ts`

**Interfaces:**
- Consumes: the `Lead` model from slice 4.
- Produces:

```ts
export interface LeadTranscriptLine { role: 'USER' | 'ASSISTANT'; content: string }
export interface OwnerLead {
  id: string;
  phone: string;
  score: number;
  slots: { product: string | null; date: string | null; location: string | null } | null;
  status: 'NEW' | 'CONTACTED' | 'CLOSED';
  createdAt: Date;
  transcript: LeadTranscriptLine[];
}
export function getLeads(accountId: string, options?: { limit?: number }): Promise<OwnerLead[]>
```

- [ ] **Step 1: Write the failing test**

`packages/db-read/src/leads.query.test.ts`, following `questions.query.test.ts` for the fixture shape:

```ts
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getLeads } from './leads.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let mine = '';
let theirs = '';

async function anOwnerWithAPage(): Promise<{ accountId: string; pageId: string }> {
  const slug = randomUUID().slice(0, 8);
  const account = await write.account.create({
    data: {
      email: `ld-${randomUUID()}@example.com`,
      pages: { create: { handle: `ld-${slug}`, skeleton: `ld-${slug}`, displayName: 'L' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  return { accountId: account.id, pageId: account.pages[0]?.id ?? '' };
}

async function aLead(
  pageId: string,
  phone: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const conversation = await write.conversation.create({ data: { pageId } });
  for (const [role, content] of [
    ['USER', 'nak kek butter 2kg'],
    ['ASSISTANT', 'RM160 untuk 2kg.'],
  ] as const) {
    await write.message.create({ data: { conversationId: conversation.id, role, content } });
  }
  const lead = await write.lead.create({
    data: { pageId, conversationId: conversation.id, phone, ...extra },
  });
  return lead.id;
}

beforeAll(async () => {
  const a = await anOwnerWithAPage();
  const b = await anOwnerWithAPage();
  mine = a.accountId;
  theirs = b.accountId;

  await aLead(a.pageId, '+60123456789', {
    score: 2,
    slots: { product: 'kek butter 2kg', date: null, location: 'Klang' },
    createdAt: new Date('2026-09-01T10:00:00Z'),
  });
  await aLead(a.pageId, '+60129999999', { createdAt: new Date('2026-09-05T10:00:00Z') });
  await aLead(b.pageId, '+60111111111');
});

describe('getLeads', () => {
  it('returns the newest first, because a cold lead is a lost one', async () => {
    const leads = await getLeads(mine);
    expect(leads.map((l) => l.phone)).toEqual(['+60129999999', '+60123456789']);
  });

  it('carries the transcript with each lead', async () => {
    // BACKEND.md: the transcript is "the feature people pay for". Fetching it
    // on demand would mean a second round trip to read ten short rows.
    const leads = await getLeads(mine);
    const withSlots = leads.find((l) => l.phone === '+60123456789');
    expect(withSlots?.transcript.map((line) => line.content)).toEqual([
      'nak kek butter 2kg',
      'RM160 untuk 2kg.',
    ]);
  });

  it('carries the slots and the score', async () => {
    const leads = await getLeads(mine);
    const withSlots = leads.find((l) => l.phone === '+60123456789');
    expect(withSlots?.score).toBe(2);
    expect(withSlots?.slots).toMatchObject({ product: 'kek butter 2kg', location: 'Klang' });
  });

  it('copes with a lead whose extraction never filled anything in', async () => {
    // slots is null until the job runs, and can stay null if extraction
    // failed -- which slice 4 deliberately allows, because a lead with no
    // slots is worth far more than no lead.
    const leads = await getLeads(mine);
    expect(leads.find((l) => l.phone === '+60129999999')?.slots).toBeNull();
  });

  it('returns nothing for an account that owns none of them', async () => {
    // Scoped in the query, not filtered after the read. This is a phone
    // number; showing the wrong owner's is the worst read bug in the product.
    const leads = await getLeads(theirs);
    expect(leads.map((l) => l.phone)).toEqual(['+60111111111']);
  });

  it('does not write, so the read-only role can run it', async () => {
    await expect(getLeads(mine)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `pnpm --filter @curios/db-read test leads`
Expected: FAIL — cannot resolve `./leads.query.js`.

- [ ] **Step 3: Write it**

`packages/db-read/src/leads.query.ts`:

```ts
import { prismaRead } from './client.js';

export interface LeadTranscriptLine {
  role: 'USER' | 'ASSISTANT';
  content: string;
}

export interface LeadSlots {
  product: string | null;
  date: string | null;
  location: string | null;
}

export interface OwnerLead {
  id: string;
  phone: string;
  score: number;
  /** Null until the extraction job runs, and null forever if it failed. */
  slots: LeadSlots | null;
  status: 'NEW' | 'CONTACTED' | 'CLOSED';
  createdAt: Date;
  transcript: LeadTranscriptLine[];
}

/**
 * Every lead this owner's pages have captured, newest first.
 *
 * Newest first because a lead goes cold: the one captured an hour ago is the
 * one worth acting on, and burying it under a month of older ones is the
 * difference between a dashboard and an archive.
 *
 * The transcript comes back with each lead rather than on request. BACKEND.md
 * calls it "the feature people pay for", a conversation is a handful of short
 * rows, and a second round trip to fetch ten strings costs more than sending
 * them did.
 *
 * Scoped through the page's owner inside the query. This is a phone number --
 * showing the wrong owner's is the worst read bug this product could have.
 */
export async function getLeads(
  accountId: string,
  options: { limit?: number } = {},
): Promise<OwnerLead[]> {
  const rows = await prismaRead.lead.findMany({
    where: { page: { accountId } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options.limit ?? 50, 100),
    select: {
      id: true,
      phone: true,
      score: true,
      slots: true,
      status: true,
      createdAt: true,
      conversation: {
        select: {
          messages: { select: { role: true, content: true }, orderBy: { createdAt: 'asc' } },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    phone: row.phone,
    score: row.score,
    // Prisma types a Json column as JsonValue, which is not the shape this
    // codebase writes into it. The cast is at the boundary, once, rather than
    // every caller re-deciding what a slot is.
    slots: (row.slots as LeadSlots | null) ?? null,
    status: row.status,
    createdAt: row.createdAt,
    transcript: row.conversation.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  }));
}
```

Export `getLeads`, `OwnerLead`, `LeadSlots` and `LeadTranscriptLine` from `packages/db-read/src/index.ts`.

- [ ] **Step 4: Run to verify GREEN, then commit**

Run: `pnpm --filter @curios/db-read test`

```bash
git add packages/db-read
git commit -m "feat(db-read): the leads an owner has never been able to see"
```

---

### Task 2: The delete

The PDPA obligation slice 4 deferred for want of a screen to host it.

**Files:**
- Create: `apps/api/src/modules/leads/lead.delete.test.ts`
- Modify: `apps/api/src/modules/leads/lead.service.ts`
- Modify: `apps/api/src/modules/leads/lead.routes.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `captureLead` and its module from slice 4.
- Produces:
  - `deleteLead(prisma, accountId: string, leadId: string): Promise<void>`
  - `LeadNotYoursError` — 404, code `NOT_FOUND`.
  - `DELETE /leads/:id`, session-guarded.

**Why a new route registration:** `/leads` today lives in an anonymous, rate-limited scope, because a visitor posts to it. `DELETE /leads/:id` is an owner action and must sit behind `requireSession`. The same path prefix in two scopes is fine — Fastify routes by method and path, and these differ in both.

- [ ] **Step 1: Write the failing test**

`apps/api/src/modules/leads/lead.delete.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { deleteLead } from './lead.service.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

let accountId = '';
let strangerAccountId = '';
let leadId = '';

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');

  const account = await prisma.account.create({
    data: {
      email: 'n@example.com',
      pages: {
        create: { handle: 'nadia', skeleton: 'nadia', displayName: 'Nadia Bakes' },
      },
    },
    include: { pages: true },
  });
  accountId = account.id;
  const pageId = account.pages[0]?.id ?? '';

  const conversation = await prisma.conversation.create({ data: { pageId } });
  // Two messages, so the test below can prove they survive the delete rather
  // than asserting zero and passing because none were ever created.
  for (const [role, content] of [
    ['USER', 'nak kek butter 2kg'],
    ['ASSISTANT', 'RM160 untuk 2kg.'],
  ] as const) {
    await prisma.message.create({ data: { conversationId: conversation.id, role, content } });
  }
  const lead = await prisma.lead.create({
    data: { pageId, conversationId: conversation.id, phone: '+60123456789' },
  });
  leadId = lead.id;

  const stranger = await prisma.account.create({ data: { email: 'stranger@example.com' } });
  strangerAccountId = stranger.id;
});

describe('deleteLead', () => {
  it('removes the lead', async () => {
    await deleteLead(prisma, accountId, leadId);
    expect(await prisma.lead.count()).toBe(0);
  });

  it('leaves the conversation alone', async () => {
    // The lead is the personal data. The conversation is a visitor's chat with
    // a public page and it feeds the questions screen -- deleting it would
    // quietly rewrite an owner's own ask counts as a side effect of clearing
    // one phone number.
    await deleteLead(prisma, accountId, leadId);
    expect(await prisma.conversation.count()).toBe(1);
    expect(await prisma.message.count()).toBe(2);
  });

  it('refuses a lead belonging to someone else', async () => {
    // 404, not 403. And this one matters more than the read: a broken scope
    // here destroys another owner's data rather than merely showing it.
    await expect(deleteLead(prisma, strangerAccountId, leadId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await prisma.lead.count()).toBe(1);
  });

  it('refuses a lead that does not exist', async () => {
    await expect(deleteLead(prisma, accountId, 'nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `pnpm --filter @curios/api test lead.delete`
Expected: FAIL — `deleteLead` is not exported.

- [ ] **Step 3: Write the service**

Append to `apps/api/src/modules/leads/lead.service.ts`:

```ts
export class LeadNotYoursError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // 404, not 403: a 403 confirms the id exists. The same shape as
    // PageNotYoursError and QuestionNotYoursError.
    super('No such lead.');
    this.name = 'LeadNotYoursError';
  }
}

/**
 * BACKEND.md's owner-facing delete, per lead.
 *
 * Scoped in the query rather than checked after the read. Every ownership
 * check in this codebase has that shape, and this is the one where getting it
 * wrong destroys another owner's data rather than merely showing it.
 *
 * The Conversation is left alone deliberately. The lead is the personal data;
 * the conversation is a visitor's chat with a public page, and it feeds the
 * questions screen -- cascading into it would silently rewrite an owner's own
 * ask counts as a side effect of clearing one phone number.
 */
export async function deleteLead(
  prisma: PrismaClient,
  accountId: string,
  leadId: string,
): Promise<void> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, page: { accountId } },
    select: { id: true },
  });
  if (!lead) throw new LeadNotYoursError();

  await prisma.lead.delete({ where: { id: lead.id } });
}
```

- [ ] **Step 4: The route**

In `apps/api/src/modules/leads/lead.routes.ts`, add a second exported plugin rather than widening the first — the anonymous capture route and this owner action belong in different scopes:

```ts
/**
 * Owner actions on leads. A separate plugin from `leadRoutes` because that one
 * is registered in an anonymous, rate-limited scope for the visitor's POST,
 * and this must sit behind requireSession. Same path prefix, different method
 * and different scope; Fastify routes on both.
 */
export const ownerLeadRoutes: FastifyPluginAsyncZod = async (app) => {
  app.delete(
    '/leads/:id',
    { schema: { params: z.object({ id: z.string().min(1).max(64) }) } },
    async (request, reply) => {
      if (!request.account) throw new UnauthenticatedError();

      await deleteLead(app.prisma, request.account.id, request.params.id);
      // The id and nothing else. A phone number must not reach the log, and
      // logging the deleted row on the way past is exactly how that happens.
      request.log.info({ leadId: request.params.id }, 'lead deleted');
      return reply.send({ status: 'deleted' });
    },
  );
};
```

importing `UnauthenticatedError` from `../../plugins/session.js` and `deleteLead` from the service.

Register `ownerLeadRoutes` in `app.ts` inside the session-guarded scope at line ~95, beside `questionRoutes`. `NOT_FOUND` is already in `DOMAIN_ERROR_CODES`.

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @curios/api test`

```bash
git add apps/api
git commit -m "feat(api): an owner can delete a lead"
```

---

### Task 3: The screen

**Files:**
- Create: `apps/web/app/app/leads/page.tsx`
- Create: `apps/web/app/app/leads/lead-list.tsx`, `lead-list.test.tsx`
- Create: `apps/web/app/app/leads/leads.module.css`

**Interfaces:**
- Consumes: `getLeads` and `OwnerLead` from Task 1; `DELETE /leads/:id` from Task 2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

`apps/web/app/app/leads/lead-list.test.tsx`:

```tsx
const leads: OwnerLead[] = [
  {
    id: 'l1',
    phone: '+60123456789',
    score: 2,
    slots: { product: 'kek butter 2kg', date: null, location: 'Klang' },
    status: 'NEW',
    createdAt: new Date('2026-09-05T10:00:00Z'),
    transcript: [
      { role: 'USER', content: 'nak kek butter 2kg' },
      { role: 'ASSISTANT', content: 'RM160 untuk 2kg.' },
    ],
  },
];

describe('LeadList', () => {
  it('shows the number, because that is what the owner came for', () => {
    render(<LeadList leads={leads} onDelete={vi.fn()} />);
    expect(screen.getByText('+60123456789')).toBeInTheDocument();
  });

  it('offers a WhatsApp link that opens on the right number', () => {
    // Digits only, no plus. The same rule the notification learned: a wa.me
    // link carrying a plus opens WhatsApp on a broken number.
    render(<LeadList leads={leads} onDelete={vi.fn()} />);
    expect(screen.getByRole('link', { name: /whatsapp/i })).toHaveAttribute(
      'href',
      expect.stringContaining('https://wa.me/60123456789'),
    );
  });

  it('keeps the transcript closed until asked', () => {
    // The list is for scanning. A dozen transcripts open at once is not a
    // list, and the point of the drawer is reading one against its number.
    render(<LeadList leads={leads} onDelete={vi.fn()} />);
    expect(screen.queryByText('nak kek butter 2kg')).not.toBeInTheDocument();
  });

  it('opens the transcript on request', async () => {
    render(<LeadList leads={leads} onDelete={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /transcript/i }));
    expect(screen.getByText('nak kek butter 2kg')).toBeInTheDocument();
  });

  it('shows what the customer asked for when extraction found it', () => {
    render(<LeadList leads={leads} onDelete={vi.fn()} />);
    expect(screen.getByText(/kek butter 2kg/)).toBeInTheDocument();
  });

  it('renders a lead whose extraction found nothing', () => {
    // slots is null when the job failed, which slice 4 deliberately allows.
    // A screen that needs slots to render would lose the lead entirely.
    const bare: OwnerLead[] = [{ ...leads[0]!, id: 'l2', slots: null, score: 0 }];
    render(<LeadList leads={bare} onDelete={vi.fn()} />);
    expect(screen.getByText('+60123456789')).toBeInTheDocument();
  });

  it('asks before deleting', async () => {
    // A phone number is the one thing on this screen that cannot be recovered
    // by reloading. One misplaced tap should not destroy it.
    const onDelete = vi.fn();
    render(<LeadList leads={leads} onDelete={onDelete} />);

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(onDelete).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));
    expect(onDelete).toHaveBeenCalledWith('l1');
  });

  it('says what failed when a delete does not land', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('That failed. Try again.'));
    render(<LeadList leads={leads} onDelete={onDelete} />);

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/try again/i);
  });

  it('says what to do when there are none yet', () => {
    render(<LeadList leads={[]} onDelete={vi.fn()} />);
    expect(screen.getByText(/share your link/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify RED, then write the components**

`lead-list.tsx` holds `LeadList` (presentational: `leads`, `onDelete`) and `Leads` (the `'use client'` wrapper closing over `apiFetch` and calling `router.refresh()`) — the split `review-queue.tsx` and `question-list.tsx` both use.

State: `open` (the id whose transcript is showing, at most one), `confirming` (the id awaiting confirmation), `error`, `busy`. Delete is `<Button variant="danger">` — `merah` means destructive, and this is the second thing in the product to earn it after Reject.

`page.tsx` is a Server Component: `resolveOwner`, `redirect('/signin')` if none, `getLeads(owner.accountId)`, render inside `Shell title="Leads"`.

- [ ] **Step 3: Run and commit**

Run: `pnpm --filter @curios/web test && pnpm lint && pnpm typecheck`

```bash
git add apps/web
git commit -m "feat(web): the leads, and the conversation behind each"
```

---

### Task 4: The nav

**Files:**
- Create: `packages/ui/src/nav/Nav.tsx`, `Nav.module.css`, `Nav.test.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `apps/web/app/app/layout.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `<Nav items={{ href: string; label: string }[]} current?: string />`, exported from `@curios/ui`.

**Why the current page is a prop rather than read from the router:** `packages/ui` does not import Next, which is what lets it render in a plain vitest jsdom. The layout knows the pathname; the component does not need to.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/nav/Nav.test.tsx`:

```tsx
const items = [
  { href: '/app/review', label: 'Review' },
  { href: '/app/questions', label: 'Questions' },
  { href: '/app/leads', label: 'Leads' },
  { href: '/app/settings', label: 'Settings' },
];

describe('Nav', () => {
  it('renders every destination as a real link', () => {
    // Real anchors, so middle-click and open-in-new-tab work and the
    // dashboard is navigable before any JavaScript runs.
    render(<Nav items={items} />);
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Leads' })).toHaveAttribute('href', '/app/leads');
  });

  it('marks the current page for assistive technology, not only visually', () => {
    render(<Nav items={items} current="/app/leads" />);
    expect(screen.getByRole('link', { name: 'Leads' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks nothing when the current page is not one of them', () => {
    render(<Nav items={items} current="/app/onboarding" />);
    expect(screen.queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
  });

  it('is a navigation landmark, so it can be skipped', () => {
    render(<Nav items={items} />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify RED, then write it**

`Nav.tsx` renders `<nav>` containing an `<a>` per item, with `aria-current="page"` on the one whose `href` equals `current`. The styling is a horizontal row using `var(--font-mono)` at `var(--text-sm)`, uppercase with `0.13em` tracking — the utility voice, the same treatment `Field`'s label and the questions ask-count already use. The current item gets `--ink`; the rest get `--muted`, with a 120ms colour transition and nothing else.

- [ ] **Step 3: Wire it into the layout**

`apps/web/app/app/layout.tsx` renders `<Nav>` above `{children}` inside the `Shell`. The layout is a Server Component and cannot read `usePathname`, so either make a small `'use client'` wrapper that does, or pass no `current` at all.

**Prefer the wrapper.** A nav that never marks where you are is a nav that does not help, and `aria-current` is the difference between orientation and a row of links. The wrapper is four lines and imports `usePathname` from `next/navigation`.

- [ ] **Step 4: Run everything and commit**

Run: `pnpm --filter @curios/ui test && pnpm --filter @curios/web test && pnpm lint && pnpm typecheck`

```bash
git add packages/ui apps/web
git commit -m "feat(ui): four screens an owner can actually reach"
```

---

### Task 5: Gates, and a lead deleted for real

- [ ] **Step 1: All four gates**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build --force
```

- [ ] **Step 2: Walk it**

`docker compose up -d && pnpm dev`, sign in, and:

1. `/app/leads` lists the lead captured during slice 4, newest first.
2. Its transcript opens and closes.
3. The WhatsApp link opens on `60123456789` with no plus.
4. Delete asks first, then removes the row.
5. The nav moves between review, questions, leads and settings, and marks where you are.
6. **After deleting, check the conversation survived** — the questions screen must not have lost an ask count:

```bash
docker exec -i curios-postgres psql -U curios -d curios -c 'SELECT count(*) AS conversations FROM "Conversation";'
docker exec -i curios-postgres psql -U curios -d curios -c 'SELECT sum("askCount") AS asks FROM "Question";'
```

Run both before and after the delete. Neither should change.

7. **No phone number in the API log.**

**Report each honestly, including any not run.**

- [ ] **Step 3: Record the result and commit**

---

## Self-review

**Spec coverage.** The spec's Leads section is Tasks 1–3, the delete is Task 2, the nav is Task 4. The spec's "not in scope: status transitions" needs no task — `status` is read and displayed, never changed, and nothing offers a control that would.

**Placeholder scan.** Tasks 3 and 4 describe components rather than pasting them, the same trade slices 3–5 have made throughout: the wrapper/presentational split now has four existing examples in this repo, and a fifth copy in a plan is a version to drift from. The tests above each are complete, including the two that encode real product rules — the `wa.me` link carrying no plus, and delete asking first.

**One near-miss caught in review.** Task 2's conversation-survives test originally asserted `message.count()` was 0 against a fixture that created no messages — it would have passed while proving nothing, which is the worst kind of green. The fixture now creates two and the test asserts two survive.

**Type consistency.** `OwnerLead` carries `slots: LeadSlots | null` in Tasks 1 and 3, and the null case has its own test in both. `deleteLead(prisma, accountId, leadId)` keeps that argument order in the service, the test and the route. `Nav`'s `current` is a `string | undefined` compared against `href`.

**What no test covers.** Whether an owner reading this list knows which lead to call first. Score and recency are both shown and neither is proven to be the right cue — that needs someone with real leads, and it is the same open question ask-count ranking has on the questions screen.
