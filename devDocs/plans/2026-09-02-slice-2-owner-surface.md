# Slice 2, plan 2b — the owner surface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner screens. Sign in, land on a verification link that works, claim a handle, paste a URL, watch the job, review facts one at a time, publish — and add a second sign-in method.

**Architecture:** `apps/web` renders and reads only. It holds a SELECT-only Postgres connection through `packages/db-read` and may never import `packages/db`. Every mutation is a `fetch` from the browser to `apps/api` with `credentials: 'include'`. The session boundary is three layers, and only the third is a security boundary: middleware checks the cookie is *present* and redirects (Edge, no database); the `/app` layout validates it *against the database* and redirects (Node); `apps/api` re-authorizes every mutation independently.

**Tech Stack:** Next 15 App Router, React 19, TanStack Query for server state, vitest 2 with `@testing-library/react` and jsdom.

**Spec:** `devDocs/slice-2-build-spec.md` — *Architecture → The write path*, *The session*, *Where the session is validated*, *CSRF*, *Onboarding*, *The fact review screen*, *Publishing*. Plus `devDocs/FRONTEND.md` — *Routes*, *Dashboard rules*, *Onboarding*, *State*, *Accessibility floor*.

**Predecessors:** `devDocs/plans/2026-08-29-slice-2-auth-foundation.md` (plan 1) and `devDocs/plans/2026-09-01-slice-2-owner-api-surface.md` (plan 2a). Both complete and merged. Every endpoint this plan calls already exists, is tested, and was reviewed.

## Global Constraints

- **`apps/web` never writes.** It connects as `curios_readonly`. Any mutation is a `fetch` to `apps/api`. A write attempted from a Server Component fails in Postgres with SQLSTATE 42501, which is the boundary working, not a bug to route around.
- **`apps/web` must never import `packages/db`.** Reads go through `packages/db-read`.
- **Every browser→API call passes `credentials: 'include'`** and `content-type: application/json`. Both are load-bearing: the cookie does not travel without the first, and the second is one of the three things standing in for a CSRF token.
- **Middleware is never a security boundary.** It checks cookie presence and redirects. Nothing is authorized because middleware let a request through.
- **No blank prompt boxes** (FRONTEND.md). Every input is a control with a fixed set of answers, except the two places a human writes prose: a pinned answer, and a fact correction.
- **One primary action per screen.** Everything else is secondary.
- **Empty states are instructions, not moods.** "No facts to review yet. Paste your website address above and we will read it." Never "Nothing here!"
- **Nothing sets `verified: true` except an explicit human action on one specific fact.** No select-all, no accept-all-remaining, no bulk control of any shape. This is the product's single hard rule and it constrains the UI, not only the API.
- Never read `.env`. For key names: `grep -oE '^[A-Z_]+=' .env`.
- Four gates, all passing before a task is done: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

---

## Pre-flight scan

### Shared files and interfaces between tasks

| Tasks | Producer → consumer | Finding |
|---|---|---|
| T1 → T4,T5,T6,T7,T8 | `middleware.ts`, the `/app` layout, `requireOwner()` | clean — every authed screen sits under the layout T1 creates |
| T1 → T2 | the redirect target `/signin` | **F2** below |
| T2 → T3 | `apiFetch()`, the shared browser→API caller | clean — T2 creates it, everything after uses it |
| T3 → — | `/verify` and `/reset` | **F1** below: these complete flows that ALREADY SHIP |
| T4 → T5,T6,T7 | a `Page` exists for the account; `getOwnerPage` tells us | clean — 2a's Task 8 built exactly this read |
| T5 → T6 | an ingestion id, and a resolved job | clean |
| T6 → T7 | verified facts exist | clean — publish does not require them, see **F5** |
| T2,T8 → `/app/settings` | T8 creates it; 2a's OAuth link flow already redirects there | **F3** below |

### Findings and rulings

- **F1 — the shipped API already sends real users to five routes that do not exist.** `apps/web` serves exactly one route today, `/[handle]`. Meanwhile `apps/api`, merged and in production, mails people links to `${APP_URL}/verify?token=…` and `${APP_URL}/reset?token=…`, and its OAuth callback redirects to `${APP_URL}/app`, `${APP_URL}/app/settings?linked=google`, and `${APP_URL}/?signin=cancelled`. Every one of those is a 404 right now. Verified by listing every `page.tsx` under `apps/web/app` and every `APP_URL` destination in `apps/api/src`.
  **Ruling:** this reorders the plan. `/verify` and `/reset` are not screens to add later — they are the missing half of flows that already ship, and a user who signs up today gets an email whose link 404s. They come early, in Task 3, before onboarding. Rejected the tidier ordering that builds sign-in, then onboarding, then the email landings: it leaves the broken thing broken longest.

- **F2 — the OAuth cancel redirect points at a page this plan does not build.** The callback sends a cancelling user to `${APP_URL}/?signin=cancelled`. The root route is a marketing page, out of scope for this slice and unlikely to exist for a while.
  **Ruling:** change the API's cancel destination to `/signin?cancelled=1` in Task 2, alongside the screen that will receive it. That is a two-line change in `apps/api/src/modules/auth/auth.routes.ts` and it is this plan's business, because this plan owns where a cancelling user should land. Rejected building a placeholder root page to catch a redirect — a page that exists only to absorb a query parameter is worse than a correct redirect. Cost if wrong: one API test asserts on the redirect target and must be updated with it.

- **F3 — `/app/settings` is already a redirect target.** 2a's link flow sends a successful Google link to `${APP_URL}/app/settings?linked=google`. Task 8 builds that screen, so between Task 1 and Task 8 the link flow lands on a 404. That is not a regression this plan introduces — it is already true on `main` — but it means Task 8 cannot be dropped from the slice without leaving the API pointing at nothing.

- **F4 — the layout and the middleware answer different questions, and confusing them is how the boundary rots.** Middleware runs on the Edge where Prisma cannot, so it can only check that a cookie is present. The layout runs on Node and validates it against the database via `getOwnerSession`. A reader who sees two auth checks will eventually delete one as redundant.
  **Ruling:** the two carry comments naming what each does and does not prove, and Task 1's tests assert both behaviours separately — that middleware redirects on a *missing* cookie, and that the layout redirects on a *present but invalid* one. Neither test passes if the other layer is doing its job. Cost if wrong: two tests instead of one.

- **F5 — publishing does not require a verified fact, and should not.** The spec says publish is "a deliberate owner action that sets `published: true`", nothing more, and 2a implemented exactly that. It is tempting to gate the publish button on having reviewed something.
  **Ruling:** do not add a client-side gate the API does not have. A page with no verified facts is a valid page — it still shows links, which FRONTEND.md calls "the boring part that pays the rent". Rejected disabling the button until a fact is verified: that invents a rule neither the spec nor the API has, and it would strand an owner who only wants a link page.

- **F6 — TanStack Query is specified but only two screens need it.** FRONTEND.md says server state is TanStack Query and there is no other store. The onboarding poll and the review queue genuinely want it — polling with backoff, invalidation after a mutation. The sign-in and verification screens are one-shot posts that want nothing.
  **Ruling:** introduce the provider in Task 5, where the poll first needs it, and use plain `fetch` before that. Rejected adding it in Task 1 for consistency: a provider wrapping screens that make no queries is ceremony, and the diff that introduces it should be the diff that shows why.

- **F8 — the session cookie's NAME has the same problem its hash and TTLs had, for the third time.** Middleware must check the cookie is present and the layout must read its value, so `apps/web` needs the name. It lives in `apps/api/src/modules/auth/session.service.ts`, which `apps/web` cannot import. Plan 2a hit this twice — with `hashSessionValue` and then with the two TTLs — and both times the answer was to move the definition into `packages/core` and re-export it from its old home so no call site changed.
  **Ruling:** same answer, third time. `SESSION_COOKIE` moves to `packages/core/src/cookie.ts` in Task 1, and `session.service.ts` re-exports it. Rejected hardcoding `'curios_session'` in the web app: a string literal copied into a second package drifts, and the failure mode here is silent and horrible — a browser holding a cookie nobody reads, so every authed page redirects to sign-in and the sign-in works. That this is the third instance is itself worth noticing: anything the API and the web app must agree on belongs in `packages/core` from the start, not after the second copy.

- **F7 (minor, not ruled)** — `apps/web` has no test for a Server Component today; both existing tests cover client components. Task 1 is the first Server Component with logic worth testing, and it does it by extracting the decision into a plain function the test calls directly rather than rendering the component. If that shape proves awkward in Task 1, report it rather than working around it.

---
### Task 1: The session boundary — middleware, the layout, and one cookie name

**Files:**
- Create: `apps/web/middleware.ts`, `apps/web/app/app/layout.tsx`, `apps/web/app/app/session.ts`
- Create: `packages/core/src/cookie.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json`, `apps/api/src/modules/auth/session.service.ts`
- Test: `apps/web/middleware.test.ts`, `apps/web/app/app/session.test.ts`

**Interfaces:**
- Consumes: `getOwnerSession` from `@curios/db-read` (plan 2a, Task 4).
- Produces: `SESSION_COOKIE` from `@curios/core`; `resolveOwner(value)`; the `/app` layout every later task's screen sits under.

**Why the cookie name moves.** `apps/web` needs to read the session cookie by name, and the name lives in `apps/api/src/modules/auth/session.service.ts`, which `apps/web` cannot import. This is the third time this exact problem has come up — plan 2a moved the session hash and both TTLs into `packages/core` for it — and it gets the same answer for the same reason: a string literal copied into a second package is a string literal that drifts, and the failure mode is a browser holding a cookie nobody reads.

- [ ] **Step 1: Move the cookie name into `packages/core`**

Create `packages/core/src/cookie.ts`:

```ts
/**
 * The name of the session cookie.
 *
 * Here rather than in `apps/api` because `apps/web` reads it too -- middleware
 * checks it is present, and the authed layout hands its value to
 * `getOwnerSession` -- and cannot import from an app. The same reasoning that
 * moved the session hash and the TTLs here: one definition, or the two sides
 * eventually disagree and the symptom is a cookie nobody reads.
 */
export const SESSION_COOKIE = 'curios_session';
```

Add to `packages/core/src/index.ts`, for the Node-side consumers:

```ts
export { SESSION_COOKIE } from './cookie.js';
```

**And give it a subpath export, which middleware needs and the barrel cannot provide.**
`middleware.ts` is bundled for the Edge runtime. Importing from the `@curios/core` barrel drags
in `session-hash.ts`, which imports `node:crypto`, which the Edge runtime does not have — the
build fails with `UnhandledSchemeError: node:crypto`. This has not bitten before because
`apps/web` only ever imported TYPES from core, and types vanish at build time. This is the first
module to pull a runtime value from core into an Edge bundle.

In `packages/core/package.json`, add the subpath beside the existing root export:

```json
  "exports": {
    ".": "./src/index.ts",
    "./cookie": "./src/cookie.ts"
  },
```

Rejected `sideEffects: false` on the package, which would instead let webpack tree-shake the
unused re-export: that makes the build depend on the bundler proving `hashSessionValue` is
unreachable, and the day that proof fails the error is the same baffling `UnhandledSchemeError`
with no visible cause. The subpath puts the Edge constraint at the import site, which is where
the next person needs to see it.

In `apps/api/src/modules/auth/session.service.ts`, replace the local declaration with a re-export so no plan 1 or 2a call site changes:

```ts
import { SESSION_COOKIE as CORE_SESSION_COOKIE } from '@curios/core';

export const SESSION_COOKIE = CORE_SESSION_COOKIE;
```

Every existing API test passing unmodified is the evidence this moved nothing.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/middleware.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@curios/core/cookie';
import { middleware } from './middleware.js';

const request = (path: string, cookie?: string) => {
  const req = new NextRequest(new URL(`http://localhost:3000${path}`));
  if (cookie !== undefined) req.cookies.set(SESSION_COOKIE, cookie);
  return req;
};

describe('middleware', () => {
  it('sends a caller with no cookie to sign in', () => {
    const res = middleware(request('/app/onboarding'));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname).toBe('/signin');
  });

  it('remembers where they were going', () => {
    const res = middleware(request('/app/onboarding'));

    // Bouncing someone to sign in and then dumping them on a dashboard they
    // did not ask for is a small rudeness that compounds on a slow phone.
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.searchParams.get('next')).toBe('/app/onboarding');
  });

  it('lets a caller with a cookie through WITHOUT validating it', () => {
    // The whole point of this layer: it runs on the Edge, where Prisma cannot,
    // so it can only check presence. A forged value passes here and is caught
    // by the layout. This test exists so nobody "fixes" that by adding a
    // check middleware cannot perform.
    const res = middleware(request('/app', 'a-value-this-server-never-issued'));

    expect(res.status).toBe(200);
  });
});
```

Create `apps/web/app/app/session.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const getOwnerSession = vi.fn();
vi.mock('@curios/db-read', () => ({ getOwnerSession }));

const { resolveOwner } = await import('./session.js');

describe('resolveOwner', () => {
  it('resolves a valid cookie value to its account', async () => {
    getOwnerSession.mockResolvedValueOnce({ accountId: 'acc-1' });

    expect(await resolveOwner('a-real-value')).toEqual({ accountId: 'acc-1' });
    // Asserting the ARGUMENT, not just the return. Without this a version that
    // validated some other value -- a stale closure, a hardcoded literal --
    // passes, and that version either locks everyone out or, far worse, hands
    // everyone whichever account that value happens to belong to.
    expect(getOwnerSession).toHaveBeenCalledWith('a-real-value');
  });

  it('refuses a cookie the database does not recognise', async () => {
    // This is the case middleware cannot catch and this layer exists for: a
    // present cookie that is expired, revoked, or forged.
    getOwnerSession.mockResolvedValueOnce(null);

    expect(await resolveOwner('forged')).toBeNull();
    expect(getOwnerSession).toHaveBeenCalledWith('forged');
  });

  it('does not go to the database when there is no cookie at all', async () => {
    getOwnerSession.mockClear();

    expect(await resolveOwner(undefined)).toBeNull();
    expect(getOwnerSession).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @curios/web test`
Expected: FAIL — cannot resolve `./middleware.js` and `./session.js`.

- [ ] **Step 4: Write the middleware**

Create `apps/web/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
// The subpath, NOT the '@curios/core' barrel. This file is bundled for the
// Edge runtime, and the barrel re-exports a module importing node:crypto,
// which the Edge runtime does not have. Importing the barrel here fails the
// build with UnhandledSchemeError.
import { SESSION_COOKIE } from '@curios/core/cookie';

/**
 * Checks the cookie is PRESENT. Nothing more, and deliberately.
 *
 * This runs on the Edge runtime, where Prisma cannot run, so it cannot ask the
 * database whether the session is real. A forged or expired cookie passes here
 * and is caught by the `/app` layout, which runs on Node and does ask.
 *
 * So this is a redirect convenience, never a security boundary. Nothing is
 * authorized because this let a request through, and `apps/api` re-authorizes
 * every mutation independently regardless of what happened here.
 */
export function middleware(request: NextRequest): NextResponse {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const signin = new URL('/signin', request.url);
  signin.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(signin);
}

export const config = { matcher: '/app/:path*' };
```

- [ ] **Step 5: Write the layout and its extracted decision**

Create `apps/web/app/app/session.ts`:

```ts
import { getOwnerSession } from '@curios/db-read';

/**
 * Whose session this is, or null.
 *
 * Extracted from the layout so the decision can be tested without rendering a
 * Server Component. `getOwnerSession` is read-only by design -- it does NOT
 * extend the session, because `apps/web` holds a SELECT-only connection and
 * extending is a write. The API refreshes on its own requests, which is where
 * that write belongs.
 */
export async function resolveOwner(
  value: string | undefined,
): Promise<{ accountId: string } | null> {
  if (!value) return null;
  return getOwnerSession(value);
}
```

Create `apps/web/app/app/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
// The barrel here, unlike middleware.ts. This file runs on Node, so the
// barrel's transitive node:crypto import is fine. The split between the two
// is deliberate -- see the comment in middleware.ts.
import { SESSION_COOKIE } from '@curios/core';
import { resolveOwner } from './session.js';

/**
 * The second of the three session layers, and the first that proves anything.
 *
 * Middleware already redirected anyone with no cookie at all. What reaches
 * here is a cookie that exists and may still be expired, revoked or forged,
 * and this is where the database is asked.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  const owner = await resolveOwner(value);

  if (!owner) redirect('/signin');

  return <main className="app-shell">{children}</main>;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @curios/web test`
Expected: PASS, 6 new tests.

Then run the whole workspace: `pnpm test`. Every `apps/api` test must pass unmodified — that is the evidence moving `SESSION_COOKIE` changed nothing.

- [ ] **Step 7: Commit**

```bash
git add apps/web packages/core apps/api
git commit -m "feat(web): the session boundary, and one cookie name for both apps"
```

---

### Task 2: Sign in, sign up, and one way to call the API

**Files:**
- Create: `apps/web/lib/api.ts`, `apps/web/app/signin/page.tsx`, `apps/web/app/signin/signin-form.tsx`, `apps/web/app/signup/page.tsx`, `apps/web/app/signup/signup-form.tsx`
- Modify: `apps/api/src/modules/auth/auth.routes.ts`, `apps/api/src/modules/auth/oauth.routes.test.ts`
- Test: `apps/web/lib/api.test.ts`, `apps/web/app/signin/signin-form.test.tsx`

**Interfaces:**
- Produces: `apiFetch(path, init)` — the single browser→API caller every later task uses; `ApiError` carrying the domain `code`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError } from './api.js';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('apiFetch', () => {
  it('sends the cookie and a JSON content type', async () => {
    const spy = stubFetch(200, { ok: true });

    await apiFetch('/auth/me');

    const init = spy.mock.calls[0]?.[1] as RequestInit;
    // Both are load-bearing. Without credentials the cookie never travels;
    // without the JSON content type the request stops being one the browser
    // preflights, and the preflight is one of the three things standing in
    // for a CSRF token.
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('raises the domain code, not the status', async () => {
    stubFetch(409, { error: { code: 'HANDLE_TAKEN', message: 'That handle is taken.' } });

    // A screen needs to tell "taken" from "too similar" to say anything
    // useful, and both are 409.
    await expect(apiFetch('/pages', { method: 'POST' })).rejects.toMatchObject({
      code: 'HANDLE_TAKEN',
      message: 'That handle is taken.',
    });
  });

  it('survives a response that is not JSON at all', async () => {
    const spy = vi.fn(async () => new Response('<html>502</html>', { status: 502 }));
    vi.stubGlobal('fetch', spy);

    // A proxy returning HTML is not a domain error and must not crash the
    // screen trying to read `error.code` off a parse failure.
    await expect(apiFetch('/pages')).rejects.toBeInstanceOf(ApiError);
  });
});
```

Create `apps/web/app/signin/signin-form.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignInForm } from './signin-form.js';

describe('SignInForm', () => {
  it('shows the API message when sign-in fails', async () => {
    const submit = vi.fn().mockRejectedValueOnce({
      code: 'INVALID_CREDENTIALS',
      message: 'Check your email and password. If you just signed up, confirm your address first.',
    });
    render(<SignInForm onSubmit={submit} />);

    await userEvent.type(screen.getByLabelText(/email/i), 'nadia@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    // The API deliberately returns one message for every cause, including an
    // unverified address. The screen renders it verbatim rather than
    // interpreting it, because interpreting it is how the enumeration oracle
    // gets rebuilt in the client.
    expect(
      await screen.findByText(/check your email and password/i),
    ).toBeInTheDocument();
  });

  it('tells someone why they were sent here when they cancelled at Google', () => {
    render(<SignInForm onSubmit={vi.fn()} cancelled />);

    expect(screen.getByText(/sign-in was cancelled/i)).toBeInTheDocument();
  });

  it('disables the button while the request is in flight', async () => {
    let release: () => void = () => {};
    const submit = vi.fn(() => new Promise<void>((r) => (release = r)));
    render(<SignInForm onSubmit={submit} />);

    await userEvent.type(screen.getByLabelText(/email/i), 'nadia@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'passphrase');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    // A double-tap on a slow phone is two sign-in attempts against a limiter
    // that counts both.
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
    release();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @curios/web test`
Expected: FAIL — cannot resolve `./api.js` and `./signin-form.js`.

- [ ] **Step 3: Write the API caller**

Create `apps/web/lib/api.ts`:

```ts
/**
 * An error carrying the API's own domain code.
 *
 * The code matters more than the status: `HANDLE_TAKEN` and
 * `HANDLE_TOO_SIMILAR` are both 409 and mean different things to the person
 * typing, and `errorsPlugin` in the API exists precisely so that distinction
 * survives the wire.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * The only way this app talks to `apps/api`.
 *
 * `credentials: 'include'` because the session cookie is httpOnly and does not
 * travel otherwise. The JSON content type because it forces a preflight, which
 * together with SameSite=Lax and a single permitted CORS origin is what stands
 * in for a CSRF token -- see the CSRF section of the build spec, which records
 * that this is an assumption and what would collapse it.
 */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

  if (response.ok) return (await response.json().catch(() => null)) as T;

  // A proxy or a crash can return HTML. Reading `error.code` off that would
  // throw inside the error path, which is the worst place to throw.
  const body = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | null;

  throw new ApiError(
    response.status,
    body?.error?.code ?? 'INTERNAL_ERROR',
    body?.error?.message ?? 'Something failed. Try again.',
  );
}
```

- [ ] **Step 4: Write the sign-in screen**

Create `apps/web/app/signin/signin-form.tsx`:

```tsx
'use client';

import { useState, type FormEvent } from 'react';

export function SignInForm({
  onSubmit,
  cancelled = false,
}: {
  onSubmit: (input: { email: string; password: string }) => Promise<unknown>;
  cancelled?: boolean;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit({ email, password });
    } catch (failure) {
      // Rendered verbatim. The API returns one message for every cause on
      // purpose -- wrong password, unknown address, unverified -- and
      // rewriting it here to be more helpful would rebuild the account
      // enumeration oracle it was written to remove.
      setError(failure instanceof Error ? failure.message : 'Something failed. Try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      {cancelled ? <p role="status">Sign-in was cancelled. Try again when you are ready.</p> : null}

      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      {error ? <p role="alert">{error}</p> : null}

      <button type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <a href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/google`}>
        Continue with Google
      </a>
    </form>
  );
}
```

**Why the submit handler cannot live on the server.** The session cookie arrives as
`Set-Cookie` on the API's response, and that header only reaches the visitor's browser if the
*browser* made the request. A Server Action or a server-side `fetch` would receive the cookie
into the Next server process, where it is useless and invisible to the person signing in. So
the request is made from a client component, always.

That splits `signin-form.tsx` into two exports, and the split is deliberate: everything worth
testing lives in the presentational half, and the half a unit test could only check against
mocks of both `fetch` and the router is kept small enough to read at a glance.

Add to `apps/web/app/signin/signin-form.tsx`, below `SignInForm`:

```tsx
/**
 * Supplies the real submit handler. Thin on purpose.
 *
 * A unit test of this would assert that a mocked fetch was called and a mocked
 * router was pushed, which proves the mocks work. What it actually does is
 * covered by Task 3's manual walk-through of the whole flow, and by the API's
 * own tests of POST /auth/login.
 */
export function SignIn({ cancelled, next }: { cancelled: boolean; next: string }) {
  const router = useRouter();

  return (
    <SignInForm
      cancelled={cancelled}
      onSubmit={async (input) => {
        await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(input) });
        router.push(next);
      }}
    />
  );
}
```

`SignInForm` keeps `onSubmit` REQUIRED rather than defaulting to the real handler. A default
would mean the production path is the one path no test ever exercises, which is the shape this
project has already had to correct three times.

Create `apps/web/app/signin/page.tsx`, a Server Component whose only job is reading the query
string:

```tsx
import { SignIn } from './signin-form.js';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string; next?: string }>;
}) {
  const params = await searchParams;

  return <SignIn cancelled={params.cancelled === '1'} next={params.next ?? '/app'} />;
}
```

- [ ] **Step 5: Write the sign-up screen**

`apps/web/app/signup/signup-form.tsx` and `page.tsx` mirror sign-in, with three differences:

- `autoComplete="new-password"` on the password field.
- On success it renders a "check your email" state rather than redirecting. The API answers
  202 and issues no session, because an unverified account is inert — so there is nothing to
  redirect *to*.
- The success copy is identical whether or not the address already had an account, because
  the API's response is byte-identical in both cases and the screen must not leak what the
  API refuses to.

- [ ] **Step 6: Point the OAuth cancel redirect somewhere that exists**

In `apps/api/src/modules/auth/auth.routes.ts`, the callback currently sends a cancelling user
to the root route, which this slice does not build:

```ts
        return reply.redirect(`${appUrl}/?signin=cancelled`);
```

Change it to the screen that now exists:

```ts
        return reply.redirect(`${appUrl}/signin?cancelled=1`);
```

Update the assertion in `apps/api/src/modules/auth/oauth.routes.test.ts` that checks the cancel
redirect. It currently asserts `res.headers.location` contains `'/'`, which is true of almost
any URL; assert on `/signin` instead, which is the actual contract.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @curios/web test` then `pnpm test`.
Expected: PASS. The API's OAuth tests must still pass, with the one cancel assertion updated.

- [ ] **Step 8: Commit**

```bash
git add apps/web apps/api
git commit -m "feat(web): sign in and sign up, and one caller for the API"
```

---

### Task 3: The two links people are already being emailed

**Files:**
- Create: `apps/web/app/verify/page.tsx`, `apps/web/app/verify/verify-client.tsx`, `apps/web/app/reset/page.tsx`, `apps/web/app/reset/reset-form.tsx`, `apps/web/app/forgot/page.tsx`, `apps/web/app/forgot/forgot-form.tsx`
- Test: `apps/web/app/verify/verify-client.test.tsx`, `apps/web/app/reset/reset-form.test.tsx`

**Why this task is third and not eighth.** These are not new screens. `apps/api` has been
mailing people `${APP_URL}/verify?token=…` and `${APP_URL}/reset?token=…` since plan 1 merged,
and both are 404 today. Someone who signs up right now receives an email whose link is broken.
Everything after this task is new capability; this task is a repair.

**Interfaces:**
- Consumes: `apiFetch` (Task 2). Calls `POST /auth/verify-email`, `POST /auth/reset-password`, `POST /auth/forgot-password`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/verify/verify-client.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerifyClient } from './verify-client.js';

describe('VerifyClient', () => {
  it('confirms the address when the token is good', async () => {
    render(<VerifyClient token="good" verify={vi.fn().mockResolvedValue({})} />);

    expect(await screen.findByText(/your email is confirmed/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument();
  });

  it('explains an expired link and offers the way out', async () => {
    const verify = vi.fn().mockRejectedValue({
      code: 'INVALID_TOKEN',
      message: 'That link has expired or has already been used. Request a new one.',
    });
    render(<VerifyClient token="stale" verify={verify} />);

    // A single-use token means the second click on the same link fails, and
    // people do click twice. Saying so, and saying what to do, is the whole
    // job of this screen.
    expect(await screen.findByText(/expired or has already been used/i)).toBeInTheDocument();
  });

  it('says something useful when the link carries no token at all', () => {
    render(<VerifyClient token={undefined} verify={vi.fn()} />);

    // Mail clients truncate long URLs. This is a real way to arrive here.
    expect(screen.getByText(/link looks incomplete/i)).toBeInTheDocument();
  });
});
```

Create `apps/web/app/reset/reset-form.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetForm } from './reset-form.js';

describe('ResetForm', () => {
  it('surfaces a weak password with the API reason', async () => {
    const reset = vi.fn().mockRejectedValue({
      code: 'WEAK_PASSWORD',
      message: 'That password has appeared in a public breach. Pick another.',
    });
    render(<ResetForm token="t" onReset={reset} />);

    await userEvent.type(screen.getByLabelText(/new password/i), 'password');
    await userEvent.click(screen.getByRole('button', { name: /change my password/i }));

    // The API screens against Have I Been Pwned. Telling someone their
    // password is "invalid" when the real reason is that it is in a breach
    // list wastes their next three guesses.
    expect(await screen.findByText(/public breach/i)).toBeInTheDocument();
  });

  it('confirms, and says every other session was signed out', async () => {
    render(<ResetForm token="t" onReset={vi.fn().mockResolvedValue({})} />);

    await userEvent.type(screen.getByLabelText(/new password/i), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /change my password/i }));

    // A completed reset deletes every session for the account. Someone
    // resetting because they think they were compromised needs to be told
    // that worked, not left guessing.
    expect(await screen.findByText(/signed out everywhere/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @curios/web test`
Expected: FAIL — cannot resolve `./verify-client.js` and `./reset-form.js`.

- [ ] **Step 3: Write `/verify`**

`verify-client.tsx` is a client component that takes `token` and an injected `verify` function,
posts once on mount, and renders one of four states: working, confirmed, failed with the API's
message, or "that link looks incomplete" when `token` is undefined. Post exactly once — a
`useEffect` with an empty dependency array and a guard against React's development double-invoke,
because the token is single-use and a second post spends it and reports failure on a link that
worked.

`page.tsx` reads `searchParams.token` and renders `<VerifyClient token={token} verify={…} />`,
where the default `verify` calls `apiFetch('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })`.

- [ ] **Step 4: Write `/reset` and `/forgot`**

`reset-form.tsx` takes `token` and `onReset`, renders one password field, and on success renders
a confirmation that says the password changed **and that every other session was signed out** —
which is true, because `resetPassword` deletes every session for the account, and it is the
detail someone resetting under suspicion actually needs.

`/forgot` is a single email field posting to `POST /auth/forgot-password`. Its success state is
identical for a known and an unknown address, because the API's response is, and the screen must
not undo that.

- [ ] **Step 5: Verify the whole flow by hand against Mailpit**

Unit tests cannot prove the link in the email reaches a page that works. Run the stack, sign up
with a fresh address, open `http://localhost:8075`, click the link in the message, and confirm
the address is verified and you can then sign in. Then use `/forgot`, click that link, set a new
password, and confirm the old one no longer works. Record what you saw.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): the verify and reset pages the API has been mailing links to"
```

---
### Task 4: Claim a handle

**Files:**
- Create: `apps/web/app/app/page.tsx`, `apps/web/app/app/onboarding/page.tsx`, `apps/web/app/app/onboarding/claim-form.tsx`
- Test: `apps/web/app/app/onboarding/claim-form.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (T2); `getOwnerPage` from `@curios/db-read` (plan 2a, T8); the `/app` layout (T1).
- Produces: `/app` — which decides where an owner belongs.

**What `/app` is for.** It is a router, not a screen. `getOwnerPage` answers "does this account
have a page" — the question plan 2a added a whole task to make answerable — and `/app` sends an
owner with no page to `/app/onboarding` and one with a page to their review queue. It is the
only place that decision is made.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/app/onboarding/claim-form.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClaimForm } from './claim-form.js';

const fill = async (handle: string, name = 'Nadia Bakes') => {
  await userEvent.type(screen.getByLabelText(/handle/i), handle);
  await userEvent.type(screen.getByLabelText(/display name/i), name);
  await userEvent.click(screen.getByRole('button', { name: /claim/i }));
};

describe('ClaimForm', () => {
  it('tells "taken" apart from "too close to one already in use"', async () => {
    const claim = vi.fn().mockRejectedValue({
      code: 'HANDLE_TOO_SIMILAR',
      message: 'That handle is too close to one already in use. Pick another.',
    });
    render(<ClaimForm onClaim={claim} />);

    await fill('nadiabakes');

    // Two different 409s. Someone told "taken" will try nadia-bakes, which
    // collides on the same skeleton and fails the same way. The API went to
    // the trouble of distinguishing them; the screen must not flatten it.
    expect(await screen.findByText(/too close to one already in use/i)).toBeInTheDocument();
  });

  it('explains a reserved handle without blaming the person', async () => {
    const claim = vi.fn().mockRejectedValue({
      code: 'HANDLE_RESERVED',
      message: 'That handle is reserved. Pick another.',
    });
    render(<ClaimForm onClaim={claim} />);

    await fill('admin');

    expect(await screen.findByText(/reserved/i)).toBeInTheDocument();
  });

  it('shows the rule when the format is wrong, not just that it is wrong', async () => {
    const claim = vi.fn().mockRejectedValue({
      code: 'HANDLE_INVALID',
      message:
        'Handles are 3 to 30 characters, letters, numbers, hyphens and underscores, and cannot start or end with a separator.',
    });
    render(<ClaimForm onClaim={claim} />);

    await fill('ab');

    // The API's message states the whole rule. Replacing it with "invalid
    // handle" makes someone guess at what they broke.
    expect(await screen.findByText(/3 to 30 characters/i)).toBeInTheDocument();
  });

  it('does not submit twice on a double tap', async () => {
    let release: () => void = () => {};
    const claim = vi.fn(() => new Promise<void>((r) => (release = r)));
    render(<ClaimForm onClaim={claim} />);

    await fill('nadiabakes');
    await userEvent.click(screen.getByRole('button', { name: /claiming/i }));

    // Two claims race on the unique index and the loser is told the handle is
    // taken -- by themselves, a second ago.
    expect(claim).toHaveBeenCalledTimes(1);
    release();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @curios/web test src/../app/app/onboarding/claim-form.test.tsx`
Expected: FAIL — cannot resolve `./claim-form.js`.

- [ ] **Step 3: Write the form**

`claim-form.tsx` is a client component taking `onClaim`. Two fields, handle and display name,
one primary button. On failure it renders the API's message verbatim — every one of
`HANDLE_INVALID`, `HANDLE_RESERVED`, `HANDLE_TAKEN`, `HANDLE_TOO_SIMILAR` and `PAGE_EXISTS`
already carries copy that says what to do. Disable the button while in flight. On success,
`router.push('/app')`, which re-runs the decision below.

- [ ] **Step 4: Write `/app`, the router**

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@curios/core';
import { getOwnerPage } from '@curios/db-read';
import { resolveOwner } from './session.js';

export default async function AppPage() {
  const owner = await resolveOwner((await cookies()).get(SESSION_COOKIE)?.value);
  // The layout already redirected an invalid session; this is belt and braces
  // for a direct render, and it narrows the type.
  if (!owner) redirect('/signin');

  const page = await getOwnerPage(owner.accountId);
  redirect(page ? '/app/review' : '/app/onboarding');
}
```

- [ ] **Step 5: Green, then commit**

```bash
git add apps/web && git commit -m "feat(web): claim a handle, and send an owner where they belong"
```

---

### Task 5: Paste a URL, and watch the job

**Files:**
- Create: `apps/web/app/providers.tsx`, `apps/web/app/app/onboarding/ingest-form.tsx`, `apps/web/app/app/onboarding/job-status.tsx`
- Modify: `apps/web/app/layout.tsx`, `apps/web/package.json`
- Test: `apps/web/app/app/onboarding/job-status.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`; `POST /ingest`, `GET /ingest/:id`.
- Produces: the TanStack Query provider every later task's screens sit under.

- [ ] **Step 1: Add TanStack Query**

```bash
pnpm --filter @curios/web add @tanstack/react-query@^5.62.0
```

This is where it earns its place, per FRONTEND.md's rule that server state is TanStack Query
and there is no other store. The poll wants retry, backoff and cancellation; the review queue
in Task 6 wants invalidation after each mutation. Everything before this task was a one-shot
post that wanted none of it.

- [ ] **Step 2: Write the failing test**

Create `apps/web/app/app/onboarding/job-status.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JobStatus } from './job-status.js';

const wrap = (ui: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

describe('JobStatus', () => {
  it('says what is happening while the job runs', async () => {
    wrap(<JobStatus ingestionId="i-1" fetchStatus={vi.fn().mockResolvedValue({ status: 'RUNNING', extractedCount: 0, error: null })} />);

    // "Reading your website" is a instruction-shaped empty state, not a
    // spinner with no words. Someone on a slow connection needs to know the
    // machine is doing something and roughly what.
    expect(await screen.findByText(/reading your website/i)).toBeInTheDocument();
  });

  it('reports the count when it succeeds', async () => {
    wrap(<JobStatus ingestionId="i-1" fetchStatus={vi.fn().mockResolvedValue({ status: 'SUCCEEDED', extractedCount: 23, error: null })} />);

    expect(await screen.findByText(/23/)).toBeInTheDocument();
  });

  it('shows the failure reason rather than a generic apology', async () => {
    wrap(<JobStatus ingestionId="i-1" fetchStatus={vi.fn().mockResolvedValue({ status: 'FAILED', extractedCount: 0, error: 'Could not reach that address.' })} />);

    // The ingestion row carries an `error` string precisely so this screen can
    // say which of the many ways a crawl fails actually happened.
    expect(await screen.findByText(/could not reach that address/i)).toBeInTheDocument();
  });

  it('stops polling once the job resolves', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({ status: 'SUCCEEDED', extractedCount: 1, error: null });
    wrap(<JobStatus ingestionId="i-1" fetchStatus={fetchStatus} />);
    await screen.findByText(/1/);

    const callsAtResolution = fetchStatus.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));

    // A poll that never stops is a request every two seconds forever on a
    // phone, for a job that finished.
    expect(fetchStatus.mock.calls.length).toBe(callsAtResolution);
  });
});
```

- [ ] **Step 3: Write the provider and wire it in**

`providers.tsx` is a client component exporting `<Providers>` that creates one `QueryClient`
in a `useState` initialiser (never at module scope — a module-scope client is shared across
requests on the server and leaks one visitor's data into another's render) and wraps children
in `QueryClientProvider`. `app/layout.tsx` renders `<Providers>` around `{children}`.

- [ ] **Step 4: Write the form and the status**

`ingest-form.tsx`: one field, a URL, per FRONTEND.md — *"One field. A URL or an `@handle`"*, and
the handle half is deliberately absent because the Instagram adapter throws `NOT_CONFIGURED` by
design and connectors are Pro/Max work. Posts to `POST /ingest` with `{ pageId, sourceUrl }`,
receives 202 and an `ingestionId`, and hands it to `JobStatus`.

`job-status.tsx`: `useQuery` keyed on the ingestion id, `refetchInterval` returning `2000` while
the status is `QUEUED` or `RUNNING` and `false` once it is `SUCCEEDED` or `FAILED` — that return
value is what stops the poll, and the fourth test above is what proves it stops. On success,
offer the primary action: review the facts.

- [ ] **Step 5: Green, then commit**

```bash
git add apps/web && git commit -m "feat(web): paste a url and watch the job"
```

---

### Task 6: The fact review screen

**Files:**
- Create: `apps/web/app/app/review/page.tsx`, `apps/web/app/app/review/review-queue.tsx`, `apps/web/app/app/review/fact-card.tsx`
- Test: `apps/web/app/app/review/fact-card.test.tsx`, `apps/web/app/app/review/review-queue.test.tsx`

**This is the highest-leverage surface in the product**, in FRONTEND.md's words, and the one
screen where a mistake is unrecoverable: *"Never auto-publish an unreviewed price. Getting a
price wrong in public is the single failure that loses a customer permanently."*

**Interfaces:**
- Consumes: `getReviewQueue` (2a T4) for the initial server render; `POST /facts/:id/verify`, `PATCH /facts/:id`, `POST /facts/:id/reject`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/app/review/fact-card.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FactCard } from './fact-card.js';

const fact = {
  id: 'f-1',
  category: 'PRICE' as const,
  claim: 'Kuih lapis is RM12 a box',
  sourceText: 'Our kuih lapis is RM12 per box, minimum two boxes.',
  sourceUrl: 'https://nadia.example/menu',
  confidence: 0.91,
};

describe('FactCard', () => {
  it('shows the line it came from', async () => {
    render(<FactCard fact={fact} onAccept={vi.fn()} onEdit={vi.fn()} onReject={vi.fn()} />);

    // sourceText exists in the schema commented "the line it came from, for
    // the review screen". Without it the owner is asked to approve a claim
    // with no way to check it against anything.
    expect(screen.getByText(/minimum two boxes/i)).toBeInTheDocument();
  });

  it('accepts exactly one fact and says which', async () => {
    const onAccept = vi.fn();
    render(<FactCard fact={fact} onAccept={onAccept} onEdit={vi.fn()} onReject={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /accept/i }));

    expect(onAccept).toHaveBeenCalledExactlyOnceWith('f-1');
  });

  it('offers no control that acts on more than this fact', () => {
    render(<FactCard fact={fact} onAccept={vi.fn()} onEdit={vi.fn()} onReject={vi.fn()} />);

    // The product's single hard rule, asserted at the surface that would
    // violate it. Nothing sets verified: true except an explicit human action
    // on one specific fact -- no select-all, no accept-remaining, no
    // confidence threshold. This test fails the day someone adds one.
    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    for (const label of buttons) {
      expect(label).not.toMatch(/all|remaining|rest|everything/i);
    }
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('lets the claim be edited, because a wrong price is the thing to fix', async () => {
    const onEdit = vi.fn();
    render(<FactCard fact={fact} onAccept={vi.fn()} onEdit={onEdit} onReject={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    const field = screen.getByRole('textbox');
    await userEvent.clear(field);
    await userEvent.type(field, 'Kuih lapis is RM14 a box');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onEdit).toHaveBeenCalledWith('f-1', 'Kuih lapis is RM14 a box');
  });
});
```

`review-queue.test.tsx` covers the queue around the cards: that a card disappears once acted on,
that a `FACT_DUPLICATE` from an edit renders the API's "you already have a fact that says this"
rather than a generic failure, and that the empty state is an instruction — *"Nothing left to
review. Publish when you are ready."* — rather than a mood.

- [ ] **Step 2: Run to verify RED, then write the components**

`fact-card.tsx` renders the claim, the category, the source line, and three buttons: Accept,
Edit, Reject. Accept is the primary action. Edit swaps the claim for a textarea — one of the two
places in the whole product where a human writes prose, per FRONTEND.md's no-blank-prompt-boxes
rule, and it is allowed here precisely because a fact correction is that exception.

`review-queue.tsx` holds the list, calls the three mutations through `apiFetch`, and invalidates
the query on success so the acted-on card leaves. Bound the page at 50 and render oldest first —
the query already does both; the screen must not undo it by fetching more.

- [ ] **Step 3: Prove the hard rule holds at the surface**

The third test above is the negative requirement, and negative requirements decay. Before
committing, add a select-all checkbox to `fact-card.tsx`, run that test file, confirm the test
FAILS, then remove it. Record what you saw. A guard nobody has watched fail is a guard nobody
knows works.

- [ ] **Step 4: Commit**

```bash
git add apps/web && git commit -m "feat(web): the fact review screen, one fact at a time"
```

---

### Task 7: Publish

**Files:**
- Create: `apps/web/app/app/review/publish-button.tsx`
- Modify: `apps/web/app/app/review/page.tsx`
- Test: `apps/web/app/app/review/publish-button.test.tsx`

- [ ] **Step 1: The tests**

Three: that it calls `POST /publish` once and confirms; that it renders `NO_PAGE`'s message if
the API says there is no page; and that once published it shows the public URL as a link, because
a publish button that does not then tell you where the page is has done half the job.

**It must not be disabled when nothing is verified.** Publishing is a deliberate owner action and
nothing more — the API has no such gate, and a page with only links is a valid page. See F5.

- [ ] **Step 2: Write it, green, commit**

```bash
git add apps/web && git commit -m "feat(web): publish"
```

---

### Task 8: Settings, and the second way in

**Files:**
- Create: `apps/web/app/app/settings/page.tsx`, `apps/web/app/app/settings/add-password-form.tsx`, `apps/web/app/app/settings/connect-google.tsx`
- Test: `apps/web/app/app/settings/add-password-form.test.tsx`

**This route is already a redirect target.** Plan 2a's OAuth link flow sends a successful link to
`${APP_URL}/app/settings?linked=google`, so until this task exists that redirect lands on a 404.

- [ ] **Step 1: The tests**

`add-password-form.test.tsx` covers: a successful add; `PASSWORD_ALREADY_SET` rendered as the
API's message, which explains that changing a password is the reset flow rather than this one;
and `WEAK_PASSWORD` rendered verbatim, including the breach-list reason.

- [ ] **Step 2: Write the screens**

`add-password-form.tsx` posts to `POST /auth/password`. `connect-google.tsx` is a link to
`GET /auth/google/link` on the API — a plain anchor, not a `fetch`, because the browser must
follow the redirect to Google. On return, `?linked=google` renders a confirmation.

The screen shows which methods the account already has, so "Add a password" does not appear for
an account that has one. That state comes from `getOwnerPage`'s account — if the read for it does
not exist yet, add it to the settings page as a server read rather than inventing an API endpoint.

- [ ] **Step 3: Verify the link flow by hand**

Sign in with a password account, click Connect Google, complete the flow, and confirm you land on
`/app/settings?linked=google` with a confirmation and that `AuthIdentity` now holds the row.
Unit tests cannot cover a round trip through Google.

- [ ] **Step 4: Commit**

```bash
git add apps/web && git commit -m "feat(web): settings, and a second way into an account"
```

---

## Self-review

**Spec coverage.** `/verify` and `/reset` (T3) close the flows plan 1 shipped without landings.
Onboarding is T4 and T5. The review screen is T6, with the hard rule asserted at the surface.
Publishing is T7. Linking is T8. The session layers are T1, with middleware and the layout tested
separately so neither can be deleted as redundant.

**Deliberately out of scope**, and named so nobody looks for them: `/app/knowledge`, `/app/links`,
`/app/leads`, `/app/questions`, `/app/appearance`, `/app/billing`. The build spec's out-column
lists the dashboard shell and those screens; this plan builds only the path from sign-in to a
published page.

**Type consistency.** `apiFetch` is defined in T2 and used by T3 through T8. `ReviewFact` comes
from `@curios/db-read` and is not redefined in the web app. `SESSION_COOKIE` has exactly one
definition after T1.

**What is not tested, stated plainly.** No test here renders a Server Component or exercises
middleware inside a running Next server; T1 tests the extracted decision and the middleware
function directly. The three end-to-end paths that unit tests cannot reach — the email link, the
Google round trip, and the ingest job — each carry a manual verification step, in T3, T8 and T5
respectively. Anyone reporting this plan "fully tested" without those three has not run them.
