# Slice 2, Plan 1 — Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Curios a real owner identity — sessions, Google OAuth, email and password sign-in, verification and reset — and close the two authorization holes in the ingest routes that become live the moment authentication exists.

**Architecture:** `apps/api` owns every write and every authorization decision. Sessions are database rows storing only a hash of the cookie value, so revocation is immediate and a database leak yields nothing usable. `apps/web` keeps its SELECT-only connection and is not touched by this plan — the owner-facing screens are plan 2.

**Tech Stack:** Fastify 5, Prisma 6, Postgres, `@node-rs/argon2` 2.1.0, `nodemailer` 9.0.6, Mailpit, `@fastify/cookie` (already registered), `@fastify/rate-limit` (already registered).

**Spec:** `devDocs/slice-2-build-spec.md` — read it before Task 1. The plan argues from the spec; where they disagree, the spec wins.

## Global Constraints

- Node `>=22`. pnpm `9.15.9`.
- **Only `packages/gateway` may import `@anthropic-ai/sdk`.**
- **`apps/web` never imports `packages/db`.** It imports `packages/db-read` only. This plan does not touch `apps/web`.
- **`apps/api` and `apps/workers` never import each other.**
- No `any`. Parse untyped external responses with zod at the boundary.
- Route handlers contain no business logic. Handlers validate, call a service, serialise.
- Files kebab-case. Services `*.service.ts` exporting named functions, no classes — except error subclasses, which follow the existing `class XError extends Error` idiom in `auth.service.ts`.
- Money is integer milli-cents. Not relevant to this plan; do not introduce a second unit.
- **Never log a password, a raw token, a session id, a cookie value, or a provider secret.** Log the account id instead.
- Conventional commits: `feat(api):`, `fix(api):`, `chore(db):`, `docs(spec):`.
- Every package with tests has its own `vitest.config.ts` carrying `setupFiles: ['../../vitest.setup.ts']`.
- Test databases are reached via `DATABASE_URL_TEST`, never `DATABASE_URL`.
- Docker host ports: Postgres `5452`, test Postgres `5453`, Redis `6399`. New this plan: Mailpit SMTP `1075`, Mailpit UI `8075`. Non-default deliberately, matching the existing offsets.
- **Secrets never appear in a committed file.** `.env.example` carries key names and non-secret placeholders only.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma` | Adds `Session`, `PasswordCredential`, `AuthToken`, `AuthTokenKind`; `Account.emailVerifiedAt` |
| `apps/api/src/lib/tokens.ts` | Generating an opaque token and hashing it. Used by sessions and by auth tokens |
| `apps/api/src/lib/mailer.ts` | The only module that knows how mail is sent |
| `apps/api/src/modules/auth/session.service.ts` | Create, validate, refresh, revoke sessions |
| `apps/api/src/modules/auth/password.service.ts` | argon2id hashing, verification, breach screening |
| `apps/api/src/modules/auth/token.service.ts` | Single-use verification and reset tokens |
| `apps/api/src/modules/auth/auth.service.ts` | **Modify.** Google resolution exists; gains password signup, login, verification, reset |
| `apps/api/src/modules/auth/oauth.service.ts` | Google authorize URL, `state`, PKCE, code exchange |
| `apps/api/src/modules/auth/auth.routes.ts` | Every `/auth/*` route |
| `apps/api/src/plugins/session.ts` | Reads the cookie, decorates `request.account`, exports `requireSession` |
| `apps/api/src/modules/ingest/ingest.service.ts` | **Modify.** Ownership checks |
| `apps/api/src/modules/ingest/ingest.routes.ts` | **Modify.** `requireSession` on both routes |
| `apps/api/src/app.ts` | **Modify.** Registers the session plugin and auth routes |
| `docker-compose.yml` | **Modify.** Mailpit |

Auth is one module because these files change together. `lib/` holds the two pieces with no domain knowledge, so they can be tested without a database.

---

### Task 1: Schema — sessions, password credentials, and auth tokens

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_auth_foundation/migration.sql` (generated)
- Test: `packages/db/src/schema.test.ts` (modify — file exists)

**Interfaces:**
- Produces: `Session`, `PasswordCredential`, `AuthToken`, `AuthTokenKind` on the Prisma client; `Account.emailVerifiedAt`.

- [ ] **Step 1: Add the models**

In `packages/db/prisma/schema.prisma`, add beside the other enums:

```prisma
enum AuthTokenKind {
  EMAIL_VERIFICATION
  PASSWORD_RESET
}
```

Add these models at the end of the file:

```prisma
/// The id is a SHA-256 of the cookie value, never the value itself. A database
/// leak therefore yields no usable session, for the same reason a password is
/// never stored in the clear.
model Session {
  id         String   @id
  accountId  String
  account    Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  expiresAt  DateTime
  lastSeenAt DateTime @default(now())
  createdAt  DateTime @default(now())

  @@index([accountId])
  @@index([expiresAt])
}

/// Its own table rather than a column on AuthIdentity, which is read on every
/// Google sign-in. A secret in a routinely-selected row is a leak waiting for a
/// careless select or a logged object.
model PasswordCredential {
  id        String   @id @default(cuid())
  accountId String   @unique
  account   Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  hash      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

/// Single-use, hashed at rest exactly as sessions are.
model AuthToken {
  id        String        @id
  accountId String
  account   Account       @relation(fields: [accountId], references: [id], onDelete: Cascade)
  kind      AuthTokenKind
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime      @default(now())

  @@index([accountId, kind])
  @@index([expiresAt])
}
```

Add these fields to the existing `Account` model:

```prisma
  emailVerifiedAt DateTime?
  sessions        Session[]
  password        PasswordCredential?
  authTokens      AuthToken[]
```

- [ ] **Step 2: Write the failing test**

Append to `packages/db/src/schema.test.ts`:

```ts
it('cascades sessions, credentials and tokens when an account is deleted', async () => {
  const account = await prisma.account.create({
    data: {
      email: `cascade-${randomUUID()}@example.com`,
      sessions: { create: { id: `s-${randomUUID()}`, expiresAt: new Date(Date.now() + 60_000) } },
      password: { create: { hash: 'not-a-real-hash' } },
      authTokens: {
        create: {
          id: `t-${randomUUID()}`,
          kind: 'EMAIL_VERIFICATION',
          expiresAt: new Date(Date.now() + 60_000),
        },
      },
    },
    select: { id: true },
  });

  await prisma.account.delete({ where: { id: account.id } });

  expect(await prisma.session.count({ where: { accountId: account.id } })).toBe(0);
  expect(await prisma.passwordCredential.count({ where: { accountId: account.id } })).toBe(0);
  expect(await prisma.authToken.count({ where: { accountId: account.id } })).toBe(0);
});

it('allows at most one password credential per account', async () => {
  const account = await prisma.account.create({
    data: { email: `onepw-${randomUUID()}@example.com`, password: { create: { hash: 'a' } } },
    select: { id: true },
  });

  await expect(
    prisma.passwordCredential.create({ data: { accountId: account.id, hash: 'b' } }),
  ).rejects.toMatchObject({ code: 'P2002' });
});
```

Add `import { randomUUID } from 'node:crypto';` at the top if it is not already there.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @curios/db test`
Expected: FAIL — the Prisma client has no `session` property. This proves the test exercises the new models rather than passing vacuously.

- [ ] **Step 4: Generate and apply the migration**

```bash
pnpm --filter @curios/db exec prisma migrate dev --name auth_foundation
```

Then apply it to the test database, whose URL is `DATABASE_URL_TEST`:

```bash
cd packages/db && DATABASE_URL="$DATABASE_URL_TEST" pnpm exec prisma migrate deploy && cd ../..
```

Read the generated `migration.sql` before continuing. It must contain three `CREATE TABLE` statements, one `CREATE TYPE` for the enum, an `ALTER TABLE "Account" ADD COLUMN "emailVerifiedAt"`, and a unique index on `PasswordCredential.accountId`. If it contains a `DROP`, stop and report it.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @curios/db test`
Expected: PASS, including the two new tests.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "chore(db): sessions, password credentials and auth tokens"
```

---

### Task 2: Token primitives

**Files:**
- Create: `apps/api/src/lib/tokens.ts`
- Test: `apps/api/src/lib/tokens.test.ts`

**Interfaces:**
- Produces: `createToken(): { value: string; hash: string }` and `hashToken(value: string): string`. Sessions and auth tokens both use these; neither ever stores `value`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createToken, hashToken } from './tokens.js';

describe('createToken', () => {
  it('returns a value and the hash that will be stored in its place', () => {
    const { value, hash } = createToken();

    expect(hashToken(value)).toBe(hash);
    // The stored form must not contain the secret in any recoverable way.
    expect(hash).not.toContain(value);
    expect(value).not.toContain(hash);
  });

  it('is unguessable: 1000 tokens produce 1000 distinct values of full length', () => {
    const values = new Set(Array.from({ length: 1000 }, () => createToken().value));

    expect(values.size).toBe(1000);
    // 32 bytes base64url, unpadded.
    for (const value of values) expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('hashToken', () => {
  it('is stable, so a token presented twice finds the same row', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('differs for different inputs', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @curios/api test src/lib/tokens.test.ts`
Expected: FAIL — cannot resolve `./tokens.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/lib/tokens.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque bearer tokens: session cookies, email verification links, password
 * reset links.
 *
 * The caller sends `value` to the person and stores `hash`. Lookup is by exact
 * hash, so hashing costs one comparison and buys the property that a database
 * leak yields nothing anyone can present. This is the same reasoning that
 * applies to passwords, and the reason no code path anywhere stores `value`.
 *
 * SHA-256 rather than argon2 deliberately: these are 256 bits of randomness, not
 * user-chosen secrets, so there is nothing for a slow hash to protect against.
 */
export function createToken(): { value: string; hash: string } {
  const value = randomBytes(32).toString('base64url');
  return { value, hash: hashToken(value) };
}

export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @curios/api test src/lib/tokens.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib
git commit -m "feat(api): opaque token generation hashed at rest"
```

---

### Task 3: Session service

**Files:**
- Create: `apps/api/src/modules/auth/session.service.ts`
- Test: `apps/api/src/modules/auth/session.service.test.ts`

**Interfaces:**
- Consumes: `createToken`, `hashToken` from `../../lib/tokens.js` (Task 2); `PrismaClient` from `@curios/db`.
- Produces:
  - `createSession(prisma, accountId): Promise<{ value: string; expiresAt: Date }>`
  - `validateSession(prisma, value): Promise<{ accountId: string } | null>`
  - `revokeSession(prisma, value): Promise<void>`
  - `revokeAllSessions(prisma, accountId): Promise<void>`
  - `SESSION_COOKIE = 'curios_session'`, `ABSOLUTE_TTL_MS`, `IDLE_TTL_MS`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/auth/session.service.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@curios/db';
import { hashToken } from '../../lib/tokens.js';
import {
  createSession,
  revokeAllSessions,
  revokeSession,
  validateSession,
} from './session.service.js';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST } },
});

async function anAccount(): Promise<string> {
  const account = await prisma.account.create({
    data: { email: `sess-${randomUUID()}@example.com` },
    select: { id: true },
  });
  return account.id;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

describe('createSession', () => {
  it('returns a value that is not what gets stored', async () => {
    const accountId = await anAccount();
    const { value } = await createSession(prisma, accountId);

    const stored = await prisma.session.findMany({ select: { id: true } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(hashToken(value));
    expect(stored[0]?.id).not.toBe(value);
  });
});

describe('validateSession', () => {
  it('accepts a live session', async () => {
    const accountId = await anAccount();
    const { value } = await createSession(prisma, accountId);

    expect(await validateSession(prisma, value)).toEqual({ accountId });
  });

  it('rejects a value that was never issued', async () => {
    expect(await validateSession(prisma, 'not-a-real-token')).toBeNull();
  });

  it('rejects an expired session and does not resurrect it', async () => {
    const accountId = await anAccount();
    const { value } = await createSession(prisma, accountId);
    await prisma.session.update({
      where: { id: hashToken(value) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await validateSession(prisma, value)).toBeNull();
  });

  it('extends a session that is past half its life, so an active owner never expires', async () => {
    const accountId = await anAccount();
    const { value } = await createSession(prisma, accountId);
    const id = hashToken(value);

    // Ten days: past the seven-day refresh threshold, comfortably short of the
    // fourteen-day idle limit. Not fourteen -- that sits exactly on the idle
    // boundary, so the few milliseconds between this update and the call below
    // tip the session into idle-expiry and `validateSession` returns null
    // before the refresh branch can run.
    const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await prisma.session.update({ where: { id }, data: { lastSeenAt: stale } });

    await validateSession(prisma, value);

    const after = await prisma.session.findUniqueOrThrow({ where: { id } });
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime());
  });

  it('does not write on every request', async () => {
    const accountId = await anAccount();
    const { value } = await createSession(prisma, accountId);
    const id = hashToken(value);

    await validateSession(prisma, value);
    const first = await prisma.session.findUniqueOrThrow({ where: { id } });
    await validateSession(prisma, value);
    const second = await prisma.session.findUniqueOrThrow({ where: { id } });

    // A write per request would make this the busiest table in the database.
    expect(second.lastSeenAt.getTime()).toBe(first.lastSeenAt.getTime());
  });
});

describe('revoking', () => {
  it('makes a session immediately unusable', async () => {
    const accountId = await anAccount();
    const { value } = await createSession(prisma, accountId);

    await revokeSession(prisma, value);

    expect(await validateSession(prisma, value)).toBeNull();
  });

  it('signs out every device at once', async () => {
    const accountId = await anAccount();
    const one = await createSession(prisma, accountId);
    const two = await createSession(prisma, accountId);

    await revokeAllSessions(prisma, accountId);

    expect(await validateSession(prisma, one.value)).toBeNull();
    expect(await validateSession(prisma, two.value)).toBeNull();
  });
});
```

- [ ] **Step 2: Create the package-local vitest config if it does not exist**

`apps/api/vitest.config.ts` already exists and already sets `fileParallelism: false`. Confirm it does; this file truncates `Account` in `beforeEach` like its neighbours, and parallel files racing that truncate is the defect that config exists to prevent. No change needed.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @curios/api test src/modules/auth/session.service.test.ts`
Expected: FAIL — cannot resolve `./session.service.js`.

- [ ] **Step 4: Write the implementation**

Create `apps/api/src/modules/auth/session.service.ts`:

```ts
import type { PrismaClient } from '@curios/db';
import { createToken, hashToken } from '../../lib/tokens.js';

export const SESSION_COOKIE = 'curios_session';

/** However active the owner, a session dies 30 days after it was issued. */
export const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** An untouched session dies after a fortnight. */
export const IDLE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Refreshing on every request would make this the most-written table in the
 * database for no benefit. Refreshing once past half the idle window keeps an
 * active owner signed in indefinitely at roughly one write per week.
 */
const REFRESH_AFTER_MS = IDLE_TTL_MS / 2;

export async function createSession(
  prisma: PrismaClient,
  accountId: string,
): Promise<{ value: string; expiresAt: Date }> {
  const { value, hash } = createToken();
  const expiresAt = new Date(Date.now() + ABSOLUTE_TTL_MS);

  await prisma.session.create({ data: { id: hash, accountId, expiresAt } });

  return { value, expiresAt };
}

export async function validateSession(
  prisma: PrismaClient,
  value: string,
): Promise<{ accountId: string } | null> {
  const session = await prisma.session.findUnique({
    where: { id: hashToken(value) },
    select: { id: true, accountId: true, expiresAt: true, lastSeenAt: true },
  });

  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;
  if (now - session.lastSeenAt.getTime() > IDLE_TTL_MS) return null;

  if (now - session.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(now) },
    });
  }

  return { accountId: session.accountId };
}

export async function revokeSession(prisma: PrismaClient, value: string): Promise<void> {
  // deleteMany rather than delete: signing out twice is not an error.
  await prisma.session.deleteMany({ where: { id: hashToken(value) } });
}

/**
 * No caller in this plan, deliberately. Task 9's password reset inlines the
 * same delete inside a `$transaction` so the credential change and the
 * revocation cannot half-happen; this named form is what sign-out-everywhere
 * calls in plan 2. It is exported and tested now because the reset path proves
 * the behaviour matters, and a reviewer should know why it looks unused.
 */
export async function revokeAllSessions(
  prisma: PrismaClient,
  accountId: string,
): Promise<void> {
  await prisma.session.deleteMany({ where: { accountId } });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @curios/api test src/modules/auth/session.service.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth
git commit -m "feat(api): database-backed sessions with sliding refresh"
```

---

### Task 4: Session plugin and `requireSession`

**Files:**
- Create: `apps/api/src/plugins/session.ts`
- Modify: `apps/api/src/plugins/errors.ts` (whitelist `UNAUTHENTICATED`)
- Modify: `apps/api/src/app.ts` (register the plugin)
- Test: `apps/api/src/plugins/session.test.ts`

**Interfaces:**
- Consumes: `validateSession`, `SESSION_COOKIE` from `../modules/auth/session.service.js` (Task 3).
- Produces: `sessionPlugin`; `request.account: { id: string } | null`; `requireSession` as a `preHandler`; `UnauthenticatedError`.

**Why the errors.ts change belongs to this task:** that plugin maps an error's `code` through a whitelist and replaces anything unlisted with `INTERNAL_ERROR`. A 401 reaching a client as `INTERNAL_ERROR` is a bug, and it is exactly the defect the rate limiter hit in slice 1. The code and its whitelist entry land together or not at all.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/plugins/session.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createSession, SESSION_COOKIE } from '../modules/auth/session.service.js';
import { buildApp } from '../app.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('requireSession', () => {
  it('rejects a request with no cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a cookie that was never issued', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [SESSION_COOKIE]: 'forged-value' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('admits a live session and names the account', async () => {
    const account = await app.prisma.account.create({
      data: { email: `plugin-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const { value } = await createSession(app.prisma, account.id);

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      cookies: { [SESSION_COOKIE]: value },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accountId: account.id });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @curios/api test src/plugins/session.test.ts`
Expected: FAIL — `/auth/me` does not exist, so every case returns 404 rather than 401. That is the correct failure: it proves the route is what is under test.

- [ ] **Step 3: Whitelist the code**

In `apps/api/src/plugins/errors.ts`, add `'UNAUTHENTICATED'` to the `DOMAIN_ERROR_CODES` set.

- [ ] **Step 4: Write the plugin**

Create `apps/api/src/plugins/session.ts`:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { SESSION_COOKIE, validateSession } from '../modules/auth/session.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    account: { id: string } | null;
  }
}

export class UnauthenticatedError extends Error {
  readonly statusCode = 401;
  readonly code = 'UNAUTHENTICATED';

  constructor() {
    super('Sign in to continue.');
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Resolves the session for every request and leaves the decision to the route.
 *
 * Resolving is not authorising: a populated `request.account` means a cookie
 * checked out, nothing more. A route that needs an owner says so with
 * `requireSession`, so an unprotected route is visibly unprotected rather than
 * protected by an accident of hook ordering.
 */
export const sessionPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('account', null);

  app.addHook('onRequest', async (request) => {
    const value = request.cookies[SESSION_COOKIE];
    if (!value) return;

    const session = await validateSession(app.prisma, value);
    if (session) request.account = { id: session.accountId };
  });
});

export async function requireSession(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.account) throw new UnauthenticatedError();
}
```

- [ ] **Step 5: Register it, and add the one route the test needs**

In `apps/api/src/app.ts`, import `{ requireSession, sessionPlugin }` from `./plugins/session.js`, then register after `prismaPlugin` — it reads `app.prisma` — and before the routes:

```ts
  await app.register(sessionPlugin);
```

Add this route beside `/health`. It moves into `auth.routes.ts` in Task 8:

```ts
  app.get('/auth/me', { preHandler: requireSession }, async (request) => ({
    accountId: request.account?.id,
  }));
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @curios/api test src/plugins/session.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Run the whole package**

Run: `pnpm --filter @curios/api test`
Expected: every pre-existing test still passes. The new `onRequest` hook runs on every route, so a regression here shows up as unrelated failures elsewhere.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): resolve the session on every request, require it per route"
```

---

### Task 5: Password service

**Files:**
- Create: `apps/api/src/modules/auth/password.service.ts`
- Modify: `apps/api/package.json`
- Test: `apps/api/src/modules/auth/password.service.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain): Promise<string>`, `verifyPassword(hash, plain): Promise<boolean>`, `burnTime(): Promise<void>`, `isBreached(plain, fetcher?): Promise<boolean>`, `MIN_PASSWORD_LENGTH`, `WeakPasswordError`, `type Fetcher`.

- [ ] **Step 1: Install the dependency**

```bash
pnpm --filter @curios/api add @node-rs/argon2@^2.1.0
```

`@node-rs/argon2` ships prebuilt binaries. The `argon2` package needs a native toolchain that is awkward on Windows, where this is developed.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/modules/auth/password.service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, isBreached, verifyPassword } from './password.service.js';

describe('hashing', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'Correct horse battery staple')).toBe(false);
  });

  it('salts, so the same password twice does not produce the same hash', async () => {
    const first = await hashPassword('same');
    const second = await hashPassword('same');

    expect(first).not.toBe(second);
    expect(await verifyPassword(first, 'same')).toBe(true);
    expect(await verifyPassword(second, 'same')).toBe(true);
  });

  it('uses argon2id at the parameters ADMIN.md specifies', async () => {
    const hash = await hashPassword('anything');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain('m=19456');
    expect(hash).toContain('t=2');
    expect(hash).toContain('p=1');
  });

  it('returns false rather than throwing on a hash it cannot parse', async () => {
    // A corrupted row must fail that one login, not 500 the endpoint.
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});

describe('breach screening', () => {
  it('rejects a password whose hash suffix appears in the range response', async () => {
    // SHA-1 of "password" is 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8.
    const fetcher = async () => ({
      ok: true,
      text: async () => '1E4C9B93F3F0682250B6CF8331B7EE68FD8:12345',
    });

    expect(await isBreached('password', fetcher)).toBe(true);
  });

  it('accepts a password absent from the range response', async () => {
    const fetcher = async () => ({
      ok: true,
      text: async () => 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1',
    });

    expect(await isBreached('password', fetcher)).toBe(false);
  });

  it('sends only the first five characters of the hash, never the password', async () => {
    let requested = '';
    const fetcher = async (url: string) => {
      requested = url;
      return { ok: true, text: async () => '' };
    };

    await isBreached('password', fetcher);

    expect(requested).toBe('https://api.pwnedpasswords.com/range/5BAA6');
    // The path, not the whole URL: the HIBP hostname api.pwnedpasswords.com
    // itself contains the substring, so asserting on the whole URL can never
    // pass. What must not leak is the part we build, which is the path.
    expect(new URL(requested).pathname).not.toContain('password');
  });

  it('fails open when the service is unreachable', async () => {
    const fetcher = async () => {
      throw new Error('network down');
    };

    // A third party's availability must not decide whether someone can sign up.
    expect(await isBreached('password', fetcher)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @curios/api test src/modules/auth/password.service.test.ts`
Expected: FAIL — cannot resolve `./password.service.js`.

- [ ] **Step 4: Write the implementation**

Create `apps/api/src/modules/auth/password.service.ts`:

```ts
import { createHash } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

export type Fetcher = (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>;

export class WeakPasswordError extends Error {
  readonly statusCode = 400;
  readonly code = 'WEAK_PASSWORD';

  constructor(message: string) {
    super(message);
    this.name = 'WeakPasswordError';
  }
}

/** NIST 800-63B: length, screened against known breaches, and nothing else. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * A stalled Have I Been Pwned must not hold a signup open. Failing open only
 * helps if it fails fast, and undici's default header timeout is minutes.
 */
export const BREACH_TIMEOUT_MS = 3000;

/** OWASP, and the parameters ADMIN.md already specifies for the admin system. */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(hash, plain);
  } catch {
    // An unparseable hash is a corrupted row, not a valid login. Failing that
    // attempt is right; throwing would turn one bad row into an outage and
    // would tell an attacker which account it belongs to.
    return false;
  }
}

/**
 * Spends the time an unknown address would have spent verifying a real hash.
 * Without it the response time is an oracle and the identical error message
 * that hides account existence becomes decoration.
 */
export async function burnTime(): Promise<void> {
  await argonHash('timing-equalisation', OPTIONS);
}

/**
 * Have I Been Pwned's range API in k-anonymity mode: only the first five
 * characters of the SHA-1 leave this process, and the match completes locally
 * against the returned suffixes. The password and its full hash never leave.
 *
 * Fails open by design. This is a strength check, not an authorization check,
 * and a third party's uptime must not decide whether someone can sign up.
 */
export async function isBreached(
  plain: string,
  fetcher: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(BREACH_TIMEOUT_MS) }),
): Promise<boolean> {
  const sha1 = createHash('sha1').update(plain).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const response = await fetcher(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!response.ok) return false;

    const body = await response.text();
    return body.split('\n').some((line) => line.trim().split(':')[0]?.toUpperCase() === suffix);
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @curios/api test src/modules/auth/password.service.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): argon2id password hashing with breach screening"
```

---

### Task 6: The mailer, and Mailpit for development

> **Superseded in part by Task 9a below.** This task's `apps/api/src/lib/mailer.ts`
> now holds only the `Mailer` port and a queue-backed implementation; the nodemailer
> transport and `smtpOptions` moved to `apps/workers/src/mail/transport.ts`, along
> with these tests. Mailpit, the compose service and the SMTP_* keys are unchanged.


**Files:**
- Create: `apps/api/src/lib/mailer.ts`
- Modify: `apps/api/package.json`, `docker-compose.yml`, `.env.example`
- Test: `apps/api/src/lib/mailer.test.ts`

**Interfaces:**
- Produces: `interface Mailer { send(message: MailMessage): Promise<void> }`, `interface MailMessage { to, subject, text }`, `createMailer(transport?: Transport): Mailer`, `type Transport`.

- [ ] **Step 1: Install the dependencies**

```bash
pnpm --filter @curios/api add nodemailer@^9.0.6
pnpm --filter @curios/api add -D @types/nodemailer@^8.0.1
```

- [ ] **Step 2: Add Mailpit to docker-compose.yml**

Add beside the other services, bound to localhost only as they are:

```yaml
  mailpit:
    image: axllent/mailpit:v1.31
    container_name: curios-mailpit
    restart: unless-stopped
    ports:
      - "127.0.0.1:1075:1025"
      - "127.0.0.1:8075:8025"
```

Host ports are offset from Mailpit's defaults for the reason Postgres and Redis are: a native service on the default port shadows the container silently. SMTP on `1075`, the web inbox on `8075`.

- [ ] **Step 3: Add the environment keys**

Append to `.env.example`, and mirror into `.env` (gitignored):

```
# Mail. Local development sends to Mailpit, which needs no account and no
# credentials -- read what was sent at http://localhost:8075. Production points
# SMTP_* at a hosted sender; nothing outside lib/mailer.ts knows which is in use.
SMTP_HOST=localhost
SMTP_PORT=1075
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM=Curios <hello@curios.my>
```

- [ ] **Step 4: Write the failing test**

Create `apps/api/src/lib/mailer.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMailer, smtpOptions } from './mailer.js';

function recordingTransport() {
  const sent: Array<Record<string, string>> = [];
  return {
    sent,
    transport: {
      async sendMail(options: { from: string; to: string; subject: string; text: string }) {
        sent.push(options);
        return {};
      },
    },
  };
}

const MAIL_KEYS = ['MAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'] as const;
let saved: Partial<Record<(typeof MAIL_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = Object.fromEntries(MAIL_KEYS.map((k) => [k, process.env[k]]));
  for (const k of MAIL_KEYS) delete process.env[k];
});

afterEach(() => {
  // fileParallelism is off, so a leaked value would follow us into every later
  // test file in this package.
  for (const k of MAIL_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('createMailer', () => {
  it('sends the message with the configured sender', async () => {
    // Deliberately NOT the fallback in mailer.ts: if the two agree, the
    // assertion passes whether or not MAIL_FROM is ever read.
    process.env.MAIL_FROM = 'Curios Test <test@curios.test>';
    const { sent, transport } = recordingTransport();

    await createMailer(transport).send({
      to: 'nadia@example.com',
      subject: 'Confirm your email',
      text: 'https://curios.my/verify?token=abc',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: 'Curios Test <test@curios.test>',
      to: 'nadia@example.com',
      subject: 'Confirm your email',
      text: 'https://curios.my/verify?token=abc',
    });
  });

  it('surfaces a transport failure rather than swallowing it', async () => {
    const transport = {
      async sendMail() {
        throw new Error('connection refused');
      },
    };

    // A silently dropped verification email is an account nobody can activate.
    await expect(
      createMailer(transport).send({ to: 'a@b.c', subject: 's', text: 't' }),
    ).rejects.toThrow('connection refused');
  });
});

describe('smtpOptions', () => {
  it('reaches Mailpit in cleartext, because local Mailpit offers no TLS', () => {
    process.env.SMTP_HOST = 'localhost';
    process.env.SMTP_PORT = '1075';

    expect(smtpOptions()).toMatchObject({
      host: 'localhost',
      port: 1075,
      secure: false,
      requireTLS: false,
      auth: undefined,
    });
  });

  it('uses implicit TLS on 465', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'apikey';
    process.env.SMTP_PASSWORD = 'secret';

    expect(smtpOptions()).toMatchObject({ port: 465, secure: true });
  });

  it('demands STARTTLS on 587 whenever credentials are in play', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'apikey';
    process.env.SMTP_PASSWORD = 'secret';

    // Without requireTLS, a server that does not advertise STARTTLS gets the
    // username and password in cleartext.
    expect(smtpOptions()).toMatchObject({
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'apikey', pass: 'secret' },
    });
  });

  it('falls back to the Mailpit port when SMTP_PORT is set but empty', () => {
    process.env.SMTP_HOST = 'localhost';
    process.env.SMTP_PORT = '';

    // Number('') is 0, and nodemailer treats a falsy port as "use 587".
    expect(smtpOptions().port).toBe(1075);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @curios/api test src/lib/mailer.test.ts`
Expected: FAIL — cannot resolve `./mailer.js`.

- [ ] **Step 6: Write the implementation**

Create `apps/api/src/lib/mailer.ts`:

```ts
import { createTransport } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export type Transport = {
  sendMail(options: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
};

/** Mailpit's SMTP port in docker-compose.yml, offset from the default for the
 *  same reason Postgres and Redis are. */
const MAILPIT_PORT = 1075;

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: { user: string; pass: string } | undefined;
}

/**
 * How this process connects to an SMTP server, resolved from the environment.
 *
 * Split out from `createMailer` so the TLS decision is testable without opening
 * a socket. It is the part worth testing: the same variables point at a
 * credential-free Mailpit locally and at a hosted sender in production, and
 * those two want opposite transport settings.
 */
export function smtpOptions(): SmtpOptions {
  // Number('') is 0 and nodemailer reads a falsy port as "use 587", so an
  // SMTP_PORT that is present but empty would silently reach the wrong port.
  const parsed = Number.parseInt(process.env.SMTP_PORT ?? '', 10);
  const port = Number.isInteger(parsed) && parsed > 0 ? parsed : MAILPIT_PORT;

  const user = process.env.SMTP_USER;
  const auth = user ? { user, pass: process.env.SMTP_PASSWORD ?? '' } : undefined;

  return {
    host: process.env.SMTP_HOST ?? 'localhost',
    port,
    // 465 is implicit TLS; every other port negotiates upward or stays plain.
    secure: port === 465,
    // Only ever cleartext where there is nothing to protect. Once credentials
    // are configured, a server that does not offer STARTTLS must fail the
    // connection rather than receive the password in the clear. Local Mailpit
    // has no credentials and no TLS, so it stays reachable.
    requireTLS: Boolean(auth) && port !== 465,
    auth,
  };
}

/**
 * The only module that knows how mail leaves this system.
 *
 * Local development points SMTP_* at Mailpit, which needs no account, so a
 * fresh clone completes a signup without configuring anything -- the property
 * BACKEND.md was protecting when it ruled out email on the login path.
 * Production points the same variables at a hosted sender, and nothing above
 * this line knows which, so the choice stays reversible.
 *
 * Plain text only, deliberately: three transactional messages carrying one link
 * each. An HTML template is a rendering dependency and a phishing-shaped email
 * for no gain.
 */
export function createMailer(transport?: Transport): Mailer {
  const resolved: Transport = transport ?? createTransport(smtpOptions());

  return {
    async send(message: MailMessage): Promise<void> {
      await resolved.sendMail({
        from: process.env.MAIL_FROM ?? 'Curios <hello@curios.my>',
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @curios/api test src/lib/mailer.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 8: Verify against real Mailpit by hand**

```bash
docker compose up -d mailpit
```

Then send one message through the real transport and confirm it arrives at `http://localhost:8075`. The unit tests prove the message is composed correctly; this proves the SMTP wiring reaches a real server, which no double can. Record what you saw in your report.

- [ ] **Step 8b: `rate-limit.test.ts` needs a session too**

Step 8 names `ingest.service.test.ts` and misses this one. `rate-limit.test.ts` injects
`POST /ingest` and `GET /ingest/:id` unauthenticated, so once the session hook guards the
scope all four of its ingest assertions fail on 401 before any limiter is reached.

Give its fixture an account and a session cookie. Do not relax the assertions: they still
hold unchanged, because the invalid `sourceUrl` is rejected with a 400 before the
ownership check, and a missing ingestion id is still a 404. What they measure is the
budget, not the gate in front of it.

**Also:** every `app.inject` in `ingest.authz.test.ts` passes its own `remoteAddress`,
including the twenty-five in Step 6. That makes Step 6 sharper rather than weaker — with
one address per request the per-IP budget can never be the reason anything is refused,
which leaves the per-page budget as the only possible explanation, and that is precisely
what the step is about.

- [ ] **Step 9: Commit**

```bash
git add apps/api docker-compose.yml .env.example
git commit -m "feat(api): mail module with mailpit for local development"
```

---

### Task 7: Verification and reset tokens

**Files:**
- Create: `apps/api/src/modules/auth/token.service.ts`
- Test: `apps/api/src/modules/auth/token.service.test.ts`

**Interfaces:**
- Consumes: `createToken`, `hashToken` from `../../lib/tokens.js` (Task 2); `AuthTokenKind` from `@curios/db` (Task 1).
- Produces:
  - `issueToken(prisma, accountId, kind): Promise<string>` — returns the value to put in a link
  - `consumeToken(prisma, value, kind): Promise<{ accountId: string } | null>`
  - `VERIFICATION_TTL_MS`, `RESET_TTL_MS`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/auth/token.service.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@curios/db';
import { consumeToken, issueToken } from './token.service.js';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST } },
});

async function anAccount(): Promise<string> {
  const account = await prisma.account.create({
    data: { email: `tok-${randomUUID()}@example.com` },
    select: { id: true },
  });
  return account.id;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

describe('consumeToken', () => {
  it('accepts a freshly issued token once', async () => {
    const accountId = await anAccount();
    const value = await issueToken(prisma, accountId, 'EMAIL_VERIFICATION');

    expect(await consumeToken(prisma, value, 'EMAIL_VERIFICATION')).toEqual({ accountId });
  });

  it('refuses the same token a second time', async () => {
    const accountId = await anAccount();
    const value = await issueToken(prisma, accountId, 'PASSWORD_RESET');
    await consumeToken(prisma, value, 'PASSWORD_RESET');

    // A reset link in an inbox is reusable forever unless this holds.
    expect(await consumeToken(prisma, value, 'PASSWORD_RESET')).toBeNull();
  });

  it('refuses a token presented for the wrong purpose', async () => {
    const accountId = await anAccount();
    const value = await issueToken(prisma, accountId, 'EMAIL_VERIFICATION');

    // Otherwise a verification link doubles as a password reset.
    expect(await consumeToken(prisma, value, 'PASSWORD_RESET')).toBeNull();
  });

  it('refuses an expired token', async () => {
    const accountId = await anAccount();
    const value = await issueToken(prisma, accountId, 'PASSWORD_RESET');
    await prisma.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await consumeToken(prisma, value, 'PASSWORD_RESET')).toBeNull();
  });

  it('refuses a value that was never issued', async () => {
    expect(await consumeToken(prisma, 'invented', 'EMAIL_VERIFICATION')).toBeNull();
  });

  it('lets only one of two simultaneous uses win', async () => {
    const accountId = await anAccount();
    const value = await issueToken(prisma, accountId, 'PASSWORD_RESET');

    const results = await Promise.all([
      consumeToken(prisma, value, 'PASSWORD_RESET'),
      consumeToken(prisma, value, 'PASSWORD_RESET'),
    ]);

    // Single-use has to mean single-use under concurrency, or a double-clicked
    // link consumes it twice and the second caller resets a password on a
    // token that was already spent.
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });
});

describe('issueToken', () => {
  it('stores a hash, never the value that goes in the email', async () => {
    const accountId = await anAccount();
    const value = await issueToken(prisma, accountId, 'EMAIL_VERIFICATION');

    const rows = await prisma.authToken.findMany({ select: { id: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(value);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @curios/api test src/modules/auth/token.service.test.ts`
Expected: FAIL — cannot resolve `./token.service.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/modules/auth/token.service.ts`:

```ts
import type { AuthTokenKind, PrismaClient } from '@curios/db';
import { createToken, hashToken } from '../../lib/tokens.js';

/** Long enough to survive a slow inbox, short enough that a leaked link ages out. */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** Shorter, because this one changes a credential. */
export const RESET_TTL_MS = 60 * 60 * 1000;

function ttlFor(kind: AuthTokenKind): number {
  return kind === 'PASSWORD_RESET' ? RESET_TTL_MS : VERIFICATION_TTL_MS;
}

export async function issueToken(
  prisma: PrismaClient,
  accountId: string,
  kind: AuthTokenKind,
): Promise<string> {
  const { value, hash } = createToken();

  await prisma.authToken.create({
    data: { id: hash, accountId, kind, expiresAt: new Date(Date.now() + ttlFor(kind)) },
  });

  return value;
}

/**
 * Marks the token spent and returns whose it was, or null.
 *
 * The update is the check. A read-then-write would let two simultaneous uses of
 * one link both pass -- a double-clicked reset link is enough to trigger it --
 * so the `usedAt: null` guard lives in the WHERE clause and the row itself is
 * the serialisation point. The same reasoning as the sign-in race already fixed
 * in `findOrCreateAccountForGoogle`.
 */
export async function consumeToken(
  prisma: PrismaClient,
  value: string,
  kind: AuthTokenKind,
): Promise<{ accountId: string } | null> {
  const id = hashToken(value);

  const claimed = await prisma.authToken.updateMany({
    where: { id, kind, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  if (claimed.count !== 1) return null;

  const token = await prisma.authToken.findUnique({ where: { id }, select: { accountId: true } });
  return token ? { accountId: token.accountId } : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @curios/api test src/modules/auth/token.service.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth
git commit -m "feat(api): single-use verification and reset tokens"
```

---

### Task 8: Signup, login and logout

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Create: `apps/api/src/modules/auth/auth.routes.ts`
- Modify: `apps/api/src/plugins/rate-limit.ts` (limiters for the auth routes)
- Modify: `apps/api/src/app.ts` (register `authRoutes`, remove the temporary `/auth/me`)
- Test: `apps/api/src/modules/auth/auth.routes.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `burnTime`, `isBreached`, `MIN_PASSWORD_LENGTH`, `WeakPasswordError` (Task 5); `issueToken` (Task 7); `createSession`, `revokeSession`, `SESSION_COOKIE`, `ABSOLUTE_TTL_MS` (Task 3); `Mailer` (Task 6); `requireSession` (Task 4).
- Produces:
  - `signUpWithPassword(deps, input): Promise<void>` where `deps = { prisma, mailer }`, `input = { email, password }`
  - `signInWithPassword(prisma, input): Promise<{ accountId: string }>`
  - `InvalidCredentialsError`
  - `authRoutes` — a `FastifyPluginAsyncZod`

**Copy rules for this task.** The failure message is one string for every cause, and it must also serve the person who simply has not verified yet, because distinguishing that case reintroduces the enumeration oracle. Use exactly: `Check your email and password. If you just signed up, confirm your address first.`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/auth/auth.routes.test.ts`:

**Every `app.inject` in this file passes its own `remoteAddress`.** These routes
sit behind a 20-per-15-minutes per-IP limiter, and one package run makes far more
than twenty auth requests. Without this the suite starts returning 429 partway
through and the failures look like anything but a rate limit. Put this at the top
of the file and use it on every request, following the pattern
`rate-limit.test.ts` already establishes:

```ts
let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;
```


```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { SESSION_COOKIE } from './session.service.js';
import { hashPassword } from './password.service.js';

let app: FastifyInstance;

const GOOD_PASSWORD = 'a-long-enough-passphrase';

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

/** Records what was sent instead of reaching a real SMTP server. */
const sent: Array<{ to: string; subject: string; text: string }> = [];

beforeAll(async () => {
  app = await buildApp({
    auth: {
      mailer: {
        async send(message: { to: string; subject: string; text: string }) {
          sent.push(message);
        },
      },
      // No request leaves the suite: HIBP is a third party, and a test that
      // depends on its uptime is a test that fails on a train.
      fetcher: async () => ({ ok: true, text: async () => '' }),
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function aVerifiedAccountWithPassword(): Promise<string> {
  const email = `login-${randomUUID()}@example.com`;
  await app.prisma.account.create({
    data: {
      email,
      emailVerifiedAt: new Date(),
      password: { create: { hash: await hashPassword(GOOD_PASSWORD) } },
    },
  });
  return email;
}

describe('POST /auth/signup', () => {
  it('accepts a new address and issues no session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      remoteAddress: from(),
      payload: { email: `new-${randomUUID()}@example.com`, password: GOOD_PASSWORD },
    });

    expect(res.statusCode).toBe(202);
    // An unverified account must not be usable. Issuing a session here is the
    // takeover: sign up as someone else's address and you are already inside.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('answers identically for an address that already has an account', async () => {
    const email = await aVerifiedAccountWithPassword();

    const taken = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      remoteAddress: from(),
      payload: { email, password: GOOD_PASSWORD },
    });
    const fresh = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      remoteAddress: from(),
      payload: { email: `other-${randomUUID()}@example.com`, password: GOOD_PASSWORD },
    });

    // The form must not be usable to discover who has an account.
    expect(taken.statusCode).toBe(fresh.statusCode);
    expect(taken.body).toBe(fresh.body);
  });

  it('writes no second account for an address that already has one', async () => {
    const email = await aVerifiedAccountWithPassword();

    await app.inject({
      method: 'POST',
      url: '/auth/signup',
      remoteAddress: from(),
      payload: { email, password: GOOD_PASSWORD },
    });

    expect(await app.prisma.account.count({ where: { email } })).toBe(1);
  });

  it('re-sends the verification link to an unverified address, rather than telling it to sign in', async () => {
    // The F2 trap: a signup whose mail failed after the account was written
    // leaves someone who cannot sign in (unverified) and cannot start over
    // (address taken). Telling them to sign in strands them, so the retry has
    // to re-send the link. Only the mail differs -- the HTTP response is
    // identical either way, which the enumeration test above pins down.
    const email = `retry-${randomUUID()}@example.com`;
    await app.prisma.account.create({
      data: { email, password: { create: { hash: await hashPassword(GOOD_PASSWORD) } } },
    });
    sent.length = 0;

    await app.inject({
      method: 'POST',
      url: '/auth/signup',
      remoteAddress: from(),
      payload: { email, password: GOOD_PASSWORD },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(email);
    expect(sent[0]?.subject).toBe('Confirm your email');
    expect(sent[0]?.text).toContain('/verify?token=');
  });

  it('rejects a password shorter than the minimum', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      remoteAddress: from(),
      payload: { email: `short-${randomUUID()}@example.com`, password: 'sh0rt' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /auth/login', () => {
  it('issues an httpOnly session cookie for the right password', async () => {
    const email = await aVerifiedAccountWithPassword();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email, password: GOOD_PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
    expect(cookie?.path).toBe('/');
  });

  it('gives the same answer for a wrong password and an unknown address', async () => {
    const email = await aVerifiedAccountWithPassword();

    const wrong = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email, password: 'not-the-right-password' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email: `ghost-${randomUUID()}@example.com`, password: 'not-the-right-password' },
    });

    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('refuses an account whose address is not verified', async () => {
    const email = `unverified-${randomUUID()}@example.com`;
    await app.prisma.account.create({
      data: { email, password: { create: { hash: await hashPassword(GOOD_PASSWORD) } } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email, password: GOOD_PASSWORD },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('makes the session immediately unusable', async () => {
    const email = await aVerifiedAccountWithPassword();
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email, password: GOOD_PASSWORD },
    });
    const value = login.cookies.find((c) => c.name === SESSION_COOKIE)?.value ?? '';

    await app.inject({
      method: 'POST',
      url: '/auth/logout',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: value },
    });

    const after = await app.inject({
      method: 'GET',
      url: '/auth/me',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: value },
    });
    expect(after.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @curios/api test src/modules/auth/auth.routes.test.ts`
Expected: FAIL — `/auth/signup` and `/auth/login` return 404.

- [ ] **Step 3: Add the service functions**

Append to `apps/api/src/modules/auth/auth.service.ts`:

```ts
import type { Mailer } from '../../lib/mailer.js';
import {
  burnTime,
  hashPassword,
  isBreached,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
  WeakPasswordError,
  type Fetcher,
} from './password.service.js';
import { issueToken } from './token.service.js';

export class InvalidCredentialsError extends Error {
  readonly statusCode = 401;
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('Check your email and password. If you just signed up, confirm your address first.');
    this.name = 'InvalidCredentialsError';
  }
}

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Always resolves, whether or not the address was already taken.
 *
 * The HTTP response cannot distinguish the two cases, so the signup form cannot
 * be used to discover who has an account. The email carries the truth instead,
 * and only the person who can read that inbox learns anything.
 *
 * An existing address writes NO row. `Account.email` is unique, so a second
 * insert would either fail or force the disambiguation the Google path uses,
 * producing a duplicate account the owner could never explain.
 */
export async function signUpWithPassword(
  deps: { prisma: PrismaClient; mailer: Mailer; fetcher?: Fetcher },
  input: { email: string; password: string },
): Promise<void> {
  const email = normaliseEmail(input.email);

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (await isBreached(input.password, deps.fetcher)) {
    throw new WeakPasswordError('That password has appeared in a public breach. Pick another.');
  }

  const existing = await deps.prisma.account.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true, password: { select: { id: true } } },
  });

  if (existing) {
    // Two different existing-account cases, one identical HTTP response.
    //
    // An account that is unverified and has a password is almost always the
    // same person retrying -- often because the first attempt 500'd when mail
    // failed *after* the account was written. Telling them to sign in would
    // trap them: they cannot, because they are unverified, and the address is
    // taken so they cannot start over either. Re-send the link instead.
    //
    // Only the mail differs. The response is byte-identical either way, so the
    // form still cannot be used to discover who has an account, and the only
    // person who learns anything is whoever can read that inbox.
    if (!existing.emailVerifiedAt && existing.password) {
      const retry = await issueToken(deps.prisma, existing.id, 'EMAIL_VERIFICATION');
      await deps.mailer.send({
        to: email,
        subject: 'Confirm your email',
        text: `Confirm your address to finish setting up Curios:

${process.env.APP_URL ?? 'http://localhost:3000'}/verify?token=${retry}`,
      });
      return;
    }

    await deps.mailer.send({
      to: email,
      subject: 'You already have a Curios account',
      text: 'Someone tried to sign up with this address. You already have an account -- sign in instead. If that was not you, you can ignore this message.',
    });
    return;
  }

  const account = await deps.prisma.account.create({
    data: { email, password: { create: { hash: await hashPassword(input.password) } } },
    select: { id: true },
  });

  const token = await issueToken(deps.prisma, account.id, 'EMAIL_VERIFICATION');
  await deps.mailer.send({
    to: email,
    subject: 'Confirm your email',
    text: `Confirm your address to finish setting up Curios:\n\n${process.env.APP_URL ?? 'http://localhost:3000'}/verify?token=${token}`,
  });
}

/**
 * One failure for every cause, including an unverified address.
 *
 * Distinguishing "no such account" from "wrong password" hands an attacker a
 * list of real addresses. Distinguishing "not verified" does the same, which is
 * why the single message tells everyone to check verification too.
 */
export async function signInWithPassword(
  prisma: PrismaClient,
  input: { email: string; password: string },
): Promise<{ accountId: string }> {
  const email = normaliseEmail(input.email);

  const account = await prisma.account.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true, password: { select: { hash: true } } },
  });

  if (!account?.password) {
    // Spend the time a real verification would have spent, or the response time
    // is an oracle and the identical message above is decoration.
    await burnTime();
    throw new InvalidCredentialsError();
  }

  const ok = await verifyPassword(account.password.hash, input.password);
  if (!ok || !account.emailVerifiedAt) throw new InvalidCredentialsError();

  return { accountId: account.id };
}
```

Add `'INVALID_CREDENTIALS'` and `'WEAK_PASSWORD'` to `DOMAIN_ERROR_CODES` in `apps/api/src/plugins/errors.ts`. Both are client-facing; without this they reach the browser as `INTERNAL_ERROR`.

- [ ] **Step 4: Add the rate limiters**

Append to `apps/api/src/plugins/rate-limit.ts`, following the shape of the existing limiters:

```ts
/**
 * Credential stuffing is the case this exists for: many addresses, one source.
 */
export function authPerIpLimit(redis: IORedis): RateLimitPluginOptions {
  return {
    ...FAIL_CLOSED,
    global: true,
    redis,
    nameSpace: namespace('auth-ip:'),
    max: limit('RATE_LIMIT_AUTH_PER_IP', 20),
    timeWindow: '15 minutes',
    keyGenerator: caller,
    errorResponseBuilder: tooMany((after) => `Too many attempts. Try again in ${after}.`),
  };
}

/**
 * And the other shape: one address, many sources. Runs at preHandler because
 * the address is in the body, which onRequest has not parsed yet.
 */
export function authPerEmailLimit(redis: IORedis): RateLimitPluginOptions {
  return {
    ...FAIL_CLOSED,
    global: true,
    redis,
    hook: 'preHandler',
    nameSpace: namespace('auth-email:'),
    max: limit('RATE_LIMIT_AUTH_PER_EMAIL', 10),
    timeWindow: '15 minutes',
    keyGenerator: (request) =>
      ((request.body as { email?: string } | undefined)?.email ?? caller(request)).toLowerCase(),
    errorResponseBuilder: tooMany((after) => `Too many attempts. Try again in ${after}.`),
  };
}
```

Add `RATE_LIMIT_AUTH_PER_IP=20` and `RATE_LIMIT_AUTH_PER_EMAIL=10` to `.env.example` beside the existing rate-limit keys.

- [ ] **Step 5: Write the routes**

Create `apps/api/src/modules/auth/auth.routes.ts`:

```ts
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createMailer, type Mailer } from '../../lib/mailer.js';
import type { Fetcher } from './password.service.js';
import { requireSession } from '../../plugins/session.js';
import { signInWithPassword, signUpWithPassword } from './auth.service.js';
import {
  ABSOLUTE_TTL_MS,
  createSession,
  revokeSession,
  SESSION_COOKIE,
} from './session.service.js';

const credentials = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

export interface AuthRouteOptions {
  /** Tests pass a recording mailer; production leaves it undefined. */
  mailer?: Mailer;
  /** Tests pass a stub so no request reaches Have I Been Pwned. */
  fetcher?: Fetcher;
}

export const authRoutes: FastifyPluginAsyncZod<AuthRouteOptions> = async (app, options) => {
  const mailer = options.mailer ?? createMailer();
  const fetcher = options.fetcher;

  app.post('/auth/signup', { schema: { body: credentials } }, async (request, reply) => {
    await signUpWithPassword({ prisma: app.prisma, mailer, fetcher }, request.body);
    // 202, not 200: the account is not usable until the address is confirmed.
    return reply.status(202).send({ status: 'check_your_email' });
  });

  app.post('/auth/login', { schema: { body: credentials } }, async (request, reply) => {
    const { accountId } = await signInWithPassword(app.prisma, request.body);
    const { value } = await createSession(app.prisma, accountId);

    return reply
      .setCookie(SESSION_COOKIE, value, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: ABSOLUTE_TTL_MS / 1000,
        domain: process.env.COOKIE_DOMAIN,
      })
      .send({ accountId });
  });

  app.post('/auth/logout', async (request, reply) => {
    const value = request.cookies[SESSION_COOKIE];
    if (value) await revokeSession(app.prisma, value);

    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ status: 'signed_out' });
  });

  app.get('/auth/me', { preHandler: requireSession }, async (request) => ({
    accountId: request.account?.id,
  }));
};
```

Add `COOKIE_DOMAIN=` to `.env.example`, documented as blank in development and `.curios.my` in production so the web and API origins share the cookie.

- [ ] **Step 6: Register the routes**

In `apps/api/src/app.ts`, delete the temporary `/auth/me` added in Task 4 and register the auth routes inside their own rate-limited scope, following the pattern the chat and ingest routes already use:

```ts
  await app.register(async (scope) => {
    await scope.register(rateLimit, authPerIpLimit(app.rateLimitRedis));
    await scope.register(rateLimit, authPerEmailLimit(app.rateLimitRedis));
    await scope.register(authRoutes, overrides.auth ?? {});
  });
```

Change `buildApp`'s signature to accept them, defaulting to none so every
existing caller is unaffected:

```ts
export interface AppOverrides {
  auth?: AuthRouteOptions;
}

export async function buildApp(overrides: AppOverrides = {}) {
```

This is the seam the tests use, and the only one. Production calls
`buildApp()` with no argument and gets the real mailer and the real
breach-screening fetcher.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @curios/api test src/modules/auth/auth.routes.test.ts`
Expected: PASS, 8 tests.

If the login tests trip the rate limiter, the fixtures are sharing an address or a source address. Give each test its own account, as the fixtures above do — do not raise the limits to make tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api .env.example
git commit -m "feat(api): password signup, login and logout"
```

---

### Task 9: Email verification and password reset

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.routes.ts`
- Test: `apps/api/src/modules/auth/auth.reset.test.ts`

**Interfaces:**
- Consumes: `consumeToken`, `issueToken` (Task 7); `revokeAllSessions`, `createSession` (Task 3); `hashPassword`, `isBreached` (Task 5).
- Produces: `verifyEmail(prisma, token)`, `requestPasswordReset(deps, email)`, `resetPassword(deps, input)`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/auth/auth.reset.test.ts`:

**Every `app.inject` in this file passes its own `remoteAddress`.** These routes
sit behind a 20-per-15-minutes per-IP limiter, and one package run makes far more
than twenty auth requests. Without this the suite starts returning 429 partway
through and the failures look like anything but a rate limit. Put this at the top
of the file and use it on every request, following the pattern
`rate-limit.test.ts` already establishes:

```ts
let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;
```


```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { hashPassword } from './password.service.js';
import { issueToken } from './token.service.js';
import { createSession, SESSION_COOKIE } from './session.service.js';

let app: FastifyInstance;
const PASSWORD = 'a-long-enough-passphrase';
const NEW_PASSWORD = 'an-entirely-different-passphrase';

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

/** Records what was sent instead of reaching a real SMTP server. */
const sent: Array<{ to: string; subject: string; text: string }> = [];

beforeAll(async () => {
  app = await buildApp({
    auth: {
      mailer: {
        async send(message: { to: string; subject: string; text: string }) {
          sent.push(message);
        },
      },
      // resetPassword screens the new password against Have I Been Pwned. Left
      // to the default fetcher this file would make a real outbound request per
      // reset, which is slow, fails offline, and shows a third party the suite.
      fetcher: async () => ({ ok: true, text: async () => '' }),
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function anAccount(verified: boolean): Promise<{ id: string; email: string }> {
  const email = `reset-${randomUUID()}@example.com`;
  const account = await app.prisma.account.create({
    data: {
      email,
      emailVerifiedAt: verified ? new Date() : null,
      password: { create: { hash: await hashPassword(PASSWORD) } },
    },
    select: { id: true },
  });
  return { id: account.id, email };
}

const tokenFrom = (text: string): string => text.match(/token=([^\s]+)/)?.[1] ?? '';

describe('POST /auth/verify-email', () => {
  it('marks the address verified and lets the account sign in', async () => {
    const account = await anAccount(false);
    const token = await issueToken(app.prisma, account.id, 'EMAIL_VERIFICATION');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      remoteAddress: from(),
      payload: { token },
    });
    expect(res.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email: account.email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('refuses a token that has already been used', async () => {
    const account = await anAccount(false);
    const token = await issueToken(app.prisma, account.id, 'EMAIL_VERIFICATION');
    await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      remoteAddress: from(),
      payload: { token },
    });

    const again = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      remoteAddress: from(),
      payload: { token },
    });
    expect(again.statusCode).toBe(400);
  });
});

describe('POST /auth/forgot-password', () => {
  it('answers identically for a known and an unknown address', async () => {
    const account = await anAccount(true);

    const known = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      remoteAddress: from(),
      payload: { email: account.email },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      remoteAddress: from(),
      payload: { email: `ghost-${randomUUID()}@example.com` },
    });

    expect(known.statusCode).toBe(unknown.statusCode);
    expect(known.body).toBe(unknown.body);
  });

  it('supersedes an earlier reset link when a newer one is requested', async () => {
    const account = await anAccount(true);
    sent.length = 0;

    await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      remoteAddress: from(),
      payload: { email: account.email },
    });
    await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      remoteAddress: from(),
      payload: { email: account.email },
    });

    const [first, second] = sent.map((m) => tokenFrom(m.text));
    expect(first).not.toBe(second);

    // Asking again is what someone does when the first link did not arrive, or
    // when they suspect the first request was not theirs. Leaving the earlier
    // link live for its full hour keeps an unwanted key to the account in an
    // inbox the owner may not control.
    const stale = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      remoteAddress: from(),
      payload: { token: first, password: NEW_PASSWORD },
    });
    expect(stale.statusCode).toBe(400);

    const newest = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      remoteAddress: from(),
      payload: { token: second, password: NEW_PASSWORD },
    });
    expect(newest.statusCode).toBe(200);
  });
});

describe('POST /auth/reset-password', () => {
  it('changes the password and lets the new one work', async () => {
    const account = await anAccount(true);
    const token = await issueToken(app.prisma, account.id, 'PASSWORD_RESET');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      remoteAddress: from(),
      payload: { token, password: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: from(),
      payload: { email: account.email, password: NEW_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('revokes every existing session', async () => {
    const account = await anAccount(true);
    const existing = await createSession(app.prisma, account.id);
    const token = await issueToken(app.prisma, account.id, 'PASSWORD_RESET');

    await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      remoteAddress: from(),
      payload: { token, password: NEW_PASSWORD },
    });

    // A reset exists to end an intrusion. Leaving the intruder's session alive
    // defeats the entire point of the flow.
    const after = await app.inject({
      method: 'GET',
      url: '/auth/me',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: existing.value },
    });
    expect(after.statusCode).toBe(401);
  });

  it('refuses a verification token presented as a reset token', async () => {
    const account = await anAccount(true);
    const token = await issueToken(app.prisma, account.id, 'EMAIL_VERIFICATION');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      remoteAddress: from(),
      payload: { token, password: NEW_PASSWORD },
    });

    // Otherwise a verification link in an inbox is a password reset.
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @curios/api test src/modules/auth/auth.reset.test.ts`
Expected: FAIL — the three routes return 404.

- [ ] **Step 3: Add the service functions**

Append to `apps/api/src/modules/auth/auth.service.ts`:

```ts
export class InvalidTokenError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_TOKEN';

  constructor() {
    super('That link has expired or has already been used. Request a new one.');
    this.name = 'InvalidTokenError';
  }
}

export async function verifyEmail(prisma: PrismaClient, token: string): Promise<void> {
  const consumed = await consumeToken(prisma, token, 'EMAIL_VERIFICATION');
  if (!consumed) throw new InvalidTokenError();

  await prisma.account.update({
    where: { id: consumed.accountId },
    data: { emailVerifiedAt: new Date() },
  });
}

/** Always resolves, for the same enumeration reason signup does. */
export async function requestPasswordReset(
  deps: { prisma: PrismaClient; mailer: Mailer },
  email: string,
): Promise<void> {
  const normalised = normaliseEmail(email);
  const account = await deps.prisma.account.findUnique({
    where: { email: normalised },
    select: { id: true, password: { select: { id: true } } },
  });

  // No account, or a Google-only account with no password to reset: send
  // nothing and say nothing. The caller cannot tell which happened.
  if (!account?.password) return;

  // Supersede any reset link already outstanding. Asking again is what someone
  // does when the first did not arrive, or when they suspect the first request
  // was not theirs -- and in that second case the earlier link is exactly what
  // must stop working. Leaving it live for its full hour keeps a working key to
  // the account sitting in an inbox.
  await deps.prisma.authToken.updateMany({
    where: { accountId: account.id, kind: 'PASSWORD_RESET', usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = await issueToken(deps.prisma, account.id, 'PASSWORD_RESET');
  await deps.mailer.send({
    to: normalised,
    subject: 'Reset your password',
    text: `Choose a new password:\n\n${process.env.APP_URL ?? 'http://localhost:3000'}/reset?token=${token}\n\nThis link works once and expires in an hour. If you did not ask for it, ignore this message.`,
  });
}

export async function resetPassword(
  prisma: PrismaClient,
  input: { token: string; password: string },
  fetcher?: Fetcher,
): Promise<void> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (await isBreached(input.password, fetcher)) {
    throw new WeakPasswordError('That password has appeared in a public breach. Pick another.');
  }

  const consumed = await consumeToken(prisma, input.token, 'PASSWORD_RESET');
  if (!consumed) throw new InvalidTokenError();

  const hash = await hashPassword(input.password);

  await prisma.$transaction([
    prisma.passwordCredential.upsert({
      where: { accountId: consumed.accountId },
      create: { accountId: consumed.accountId, hash },
      update: { hash },
    }),
    // Every session dies. A reset that leaves the intruder signed in is not a
    // recovery, and this is the one place revocation is not optional.
    prisma.session.deleteMany({ where: { accountId: consumed.accountId } }),
  ]);
}
```

Import `consumeToken` from `./token.service.js` at the top of the file. Add `'INVALID_TOKEN'` to `DOMAIN_ERROR_CODES` in `apps/api/src/plugins/errors.ts`.

- [ ] **Step 4: Add the routes**

In `apps/api/src/modules/auth/auth.routes.ts`, add inside `authRoutes`:

```ts
  app.post(
    '/auth/verify-email',
    { schema: { body: z.object({ token: z.string().min(1).max(200) }) } },
    async (request, reply) => {
      await verifyEmail(app.prisma, request.body.token);
      return reply.send({ status: 'verified' });
    },
  );

  app.post(
    '/auth/forgot-password',
    { schema: { body: z.object({ email: z.string().email().max(320) }) } },
    async (request, reply) => {
      await requestPasswordReset({ prisma: app.prisma, mailer }, request.body.email);
      return reply.send({ status: 'check_your_email' });
    },
  );

  app.post(
    '/auth/reset-password',
    {
      schema: {
        body: z.object({ token: z.string().min(1).max(200), password: z.string().min(1).max(200) }),
      },
    },
    async (request, reply) => {
      await resetPassword(app.prisma, request.body, fetcher);
      return reply.send({ status: 'password_changed' });
    },
  );
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @curios/api test src/modules/auth/auth.reset.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): email verification and password reset"
```

---

### Task 9a: Mail leaves the request

Added after Task 9's review, which found forgot-password's response time to be an
account-enumeration oracle: an unknown address returned after one indexed lookup,
a known one after a whole awaited SMTP round trip.

This was a conformance gap rather than a design choice. `slice-2-build-spec.md` already
rules that mail "is sent from a background job, never inside the HTTP request that
triggered it, matching the constraint that nothing slow runs in a request". Tasks 6, 8
and 9 implemented it inline, so the plan under-implemented its own spec. The spec wins.

**Files:**
- Modify: `packages/core/src/types.ts`, `packages/core/src/index.ts` (`MAIL_QUEUE`, `MailJobData`)
- Modify: `apps/api/src/plugins/queue.ts` (a second Queue, decorated as `mailQueue`)
- Modify: `apps/api/src/lib/mailer.ts` (now the port plus `createQueueMailer`)
- Modify: `apps/api/src/modules/auth/auth.routes.ts` (the production default enqueues)
- Create: `apps/workers/src/mail/transport.ts`, `apps/workers/src/mail/mail.worker.ts`
- Modify: `apps/workers/src/main.ts`, `apps/workers/src/queues.ts`

**What it buys, beyond conformance:**

- forgot-password costs the same for an address with an account and one without, to
  within a few local writes. Not constant-time, and the code comment says so.
- A failed send no longer fails the request that triggered it, so a signup cannot leave
  an account written but unreachable -- which is the trap F2's re-send branch exists to
  dig people out of. The cause is now gone, not just the symptom.

**Notes:** the transport lives in `apps/workers` because the two apps must never import
each other, and the API no longer needs nodemailer at all. Mail takes its own Redis
connection: BullMQ blocks on one per worker, so sharing it would let a slow extraction
stall every outgoing verification link. Verified end to end -- enqueue, worker, real
SMTP, Mailpit inbox -- because unit tests with an injected double cannot prove wiring.

---

### Task 10: Google OAuth with state and PKCE

**Files:**
- Create: `apps/api/src/modules/auth/oauth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.routes.ts`
- Test: `apps/api/src/modules/auth/oauth.service.test.ts`

**Interfaces:**
- Consumes: `findOrCreateAccountForGoogle` (already exists); `createSession` (Task 3).
- Produces:
  - `beginGoogleSignIn(): { url: string; state: string; verifier: string }`
  - `exchangeGoogleCode(input, exchange?): Promise<GoogleProfile>`
  - `type CodeExchange`
  - `OAuthStateError`
  - `OAUTH_STATE_COOKIE`, `OAUTH_VERIFIER_COOKIE`

**Why `state` is not optional.** Without it the callback accepts any authorization code, including one an attacker obtained for their own Google account. They send the victim to the callback carrying it, and the victim's browser is now signed in as the attacker — everything the victim then adds belongs to the attacker's account. `state` proves the callback is finishing a flow this browser started.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/auth/oauth.service.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { beginGoogleSignIn, exchangeGoogleCode, OAuthStateError } from './oauth.service.js';

describe('beginGoogleSignIn', () => {
  it('sends a challenge derived from a verifier it keeps', () => {
    const { url, verifier } = beginGoogleSignIn();
    const challenge = new URL(url).searchParams.get('code_challenge');

    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
    expect(new URL(url).searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('never sends the verifier itself', () => {
    const { url, verifier } = beginGoogleSignIn();

    // The whole point of PKCE: an intercepted authorize request must not
    // contain the secret needed to redeem the code.
    expect(url).not.toContain(verifier);
  });

  it('produces a fresh state each time', () => {
    expect(beginGoogleSignIn().state).not.toBe(beginGoogleSignIn().state);
  });
});

describe('exchangeGoogleCode', () => {
  const profile = { sub: 'g-1', email: 'nadia@example.com', emailVerified: true, name: 'Nadia' };
  const exchange = async () => profile;

  it('rejects a callback whose state does not match the cookie', async () => {
    await expect(
      exchangeGoogleCode(
        { code: 'c', state: 'from-the-url', cookieState: 'from-the-browser', verifier: 'v' },
        exchange,
      ),
    ).rejects.toBeInstanceOf(OAuthStateError);
  });

  it('rejects a callback with no state cookie at all', async () => {
    await expect(
      exchangeGoogleCode({ code: 'c', state: 's', cookieState: undefined, verifier: 'v' }, exchange),
    ).rejects.toBeInstanceOf(OAuthStateError);
  });

  it('returns the profile when the state matches', async () => {
    const result = await exchangeGoogleCode(
      { code: 'c', state: 'same', cookieState: 'same', verifier: 'v' },
      exchange,
    );

    expect(result).toEqual(profile);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @curios/api test src/modules/auth/oauth.service.test.ts`
Expected: FAIL — cannot resolve `./oauth.service.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/modules/auth/oauth.service.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { GoogleProfile } from './auth.service.js';

export const OAUTH_STATE_COOKIE = 'curios_oauth_state';
export const OAUTH_VERIFIER_COOKIE = 'curios_oauth_verifier';

export class OAuthStateError extends Error {
  readonly statusCode = 400;
  readonly code = 'OAUTH_STATE_MISMATCH';

  constructor() {
    super('That sign-in link is no longer valid. Try again.');
    this.name = 'OAuthStateError';
  }
}

export type CodeExchange = (input: { code: string; verifier: string }) => Promise<GoogleProfile>;

/** Google's response, parsed at the boundary rather than trusted. */
const idTokenPayload = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
});

export function beginGoogleSignIn(): { url: string; state: string; verifier: string } {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID ?? '');
  url.searchParams.set('redirect_uri', process.env.GOOGLE_REDIRECT_URI ?? '');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return { url: url.toString(), state, verifier };
}

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function exchangeGoogleCode(
  input: { code: string; state: string; cookieState: string | undefined; verifier: string },
  exchange: CodeExchange = redeemWithGoogle,
): Promise<GoogleProfile> {
  if (!input.cookieState || !sameState(input.state, input.cookieState)) {
    throw new OAuthStateError();
  }

  return exchange({ code: input.code, verifier: input.verifier });
}

async function redeemWithGoogle(input: { code: string; verifier: string }): Promise<GoogleProfile> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '',
      grant_type: 'authorization_code',
      code_verifier: input.verifier,
    }),
  });

  if (!response.ok) throw new OAuthStateError();

  const body = z.object({ id_token: z.string().min(1) }).parse(await response.json());
  const [, payload] = body.id_token.split('.');
  const claims = idTokenPayload.parse(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()));

  return {
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified ?? false,
    name: claims.name,
  };
}
```

Add `'OAUTH_STATE_MISMATCH'` to `DOMAIN_ERROR_CODES` in `apps/api/src/plugins/errors.ts`.

**A limit worth knowing.** `redeemWithGoogle` reads the id token's claims without verifying its signature. That is safe *only* because the token came directly from Google's token endpoint over TLS in response to our own request — not from the browser. If any future code path accepts an id token from a client, it must verify the signature against Google's JWKS first.

- [ ] **Step 4: Add the routes**

In `apps/api/src/modules/auth/auth.routes.ts`, add inside `authRoutes`:

```ts
  app.get('/auth/google', async (_request, reply) => {
    const { url, state, verifier } = beginGoogleSignIn();
    const options = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    };

    return reply
      .setCookie(OAUTH_STATE_COOKIE, state, options)
      .setCookie(OAUTH_VERIFIER_COOKIE, verifier, options)
      .redirect(url);
  });

  app.get(
    '/auth/google/callback',
    { schema: { querystring: z.object({ code: z.string().min(1), state: z.string().min(1) }) } },
    async (request, reply) => {
      const profile = await exchangeGoogleCode({
        code: request.query.code,
        state: request.query.state,
        cookieState: request.cookies[OAUTH_STATE_COOKIE],
        verifier: request.cookies[OAUTH_VERIFIER_COOKIE] ?? '',
      });

      const { accountId } = await findOrCreateAccountForGoogle(app.prisma, profile);
      const { value } = await createSession(app.prisma, accountId);

      return reply
        .clearCookie(OAUTH_STATE_COOKIE, { path: '/' })
        .clearCookie(OAUTH_VERIFIER_COOKIE, { path: '/' })
        .setCookie(SESSION_COOKIE, value, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: ABSOLUTE_TTL_MS / 1000,
          domain: process.env.COOKIE_DOMAIN,
        })
        .redirect(`${process.env.APP_URL ?? 'http://localhost:3000'}/app`);
    },
  );
```

- [ ] **Step 4b: Split the rate-limit scopes**

Added during implementation. The per-email limiter keys on the body's email and falls
back to the caller's address when there is none, so on a bodyless route it becomes a
second and stricter per-IP limiter. Probed: `/auth/google` allowed ten requests per
fifteen minutes per address against an intended twenty, and the same applied to
`/auth/google/callback`, `/auth/verify-email` and `/auth/reset-password`. Behind one
NAT that is ten sign-in attempts for everybody.

`auth.routes.ts` therefore exports two plugins instead of one:

- `authRoutes` — signup, login, forgot-password. All carry an address, so both limiters
  apply, unchanged.
- `authFlowRoutes` — verify-email, reset-password, google, google/callback. Reached by
  following a link or a redirect, carrying a one-time secret rather than an address,
  so only the per-IP limiter applies. Guessing a 43-character token is not the attack a
  per-address budget defends.

`app.ts` registers them in two scopes accordingly, which is the principle its own
comment already states for the chat and ingest scopes.

**Also added:** `exchange?: CodeExchange` on `AuthRouteOptions`, and a route-level test
file `oauth.routes.test.ts`. The brief tests only the service, which proves the state
check in isolation while leaving the wiring that feeds it untested — and passing the
URL's own state as the cookie state would satisfy every service test while handing an
attacker the takeover state exists to prevent. Without the seam the success-path test
posts a fake code to Google's real token endpoint.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @curios/api test src/modules/auth/oauth.service.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): google oauth with state and pkce"
```

---

### Task 11: Ingest authorization

**Files:**
- Modify: `apps/api/src/modules/ingest/ingest.service.ts`
- Modify: `apps/api/src/modules/ingest/ingest.routes.ts`
- Test: `apps/api/src/modules/ingest/ingest.authz.test.ts`

**Interfaces:**
- Consumes: `requireSession` (Task 4); `createSession` (Task 3).
- Produces: `PageNotYoursError`; `startIngestion` and `getIngestion` gain an `accountId` parameter.

**What this closes.** Both routes are pre-existing and neither checks ownership. Until now nothing was authenticated, so it was academic. From Task 4 onward it is a live IDOR: any signed-in owner can run an arbitrary URL into another owner's page, and because facts land unverified the result is planted claims sitting in a stranger's review queue waiting to be accepted. The status route leaks another owner's `sourceUrl`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/ingest/ingest.authz.test.ts`:

**Every `app.inject` in this file passes its own `remoteAddress`.** These routes
sit behind a 20-per-15-minutes per-IP limiter, and one package run makes far more
than twenty auth requests. Without this the suite starts returning 429 partway
through and the failures look like anything but a rate limit. Put this at the top
of the file and use it on every request, following the pattern
`rate-limit.test.ts` already establishes:

```ts
let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;
```


```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function anOwnerWithAPage(): Promise<{ cookie: string; pageId: string }> {
  const account = await app.prisma.account.create({
    data: {
      email: `owner-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle: `h-${randomUUID().slice(0, 8)}`,
          displayName: 'A Page',
        },
      },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, pageId: account.pages[0]?.id ?? '' };
}

describe('POST /ingest', () => {
  it('refuses an unauthenticated caller', async () => {
    const mine = await anOwnerWithAPage();

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      payload: { pageId: mine.pageId, sourceUrl: 'https://example.com/' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('refuses to ingest into a page the caller does not own', async () => {
    const mine = await anOwnerWithAPage();
    const theirs = await anOwnerWithAPage();

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { pageId: theirs.pageId, sourceUrl: 'https://example.com/' },
    });

    // Facts land unverified, so a successful cross-owner ingest plants claims
    // in a stranger's review queue.
    expect(res.statusCode).toBe(404);
    expect(await app.prisma.ingestion.count({ where: { pageId: theirs.pageId } })).toBe(0);
  });
});

describe('GET /ingest/:id', () => {
  it('does not reveal another owner ingestion', async () => {
    const mine = await anOwnerWithAPage();
    const theirs = await anOwnerWithAPage();

    const started = await app.inject({
      method: 'POST',
      url: '/ingest',
      cookies: { [SESSION_COOKIE]: theirs.cookie },
      payload: { pageId: theirs.pageId, sourceUrl: 'https://example.com/' },
    });
    const ingestionId = started.json().ingestionId as string;

    const res = await app.inject({
      method: 'GET',
      url: `/ingest/${ingestionId}`,
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    // 404 rather than 403: a 403 confirms the id exists.
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @curios/api test src/modules/ingest/ingest.authz.test.ts`
Expected: FAIL — the unauthenticated call returns 202 and the cross-owner call succeeds. That failure *is* the vulnerability; note the status codes you saw in your report.

- [ ] **Step 3: Add the ownership checks**

In `apps/api/src/modules/ingest/ingest.service.ts`, add an `accountId` to both functions and scope every query by it:

```ts
export class PageNotYoursError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';

  constructor() {
    // 404, not 403. A 403 confirms the id exists, which is itself a leak.
    super('No such page.');
    this.name = 'PageNotYoursError';
  }
}
```

In `startIngestion`, before anything is created:

```ts
  const page = await deps.prisma.page.findFirst({
    where: { id: input.pageId, accountId },
    select: { id: true },
  });
  if (!page) throw new PageNotYoursError();
```

In `getIngestion`, scope the lookup rather than filtering after the read:

```ts
  const ingestion = await prisma.ingestion.findFirst({
    where: { id, page: { accountId } },
    select: { /* unchanged */ },
  });
```

- [ ] **Step 4: Require a session on both routes**

In `apps/api/src/modules/ingest/ingest.routes.ts`, add `preHandler: requireSession` to both route options and pass `request.account.id` into the service calls. `requireSession` guarantees `request.account` is non-null, but narrow it explicitly rather than asserting.

- [ ] **Step 5: Reject unauthenticated callers before the limiters count them**

Route-level `preHandler` hooks run *after* instance-level ones, so as written the
ingest limiters would count a request that is about to be rejected as
unauthenticated. That matters: the per-page limiter keys on `body.pageId`, so
anyone who learns a page id could burn that owner's 20-per-day ingest budget
without ever signing in.

In `apps/api/src/app.ts`, hoist the check to the top of the ingest scope, before
either limiter is registered:

```ts
  await app.register(async (scope) => {
    scope.addHook('onRequest', requireSession);
    await scope.register(rateLimit, ingestPerIpLimit(app.rateLimitRedis));
    await scope.register(rateLimit, ingestPerPageLimit(app.rateLimitRedis));
    await scope.register(ingestRoutes);
  });
```

With the check on the scope, drop the per-route `preHandler: requireSession`
from Step 4 — the scope covers both routes, and two mechanisms for one rule is
how one of them later gets removed by someone who thinks it is redundant.

- [ ] **Step 6: Add a test for that ordering**

Append to `ingest.authz.test.ts`:

```ts
it('does not let an unauthenticated caller burn an owner daily budget', async () => {
  const mine = await anOwnerWithAPage();

  for (let i = 0; i < 25; i++) {
    await app.inject({
      method: 'POST',
      url: '/ingest',
      payload: { pageId: mine.pageId, sourceUrl: 'https://example.com/' },
    });
  }

  // Well past the 20-per-day page budget. If the limiter counted those, the
  // real owner is now locked out of their own page.
  const owner = await app.inject({
    method: 'POST',
    url: '/ingest',
    cookies: { [SESSION_COOKIE]: mine.cookie },
    payload: { pageId: mine.pageId, sourceUrl: 'https://example.com/' },
  });

  expect(owner.statusCode).not.toBe(429);
});
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @curios/api test src/modules/ingest/ingest.authz.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Fix the pre-existing ingest tests**

`ingest.service.test.ts` calls both functions without an `accountId`. Update those calls to pass the owning account, creating one in the fixture. Do **not** weaken an assertion to make a test pass; if a test now fails for a reason other than the new parameter, stop and report it.

Run: `pnpm --filter @curios/api test`
Expected: the whole package passes.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "fix(api): scope ingestion to the owner of the page"
```

---

### Task 12: Correct the documents this plan contradicts

**Files:**
- Modify: `devDocs/BACKEND.md`, `devDocs/README.md`, `devDocs/FRONTEND.md`, `devDocs/slice-1-build-spec.md`

No code and no tests. This task exists because every one of these documents now describes something the code does not do, and a spec that lies is worse than no spec — slice 1 lost a review round to exactly that, when BACKEND.md said "select facts" while the metering section said the fact block was stable per page.

- [ ] **Step 1: BACKEND.md — the Auth section**

Replace "Google only. No passwords, no magic links, no email sending on the login path at all." with the current position: Google and email+password, and why the original position was reversed. Keep the original reasoning visible as the record of what was traded away — the four app switches, the spam folder, the credential we now own. Point at `devDocs/slice-2-build-spec.md` for the full argument.

- [ ] **Step 2: README.md — the risk table**

The "Owner auth" row reads "Google only. No passwords, no magic links. Phone OTP still gates publishing." Update both halves: passwords exist, and the OTP gate is deferred rather than shipped.

- [ ] **Step 3: FRONTEND.md — the State section**

"Auth: httpOnly cookie, refreshed by middleware" describes something the architecture forbids: `apps/web` holds a SELECT-only connection and cannot write, so it cannot extend a session. Correct it to say the API refreshes and middleware only redirects.

- [ ] **Step 4: slice-1-build-spec.md**

Its status table lists the phone OTP publishing gate as slice 2 work. Mark it deferred, and note where the decision is recorded.

- [ ] **Step 5: Verify no contradiction survives**

```bash
grep -rn -i "google only\|no passwords\|refreshed by middleware" devDocs/*.md
```

Expected: every remaining hit is inside a passage explicitly describing the *former* position. If a hit still reads as current guidance, fix it.

- [ ] **Step 6: Commit**

```bash
git add devDocs
git commit -m "docs: align auth and session documentation with slice 2"
```

---

## What plan 2 covers

Deliberately left undone here, each with its spec section already written:

- The handle claim: format rules, the reserved list, the `skeleton` column and its unique index, and the `Page.accountId` unique constraint that makes one-page-per-account real.
- Onboarding: the URL field, the job poll, and the screens around them.
- The fact review screen: cards with `sourceText`, accept, edit, reject-as-soft-delete via `Fact.rejectedAt`, and the rule that nothing sets `verified: true` except an explicit human action on one fact.
- Publish.
- **Explicit account linking** — "add a password" and "connect Google" from account
  settings. The spec's *rule* (nothing ever links by matching an address) is enforced
  here by construction: no code path in this plan links, and both sign-in services key
  on an identity rather than an email. The *feature* needs a settings screen, so it
  travels with the surface that hosts it.
- Everything in `apps/web`: middleware, the authed layout that validates the session, and the sign-in screens that call the routes this plan builds.

Plan 1 ships nothing an owner can see. That is why it is half a slice rather than a slice.
