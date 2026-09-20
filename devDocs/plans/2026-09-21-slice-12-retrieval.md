# Slice 12 — Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** stop sending a page's entire fact list on every question — match the visitor's question against the question each fact already answers, send the best few, and fall back to sending everything whenever the match is weak or anything is missing.

**Architecture:** one vector per fact, produced by a hosted embeddings API behind `packages/embeddings`, stored as raw little-endian `Float32` bytes in Postgres. The selection itself — cosine, a character budget, a similarity floor, a minimum page size — is a pure function in `@curios/core` with no I/O. The chat path loads the page's vectors, embeds the visitor's question (reusing a stored vector when the same question was asked before), and asks that pure function what to send. Every failure — no vectors, a stale model, a slow provider, a weak match, a small page — returns the whole fact list, which is exactly today's behaviour. Prompt caching is switched off in retrieval mode, where a per-question prefix would write a cache entry nothing ever reads.

**Tech Stack:** TypeScript ESM, pnpm + turbo, Prisma 6 / Postgres, Fastify 5, BullMQ, vitest. OpenAI `text-embedding-3-small` at 512 dimensions, called over `fetch` (no SDK).

**Spec:** `devDocs/slice-12-build-spec.md` — read it before Task 1. The spec is the authority; this plan is its argument.

---

## Before anything runs

**The owner must add one line to `.env` before Task 1 starts.** Nothing in this plan edits `.env` — it belongs to the owner.

```
OPENAI_API_KEY=sk-...
```

`apps/api`'s test suite builds the whole app, and from Task 7 onward `chatRoutes` refuses to register without this key — the same way it already refuses without `ANTHROPIC_API_KEY`. Without the line in `.env`, every API test fails at app construction and the failure will look like anything but a missing key.

If the key is absent when an implementer reaches a task that needs it, that is **BLOCKED** — report it, do not invent a value, do not write one into `.env`, and do not work around it by making the key optional.

---

## Global Constraints

Every task's requirements implicitly include this section.

**The values. Use these exact names and numbers; never inline a literal where a constant exists.**

| Constant | Value | Home |
|---|---|---|
| `EMBEDDING_MODEL` | `'text-embedding-3-small'` | `@curios/embeddings` |
| `EMBEDDING_DIMS` | `512` | `@curios/embeddings` |
| `EMBEDDING_TIMEOUT_MS` | `1000` | `@curios/embeddings` |
| `EMBEDDING_BATCH_TIMEOUT_MS` | `30_000` | `@curios/embeddings` |
| `EMBED_BATCH` | `200` | `@curios/embeddings` |
| `RETRIEVAL_MIN_FACTS` | `25` | `@curios/core` |
| `RETRIEVAL_FLOOR` | `0.35` | `@curios/core` |
| `FACT_BUDGET_CHARS` | `4000` | `@curios/core` |

**The environment variable is `OPENAI_API_KEY`.** One name, everywhere. Never a second name, never a fallback to another variable.

**Never accept a Prisma reset prompt.** If `prisma migrate dev` offers to reset the database, answer nothing and report **BLOCKED**. Use `--create-only` and `prisma migrate deploy`, which never reset. If `prisma generate` fails with `EPERM` on Windows, report **BLOCKED** — do not kill the owner's running processes.

**Never edit `.env`.** It is the owner's file. `.env.example` is a repo file and may be edited.

**Never log a visitor's question text, an owner's email, or a mobile number.** Retrieval logging carries ids, counts, scores and a reason — never the question.

**The workspace becomes eleven packages.** After Task 1 the three gates report **11 of 11**, not 10 of 10. A run that says 10 means the new package is not wired into the workspace.

**The gates, run from the repo root:**

```bash
pnpm turbo run test --concurrency=1 --force
pnpm turbo run typecheck --concurrency=1 --force
pnpm turbo run lint --concurrency=1 --force
```

Read the exit code directly. Never pipe a gate through `| tail` or `| head` — the pipe's exit code is the pager's, not the gate's. Never write `pnpm typecheck -- --force`, which TypeScript rejects as TS5093.

**`QuestionEmbedding` does not cascade.** It has no foreign key to anything — it is a global cache keyed by a hash. `TRUNCATE "Account" CASCADE` will not clear it, exactly as `ModelCall` was not cleared before slice 11 fixed it. Any test or harness that causes rows to be written must remove them itself. This is a named constraint because it is the same defect that leaked a row per question into the shared test database last slice.

**Tests are proven by mutation.** For every test you write, break the code it covers in the specific way the task names, confirm the test goes red, restore the code, confirm it goes green. **The mutation lists in this plan have been short in every previous slice.** Before you report a task done, re-read your own diff and ask which lines could be changed or deleted with the suite still green; write a test for each one you find and say in your report what the plan missed.

**Commits.** Conventional-commit subject, and every commit message ends with:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

**Ruling, recorded here because it revises the spec.** The spec's done-gate says a retrieved prompt is "under 1,200 tokens" while also setting `FACT_BUDGET_CHARS` to 4,000. Those conflict: 4,000 characters of Malay prose is roughly 1,150 tokens on its own, and the prompt's instruction block adds about 350 more. The budget is kept at the spec's 4,000 and the **done-gate becomes "under 2,000 tokens, measured"** — a ~70% cut rather than the spec's ~85%. Rationale: the budget is the knob, and starving it to hit a token number risks dropping the price a visitor asked for, which is the one failure this product cannot afford. The golden set is what licenses lowering it later. Cost if wrong: answers cost about 0.25 sen each instead of 0.15 sen. Task 9 corrects the spec's arithmetic.

---

## File Structure

**New package — `packages/embeddings` (`@curios/embeddings`), the eleventh:**

| File | Responsibility |
|---|---|
| `src/types.ts` | The `Embedder` interface — the seam tests stub |
| `src/vector.ts` | `encodeVector` / `decodeVector` — `Float32` to bytes and back |
| `src/openai.embedder.ts` | The one implementation, the model constants, the timeout |
| `src/index.ts` | Exports |
| `src/vector.test.ts`, `src/openai.embedder.test.ts` | Unit tests, no network |

**New elsewhere:**

| File | Responsibility |
|---|---|
| `packages/core/src/retrieval.ts` | Pure selection: cosine, floor, budget, minimum |
| `packages/core/src/retrieval.test.ts` | Its tests, against synthetic vectors |
| `packages/db/src/fact-embedding.ts` | `syncFactEmbeddings` — the one writer of `FactEmbedding` rows |
| `packages/db/src/fact-embedding.test.ts` | Its tests, against the test database |
| `packages/db/prisma/migrations/<stamp>_fact_embedding/migration.sql` | The two tables |
| `apps/api/src/modules/chat/retrieval.ts` | The chat path's choice: retrieve or fall back |
| `apps/api/src/modules/chat/retrieval.test.ts` | Its tests |
| `scripts/backfill-fact-embeddings.ts` | One-off, for facts that predate this slice |
| `fixtures/goldens/catalog.json` | The fourth fixture page — the only one big enough to retrieve |

**Modified:**

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | `FactEmbedding`, `QuestionEmbedding`, `Fact.embedding` |
| `packages/db/src/index.ts` | Export `syncFactEmbeddings` |
| `packages/core/src/index.ts` | Export the retrieval surface |
| `packages/gateway/src/types.ts` | `ChatInput.cachePrompt` |
| `packages/gateway/src/anthropic.gateway.ts` | Honour it |
| `apps/api/src/modules/chat/prompt.ts` | Drop the `id` attribute; rewrite the doc comment |
| `apps/api/src/modules/chat/chat.service.ts` | `ChatDeps.embedder`, the selection, `cachePrompt`, honest `citedFactIds` |
| `apps/api/src/modules/chat/chat.service.test.ts` | 23 deps literals; the truncate list |
| `apps/api/src/modules/chat/chat.routes.ts` | Build an embedder at registration |
| `apps/api/src/modules/facts/fact.service.ts` | Re-embed on edit |
| `apps/api/src/modules/facts/fact.routes.ts` | Pass one in |
| `apps/api/src/app.ts` | `AppOverrides.facts` |
| `apps/workers/src/ingestion/extract.service.ts` | Embed after facts are written |
| `apps/workers/src/ingestion/ingestion.worker.ts`, `src/main.ts` | Build one, thread it through |
| `packages/goldens/src/fixtures.ts` | `GoldenFact.question` |
| `packages/goldens/src/run.ts` | Embed at seed; delete `QuestionEmbedding` at teardown |
| `packages/goldens/src/fixtures.real.test.ts` | The catalog page is big enough to retrieve |
| `.env.example`, `devDocs/BACKEND.md`, `devDocs/README.md`, `devDocs/OPERATIONS.md` | Documents corrected |

---

### Task 1: `packages/embeddings`

**Files:**
- Create: `packages/embeddings/package.json`
- Create: `packages/embeddings/tsconfig.json`
- Create: `packages/embeddings/vitest.config.ts`
- Create: `packages/embeddings/src/types.ts`
- Create: `packages/embeddings/src/vector.ts`
- Create: `packages/embeddings/src/openai.embedder.ts`
- Create: `packages/embeddings/src/index.ts`
- Test: `packages/embeddings/src/vector.test.ts`
- Test: `packages/embeddings/src/openai.embedder.test.ts`

**Interfaces:**
- Consumes: nothing. This is the bottom of the stack.
- Produces:
  - `interface Embedder { readonly model: string; readonly dims: number; embed(texts: string[]): Promise<Float32Array[]> }`
  - `createOpenAiEmbedder(apiKey: string, options?: { timeoutMs?: number; fetchImpl?: typeof fetch }): Embedder`
  - `encodeVector(values: Float32Array | readonly number[]): Uint8Array`
  - `decodeVector(bytes: Uint8Array, dims: number): Float32Array`
  - `EMBEDDING_MODEL`, `EMBEDDING_DIMS`, `EMBEDDING_TIMEOUT_MS`, `EMBEDDING_BATCH_TIMEOUT_MS`, `EMBED_BATCH`

**Context you need:**

`packages/gateway` is the template — same `package.json` shape, same `tsconfig.json`, same `vitest.config.ts`. Copy their structure rather than inventing one.

Prisma 6 maps `Bytes` to `Uint8Array`, **not** `Buffer` (this changed in Prisma 6). Every signature here says `Uint8Array`. Writing `Buffer` will typecheck inside this package and fail at the call site in Task 4.

No OpenAI SDK. One endpoint, one request shape, one response shape — `fetch` is twenty lines, has a first-class timeout through `AbortSignal.timeout`, and is testable by passing a fake `fetch` rather than intercepting a client. This is the only non-Anthropic provider in the codebase and it exists because Anthropic has no embeddings endpoint.

The API, confirmed against OpenAI's current reference:

```
POST https://api.openai.com/v1/embeddings
Authorization: Bearer <key>
Content-Type: application/json

{ "model": "text-embedding-3-small", "input": ["text one", "text two"], "dimensions": 512, "encoding_format": "float" }

200 → { "object": "list",
        "data": [ { "object": "embedding", "index": 0, "embedding": [0.01, -0.02, ...] } ],
        "model": "text-embedding-3-small",
        "usage": { "prompt_tokens": 9, "total_tokens": 9 } }
```

Limits that matter: at most 2,048 items in `input`, at most 8,192 tokens per item, at most 300,000 tokens across the request. `EMBED_BATCH` is 200, well inside all three. `data` is documented as carrying an `index`, and it is **not** guaranteed to arrive in request order — sort by `index` before returning, or a page's facts get each other's vectors and nothing in the test suite would notice.

- [ ] **Step 1: Create the package skeleton**

`packages/embeddings/package.json`:

```json
{
  "name": "@curios/embeddings",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "lint": "eslint .", "typecheck": "tsc --noEmit", "test": "vitest run" },
  "devDependencies": { "@types/node": "^22.10.2", "typescript": "^5.7.3", "vitest": "^2.1.8" }
}
```

`packages/embeddings/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "./src", "noEmit": true },
  "include": ["src/**/*"]
}
```

`packages/embeddings/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { setupFiles: ['../../vitest.setup.ts'] },
});
```

Then, from the repo root: `pnpm install`

- [ ] **Step 2: Write the failing vector tests**

`packages/embeddings/src/vector.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeVector, encodeVector } from './vector.js';

describe('encodeVector / decodeVector', () => {
  it('round-trips a vector through bytes', () => {
    const original = Float32Array.from([0.5, -0.25, 0, 1]);
    const decoded = decodeVector(encodeVector(original), 4);
    expect(Array.from(decoded)).toEqual([0.5, -0.25, 0, 1]);
  });

  it('writes four bytes per dimension', () => {
    expect(encodeVector([1, 2, 3]).byteLength).toBe(12);
  });

  // Little-endian explicitly, not "whatever this machine does". These bytes
  // outlive the process that wrote them and may be read by another machine.
  it('writes little-endian', () => {
    // 1.0 as IEEE-754 single precision is 0x3F800000; little-endian puts the
    // low byte first.
    expect(Array.from(encodeVector([1]))).toEqual([0x00, 0x00, 0x80, 0x3f]);
  });

  // The bug this guards is the reason decodeVector takes byteOffset into
  // account: Node allocates small Buffers as views into a shared pool, so
  // `bytes.buffer` is the whole pool and a decode that ignores byteOffset
  // reads somebody else's memory. Simulated here with a deliberate view.
  it('decodes a view that does not start at byte zero', () => {
    const pool = new Uint8Array(64);
    const view = new Uint8Array(pool.buffer, 16, 8);
    view.set(encodeVector([2.5, -2.5]));
    expect(Array.from(decodeVector(view, 2))).toEqual([2.5, -2.5]);
  });

  it('refuses bytes whose length does not match the dimensions', () => {
    expect(() => decodeVector(encodeVector([1, 2, 3]), 4)).toThrow(/12 bytes/);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @curios/embeddings test`
Expected: FAIL — `Failed to resolve import "./vector.js"`.

- [ ] **Step 4: Write `vector.ts`**

```ts
/**
 * A vector on its way to Postgres and back.
 *
 * `Bytes` rather than a float array column or an extension type: this is a
 * blob we never query on, only read whole, and Prisma maps `Bytes` to
 * `Uint8Array` on Prisma 6 (it was `Buffer` before 6.0 -- every signature
 * here says `Uint8Array` deliberately).
 *
 * Little-endian is written explicitly through a DataView rather than by
 * handing a `Float32Array` its own buffer, which would use whatever the host
 * CPU happens to do. These bytes outlive the process that wrote them, and a
 * vector read back byte-swapped does not fail -- it silently scores every
 * fact as unrelated, which reads as "retrieval just is not very good".
 */
export function encodeVector(values: Float32Array | readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i += 1) {
    // `?? 0` is unreachable -- i is always in range -- but
    // noUncheckedIndexedAccess types the read as possibly undefined.
    view.setFloat32(i * 4, values[i] ?? 0, true);
  }
  return bytes;
}

/**
 * `byteOffset` and `byteLength` are passed to the DataView deliberately.
 *
 * Node allocates small Buffers as views into one shared pool, so `bytes.buffer`
 * is usually far larger than the vector and does not begin at it. A decode
 * that reads `bytes.buffer` alone returns whatever else happens to be in that
 * pool -- a bug that produces plausible-looking numbers and no error at all.
 */
export function decodeVector(bytes: Uint8Array, dims: number): Float32Array {
  const expected = dims * 4;
  if (bytes.byteLength !== expected) {
    throw new Error(`Expected ${expected} bytes for ${dims} dimensions, got ${bytes.byteLength}.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float32Array(dims);
  for (let i = 0; i < dims; i += 1) values[i] = view.getFloat32(i * 4, true);
  return values;
}
```

- [ ] **Step 5: Run them and watch them pass**

Run: `pnpm --filter @curios/embeddings test`
Expected: PASS, 5 tests.

- [ ] **Step 6: Prove each vector test by mutation**

One at a time: apply, run, confirm the named test goes red, revert.

| Mutation | Test that must go red |
|---|---|
| `setFloat32(i * 4, ..., true)` → `false` | `writes little-endian` |
| `new Uint8Array(values.length * 4)` → `* 2` | `writes four bytes per dimension` |
| `new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)` → `new DataView(bytes.buffer)` | `decodes a view that does not start at byte zero` |
| delete the `byteLength !== expected` throw | `refuses bytes whose length does not match` |
| `getFloat32(i * 4, true)` → `getFloat32(i * 4)` | `round-trips a vector through bytes` |

- [ ] **Step 7: Write the failing embedder tests**

`packages/embeddings/src/openai.embedder.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createOpenAiEmbedder, EMBEDDING_DIMS, EMBEDDING_MODEL } from './openai.embedder.js';

function vector(fill: number): number[] {
  return Array.from({ length: EMBEDDING_DIMS }, () => fill);
}

/** A fetch that answers with `data` in whatever order the test wants. */
function fetchReturning(data: { index: number; embedding: number[] }[]) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        object: 'list',
        model: EMBEDDING_MODEL,
        data: data.map((d) => ({ object: 'embedding', ...d })),
        usage: { prompt_tokens: 9, total_tokens: 9 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}

describe('createOpenAiEmbedder', () => {
  it('asks for the model and dimensions this product stores', async () => {
    const fetchImpl = fetchReturning([{ index: 0, embedding: vector(0.1) }]);
    const embedder = createOpenAiEmbedder('k', { fetchImpl: fetchImpl as unknown as typeof fetch });

    await embedder.embed(['berapa harga']);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect(JSON.parse(String(init.body))).toEqual({
      model: EMBEDDING_MODEL,
      input: ['berapa harga'],
      dimensions: EMBEDDING_DIMS,
      encoding_format: 'float',
    });
  });

  it('sends the key as a bearer token', async () => {
    const fetchImpl = fetchReturning([{ index: 0, embedding: vector(0.1) }]);
    const embedder = createOpenAiEmbedder('sekret', { fetchImpl: fetchImpl as unknown as typeof fetch });

    await embedder.embed(['a']);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sekret');
  });

  // The response is documented as carrying an index, not as arriving in
  // order. Out of order and unsorted, every fact on a page gets another
  // fact's vector -- and nothing downstream can tell, because the numbers
  // are all still plausible vectors.
  it('returns vectors in request order, not response order', async () => {
    const fetchImpl = fetchReturning([
      { index: 1, embedding: vector(0.2) },
      { index: 0, embedding: vector(0.1) },
    ]);
    const embedder = createOpenAiEmbedder('k', { fetchImpl: fetchImpl as unknown as typeof fetch });

    const [first, second] = await embedder.embed(['first', 'second']);

    expect(first?.[0]).toBeCloseTo(0.1);
    expect(second?.[0]).toBeCloseTo(0.2);
  });

  it('throws when the provider answers with fewer vectors than texts', async () => {
    const fetchImpl = fetchReturning([{ index: 0, embedding: vector(0.1) }]);
    const embedder = createOpenAiEmbedder('k', { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(embedder.embed(['one', 'two'])).rejects.toThrow(/2 vectors/);
  });

  it('throws when a vector is not the width this product stores', async () => {
    const fetchImpl = fetchReturning([{ index: 0, embedding: [0.1, 0.2] }]);
    const embedder = createOpenAiEmbedder('k', { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(embedder.embed(['one'])).rejects.toThrow(/512/);
  });

  it('throws on a non-200, naming the status', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 429 }));
    const embedder = createOpenAiEmbedder('k', { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(embedder.embed(['one'])).rejects.toThrow(/429/);
  });

  // Nothing is sent, and no error is raised: an empty batch is a normal
  // state (a page where every fact already has a current vector) and paying
  // for a round trip to learn that would be silly.
  it('makes no call for an empty list', async () => {
    const fetchImpl = fetchReturning([]);
    const embedder = createOpenAiEmbedder('k', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await embedder.embed([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('gives up after the timeout it was built with', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      }),
    );
    const embedder = createOpenAiEmbedder('k', {
      timeoutMs: 20,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(embedder.embed(['slow'])).rejects.toThrow();
  });

  it('reports the model and dimensions it writes, so a stored row can be checked against them', () => {
    const embedder = createOpenAiEmbedder('k');
    expect(embedder.model).toBe(EMBEDDING_MODEL);
    expect(embedder.dims).toBe(EMBEDDING_DIMS);
  });
});
```

- [ ] **Step 8: Run them and watch them fail**

Run: `pnpm --filter @curios/embeddings test`
Expected: FAIL — `Failed to resolve import "./openai.embedder.js"`.

- [ ] **Step 9: Write `types.ts`, `openai.embedder.ts` and `index.ts`**

`packages/embeddings/src/types.ts`:

```ts
/**
 * The seam. Tests stub this interface, never `fetch` -- mocking the wire
 * format couples a test to OpenAI's response shape instead of our own, which
 * is the same argument `packages/gateway` makes for `Gateway`.
 *
 * `model` and `dims` are on the interface rather than imported as constants
 * by every caller, because what matters at each call site is what THIS
 * embedder writes: a stored row is only usable by an embedder that agrees
 * with it, and the comparison should be against the object doing the work.
 */
export interface Embedder {
  readonly model: string;
  readonly dims: number;
  /**
   * One vector per text, in the order the texts were given. Rejects rather
   * than returning a short or mis-ordered array -- every caller treats a
   * rejection as "fall back", and none of them can detect a wrong vector.
   */
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

`packages/embeddings/src/openai.embedder.ts`:

```ts
import type { Embedder } from './types.js';

/**
 * The embedding model, by name, and stored on every row it writes.
 *
 * A change here must change the stored `model` value too, which is what makes
 * the switch safe: the chat path only reads vectors whose model and width
 * match the embedder it holds, so the day this constant changes every page
 * falls back to sending every fact until a backfill catches up. Slow and
 * expensive, never wrong.
 */
export const EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * 512 of the model's native 1,536.
 *
 * The API shortens and re-normalises server-side, so this is not a truncation
 * we have to correct for. Every question scores against every vector on the
 * page, so width is read work on the hot path: 512 floats is 2KB a fact, and
 * a 120-fact page is a quarter of a megabyte a question -- a few milliseconds
 * against a local Postgres, and a third of what the full width would cost.
 */
export const EMBEDDING_DIMS = 512;

/**
 * The visitor path's timeout. A visitor is watching a blank bubble, and an
 * answer built from every fact is a correct answer -- waiting longer than
 * this to make it a cheaper one is the wrong trade.
 */
export const EMBEDDING_TIMEOUT_MS = 1000;

/** Batches: the worker and the backfill, where nobody is waiting. */
export const EMBEDDING_BATCH_TIMEOUT_MS = 30_000;

/**
 * Texts per request. The endpoint allows 2,048 and 300,000 tokens across the
 * request; 200 short claims is nowhere near either, and keeps one failed
 * request from costing a whole large page.
 */
export const EMBED_BATCH = 200;

const ENDPOINT = 'https://api.openai.com/v1/embeddings';

interface EmbeddingResponse {
  data?: { index?: number; embedding?: number[] }[];
}

/**
 * `fetch`, not the OpenAI SDK.
 *
 * One endpoint, one request shape, one response shape. The SDK would add a
 * dependency and an abstraction over twenty lines, and `AbortSignal.timeout`
 * is the clean way to hold the visitor path to a deadline. `fetchImpl` is the
 * test seam; production never passes it.
 *
 * There are no retries, deliberately. Every caller's failure path is "send
 * every fact", which is correct and already built -- a retry would double a
 * visitor's wait to save a fraction of a sen.
 */
export function createOpenAiEmbedder(
  apiKey: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Embedder {
  const timeoutMs = options.timeoutMs ?? EMBEDDING_TIMEOUT_MS;
  const call = options.fetchImpl ?? fetch;

  return {
    model: EMBEDDING_MODEL,
    dims: EMBEDDING_DIMS,

    async embed(texts: string[]): Promise<Float32Array[]> {
      // A page where every fact already carries a current vector asks for
      // nothing, and a round trip to be told so costs real time on the
      // visitor path.
      if (texts.length === 0) return [];

      const response = await call(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: texts,
          dimensions: EMBEDDING_DIMS,
          encoding_format: 'float',
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        // The body is not read: it may carry the key back in an error echo,
        // and this message reaches logs. The status is what a reader needs.
        throw new Error(`The embeddings provider answered ${response.status}.`);
      }

      const body = (await response.json()) as EmbeddingResponse;
      const data = body.data ?? [];
      if (data.length !== texts.length) {
        throw new Error(
          `Asked for ${texts.length} vectors and got ${data.length}. Nothing is embedded.`,
        );
      }

      // Placed by `index`, never by arrival order. The response is documented
      // to carry the index and not to preserve order, and a silently
      // shuffled batch gives every fact on a page somebody else's vector --
      // wrong answers that look exactly like a model that is bad at Malay.
      const vectors = new Array<Float32Array | undefined>(texts.length);
      for (const item of data) {
        const index = item.index;
        const embedding = item.embedding;
        if (index === undefined || embedding === undefined || index >= texts.length) {
          throw new Error('The embeddings provider answered with an unusable entry.');
        }
        if (embedding.length !== EMBEDDING_DIMS) {
          throw new Error(
            `Expected ${EMBEDDING_DIMS} dimensions and got ${embedding.length}.`,
          );
        }
        vectors[index] = Float32Array.from(embedding);
      }

      return vectors.map((vector, index) => {
        if (vector === undefined) {
          throw new Error(`The embeddings provider skipped text ${index}.`);
        }
        return vector;
      });
    },
  };
}
```

`packages/embeddings/src/index.ts`:

```ts
export type { Embedder } from './types.js';
export { decodeVector, encodeVector } from './vector.js';
export {
  createOpenAiEmbedder,
  EMBED_BATCH,
  EMBEDDING_BATCH_TIMEOUT_MS,
  EMBEDDING_DIMS,
  EMBEDDING_MODEL,
  EMBEDDING_TIMEOUT_MS,
} from './openai.embedder.js';
```

- [ ] **Step 10: Run them and watch them pass**

Run: `pnpm --filter @curios/embeddings test`
Expected: PASS, 14 tests.

- [ ] **Step 11: Prove each embedder test by mutation**

| Mutation | Test that must go red |
|---|---|
| drop `dimensions` from the request body | `asks for the model and dimensions this product stores` |
| `Bearer ${apiKey}` → `${apiKey}` | `sends the key as a bearer token` |
| place by arrival: `data.map((d) => Float32Array.from(d.embedding!))` | `returns vectors in request order, not response order` |
| delete the `data.length !== texts.length` throw | `throws when the provider answers with fewer vectors than texts` |
| delete the `embedding.length !== EMBEDDING_DIMS` throw | `throws when a vector is not the width this product stores` |
| delete the `!response.ok` throw | `throws on a non-200, naming the status` |
| delete the `texts.length === 0` short circuit | `makes no call for an empty list` |
| drop `signal` from the request | `gives up after the timeout it was built with` |

- [ ] **Step 12: Check that this model understands Malay, before anything is built on it**

This is a real risk and it is cheapest to find out now: OpenAI does not publish Malay retrieval quality for this model. The check costs about one hundredth of a sen.

Write a throwaway script — **do not commit it** — that embeds these pairs and prints the cosine of each against the first:

```
Q  berapa harga kek butter 1kg
A1 Kek butter 1kg RM95, tempahan tiga hari awal.          (the right answer, same language)
A2 A 1kg butter cake is RM95 and needs three days notice. (the right answer, other language)
A3 Buka Isnin hingga Sabtu, 9 pagi hingga 6 petang.       (a wrong answer, same language)
A4 We are closed on Sundays and public holidays.          (a wrong answer, other language)
```

Run it with `pnpm exec tsx <path>` from the repo root, against a file in your scratchpad directory, reading `OPENAI_API_KEY` from the environment.

**Report all four numbers in your task report.** What they need to show: A1 and A2 both clearly above `RETRIEVAL_FLOOR` (0.35), and both clearly above A3 and A4. If cross-language scoring (A2) is at or below the wrong answers, say so loudly — Task 7 rests on it and the fixture in Task 8 is built to test exactly that. It is a finding to report, not a reason to change anything in this task.

- [ ] **Step 13: Run the gates and commit**

```bash
pnpm turbo run test --concurrency=1 --force
pnpm turbo run typecheck --concurrency=1 --force
pnpm turbo run lint --concurrency=1 --force
```

All three must report **11 successful, 11 total**. If they say 10, `pnpm install` did not pick the package up.

```bash
git add packages/embeddings pnpm-lock.yaml
git commit -m "feat(embeddings): an embedder behind one interface, and vectors as bytes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: the two tables

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (the `Fact` model at line 147, and two new models)
- Create: `packages/db/prisma/migrations/<stamp>_fact_embedding/migration.sql`
- Modify: `packages/db/package.json` (dependency on `@curios/embeddings`)
- Test: `packages/db/src/schema.test.ts` (add cases)

**Interfaces:**
- Consumes: `EMBEDDING_DIMS`, `EMBEDDING_MODEL` from `@curios/embeddings` (tests only).
- Produces: `prisma.factEmbedding`, `prisma.questionEmbedding`, and `Fact.embedding` as a nullable relation that later tasks filter on.

**Context you need:**

`QuestionEmbedding` is keyed by a **hash**, not by the question text. Two reasons, both load-bearing. The text can be up to 1,000 characters here (a follow-up embeds the previous turn with the question), and Postgres' btree index refuses a key over about 2,700 bytes — a long Malay follow-up would throw on write, in production, on a visitor's question. And a global table of every question asked on every page in the product is a privacy liability nobody asked for; a 64-character hex digest is not.

- [ ] **Step 1: Add the models to `schema.prisma`**

Add to the `Fact` model, after `createdAt` (keep the existing `@@unique` and `@@index` lines where they are):

```prisma
  embedding       FactEmbedding?
```

Add after the `Fact` model:

```prisma
/// One vector per fact, written by syncFactEmbeddings and read per question.
///
/// Its own table rather than columns on Fact, so re-embedding never rewrites
/// a fact row and no ordinary read of a fact drags two kilobytes of vector
/// along with it. `model` and `dims` are stored on every row because a vector
/// is only meaningful to the embedder that produced it: the chat path reads
/// only rows matching the embedder it holds, so a model change puts pages in
/// fallback rather than scoring against vectors from two different spaces.
model FactEmbedding {
  factId    String   @id
  fact      Fact     @relation(fields: [factId], references: [id], onDelete: Cascade)
  vector    Bytes
  model     String
  dims      Int
  createdAt DateTime @default(now())
}

/// The vector for a question somebody already asked, anywhere in the product.
///
/// Question text is page-independent, so one row serves every page ever asked
/// the same thing. It is a cache of a pure function and needs no invalidation:
/// a row whose model or width does not match the current embedder is ignored
/// and overwritten.
///
/// Keyed by a SHA-256 of the normalised text, never by the text. A follow-up
/// embeds the previous turn together with the question, which can exceed
/// Postgres' ~2,700-byte btree key limit and would throw on a visitor's
/// question in production. The hash is also why this table cannot become a
/// log of what every visitor in the product has ever asked.
///
/// It has no foreign key to anything, so `TRUNCATE "Account" CASCADE` does not
/// clear it. Anything that writes rows here in a test or a harness removes them
/// itself.
model QuestionEmbedding {
  key       String   @id
  vector    Bytes
  model     String
  dims      Int
  createdAt DateTime @default(now())
}
```

- [ ] **Step 2: Generate the migration without applying it**

```bash
pnpm --filter @curios/db exec prisma migrate dev --name fact_embedding --create-only
```

`--create-only` writes the SQL and stops. If Prisma offers to reset anything, **stop and report BLOCKED**.

Read the generated `migration.sql`. It must contain two `CREATE TABLE` statements and one `ADD CONSTRAINT ... FOREIGN KEY ("factId") REFERENCES "Fact"("id") ON DELETE CASCADE`, and **nothing else** — no `DROP`, no `ALTER TABLE ... DROP COLUMN`. If it contains anything destructive, stop and report BLOCKED: it means the schema and the database had drifted before this task started.

- [ ] **Step 3: Apply it to both databases**

```bash
pnpm --filter @curios/db exec prisma migrate deploy
DATABASE_URL="$(grep '^DATABASE_URL_TEST=' .env | cut -d= -f2-)" pnpm --filter @curios/db exec prisma migrate deploy
pnpm --filter @curios/db exec prisma generate
```

`migrate deploy` only applies pending migrations and never resets. If `prisma generate` fails with `EPERM`, report **BLOCKED** — the owner has a process holding the client open.

- [ ] **Step 4: Add the dependency**

`packages/db/package.json`, in `dependencies`, alongside `@curios/gateway`:

```json
    "@curios/embeddings": "workspace:*",
```

Then `pnpm install` from the repo root.

- [ ] **Step 5: Write the failing schema tests**

Append to `packages/db/src/schema.test.ts`, matching the file's existing style for creating an account and page:

```ts
describe('FactEmbedding', () => {
  it('is deleted with the fact it belongs to', async () => {
    const page = await seedPage();
    const fact = await prisma.fact.create({
      data: {
        pageId: page.id,
        category: 'PRICE',
        claim: 'Kek butter 1kg RM95.',
        normalizedClaim: 'kek butter 1kg rm95',
        confidence: 1,
      },
    });
    await prisma.factEmbedding.create({
      data: { factId: fact.id, vector: new Uint8Array(4), model: 'm', dims: 1 },
    });

    await prisma.fact.delete({ where: { id: fact.id } });

    expect(await prisma.factEmbedding.count({ where: { factId: fact.id } })).toBe(0);
  });

  it('holds one row per fact', async () => {
    const page = await seedPage();
    const fact = await prisma.fact.create({
      data: {
        pageId: page.id,
        category: 'PRICE',
        claim: 'Kek coklat 1kg RM85.',
        normalizedClaim: 'kek coklat 1kg rm85',
        confidence: 1,
      },
    });
    await prisma.factEmbedding.create({
      data: { factId: fact.id, vector: new Uint8Array(4), model: 'm', dims: 1 },
    });

    await expect(
      prisma.factEmbedding.create({
        data: { factId: fact.id, vector: new Uint8Array(4), model: 'm', dims: 1 },
      }),
    ).rejects.toThrow();
  });

  it('returns the bytes it was given, unchanged', async () => {
    const page = await seedPage();
    const fact = await prisma.fact.create({
      data: {
        pageId: page.id,
        category: 'PRICE',
        claim: 'Bunting RM85.',
        normalizedClaim: 'bunting rm85',
        confidence: 1,
      },
    });
    const vector = encodeVector([0.5, -0.25]);
    await prisma.factEmbedding.create({
      data: { factId: fact.id, vector, model: EMBEDDING_MODEL, dims: 2 },
    });

    const row = await prisma.factEmbedding.findUniqueOrThrow({ where: { factId: fact.id } });
    expect(Array.from(decodeVector(row.vector, 2))).toEqual([0.5, -0.25]);
  });
});

describe('QuestionEmbedding', () => {
  // The constraint this proves is the reason every harness and test that
  // causes a row here must delete it by hand.
  it('survives TRUNCATE "Account" CASCADE, because it hangs off nothing', async () => {
    await prisma.questionEmbedding.create({
      data: { key: 'a'.repeat(64), vector: new Uint8Array(4), model: 'm', dims: 1 },
    });

    await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');

    expect(await prisma.questionEmbedding.count({ where: { key: 'a'.repeat(64) } })).toBe(1);
    await prisma.questionEmbedding.deleteMany({ where: { key: 'a'.repeat(64) } });
  });
});
```

Add the imports this needs at the top of the file:

```ts
import { decodeVector, encodeVector, EMBEDDING_MODEL } from '@curios/embeddings';
```

If `schema.test.ts` has no `seedPage` helper, write one at the top of your new describes that creates an account with one page, following whatever that file already does — do not restructure the existing tests around a new helper.

- [ ] **Step 6: Run them**

Run: `pnpm --filter @curios/db test`
Expected: PASS. These assert schema behaviour that Step 1–3 just created, so they pass immediately — the failing-first step for them is Step 2, where `prisma.factEmbedding` did not exist and the file would not typecheck.

Confirm that by checking out the schema without the models (`git stash`, run, `git stash pop`) if you want the red — but do not leave the database migrated against a stashed schema.

- [ ] **Step 7: Prove them by mutation**

| Mutation | Test that must go red |
|---|---|
| `onDelete: Cascade` → `onDelete: Restrict` on `FactEmbedding.fact`, regenerate and re-apply | `is deleted with the fact it belongs to` |
| `factId String @id` → `factId String` plus `id String @id @default(cuid())` | `holds one row per fact` |

The two schema mutations need `prisma generate` and a migration to take effect; apply them with `prisma db push` against `DATABASE_URL_TEST` only, then `prisma migrate deploy` to restore. If that proves awkward, say so in your report and prove the cascade by reading the generated `migration.sql` instead — the `ON DELETE CASCADE` clause is the assertion.

- [ ] **Step 8: Run the gates and commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): FactEmbedding and QuestionEmbedding

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: the selection, as a pure function

**Files:**
- Create: `packages/core/src/retrieval.ts`
- Test: `packages/core/src/retrieval.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RETRIEVAL_MIN_FACTS`, `RETRIEVAL_FLOOR`, `FACT_BUDGET_CHARS`
  - `cosineSimilarity(a: Float32Array, b: Float32Array): number`
  - `type FallbackReason = 'below-minimum' | 'missing-vectors' | 'below-floor'`
  - `interface Selection<T> { mode: 'retrieved' | 'fallback'; reason: FallbackReason | null; facts: T[]; bestScore: number | null }`
  - `selectFacts<T extends { id: string; claim: string }>(input: { facts: T[]; vectors: ReadonlyMap<string, Float32Array>; question: Float32Array; minFacts?: number; floor?: number; budgetChars?: number }): Selection<T>`

**Context you need:**

`@curios/core` is where the rules the product is made of live — `qualifies`, `isOverCap`, `shouldIndex`, `conversationCap`. This belongs beside them and must stay pure: no Prisma, no embedder, no clock.

`selection.facts` is **always what to send**. In fallback it is every fact that came in. One field, one code path at the call site, no way for a caller to forget the fallback.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/retrieval.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  FACT_BUDGET_CHARS,
  RETRIEVAL_FLOOR,
  RETRIEVAL_MIN_FACTS,
  selectFacts,
} from './retrieval.js';

/** A unit vector pointing at one axis, so scores are exactly 1 or 0. */
function axis(index: number, dims = 8): Float32Array {
  const vector = new Float32Array(dims);
  vector[index] = 1;
  return vector;
}

/** A vector between two axes, so a score can sit at a chosen height. */
function between(a: number, b: number, weight: number, dims = 8): Float32Array {
  const vector = new Float32Array(dims);
  vector[a] = weight;
  vector[b] = 1 - weight;
  return vector;
}

/** `count` facts, each scoring against `axis(index)` by construction. */
function page(count: number, claim = 'x'.repeat(100)) {
  return Array.from({ length: count }, (_unused, index) => ({ id: `f${index}`, claim }));
}

function vectorsFor(facts: { id: string }[], make: (index: number) => Float32Array) {
  return new Map(facts.map((fact, index) => [fact.id, make(index)]));
}

describe('cosineSimilarity', () => {
  it('is 1 for the same direction', () => {
    expect(cosineSimilarity(axis(0), axis(0))).toBeCloseTo(1);
  });

  it('is 0 for perpendicular vectors', () => {
    expect(cosineSimilarity(axis(0), axis(1))).toBeCloseTo(0);
  });

  it('ignores magnitude', () => {
    const long = Float32Array.from(axis(0), (value) => value * 17);
    expect(cosineSimilarity(long, axis(0))).toBeCloseTo(1);
  });

  // Not NaN. A NaN score compares false against the floor, so a zero vector
  // would quietly read as "no good match" instead of as the bug it is.
  it('is 0 against a zero vector, never NaN', () => {
    expect(cosineSimilarity(new Float32Array(8), axis(0))).toBe(0);
  });

  it('refuses vectors of different widths', () => {
    expect(() => cosineSimilarity(new Float32Array(4), new Float32Array(8))).toThrow(/width/i);
  });
});

describe('selectFacts', () => {
  it('falls back on a page with fewer than the minimum facts', () => {
    const facts = page(RETRIEVAL_MIN_FACTS - 1);
    const result = selectFacts({
      facts,
      vectors: vectorsFor(facts, axis),
      question: axis(0),
    });

    expect(result.mode).toBe('fallback');
    expect(result.reason).toBe('below-minimum');
    expect(result.facts).toHaveLength(RETRIEVAL_MIN_FACTS - 1);
  });

  it('retrieves on a page with exactly the minimum facts', () => {
    const facts = page(RETRIEVAL_MIN_FACTS);
    const result = selectFacts({
      facts,
      vectors: vectorsFor(facts, (index) => axis(index % 8)),
      question: axis(0),
    });

    expect(result.mode).toBe('retrieved');
  });

  it('falls back when one fact has no vector', () => {
    const facts = page(RETRIEVAL_MIN_FACTS);
    const vectors = vectorsFor(facts, (index) => axis(index % 8));
    vectors.delete('f7');

    const result = selectFacts({ facts, vectors, question: axis(0) });

    expect(result.mode).toBe('fallback');
    expect(result.reason).toBe('missing-vectors');
    expect(result.facts).toEqual(facts);
  });

  it('falls back when the best score is below the floor', () => {
    const facts = page(RETRIEVAL_MIN_FACTS);
    const result = selectFacts({
      // Every fact perpendicular to the question: the best score is 0.
      facts,
      vectors: vectorsFor(facts, () => axis(1)),
      question: axis(0),
    });

    expect(result.mode).toBe('fallback');
    expect(result.reason).toBe('below-floor');
    expect(result.bestScore).toBeCloseTo(0);
  });

  it('retrieves when the best score is exactly the floor', () => {
    const facts = page(RETRIEVAL_MIN_FACTS);
    const vectors = vectorsFor(facts, () => axis(1));
    // One fact placed so its cosine against axis(0) is exactly the floor.
    vectors.set('f0', Float32Array.from([RETRIEVAL_FLOOR, Math.sqrt(1 - RETRIEVAL_FLOOR ** 2), 0, 0, 0, 0, 0, 0]));

    const result = selectFacts({ facts, vectors, question: axis(0) });

    expect(result.mode).toBe('retrieved');
  });

  it('returns facts in score order, best first', () => {
    const facts = page(RETRIEVAL_MIN_FACTS);
    const vectors = vectorsFor(facts, () => axis(1));
    vectors.set('f3', axis(0));
    vectors.set('f9', between(0, 1, 0.9));

    const result = selectFacts({ facts, vectors, question: axis(0) });

    expect(result.facts[0]?.id).toBe('f3');
    expect(result.facts[1]?.id).toBe('f9');
  });

  it('stops at the character budget rather than sending the page', () => {
    // 40 facts of 200 characters is 8,000 -- twice the budget.
    const facts = page(40, 'x'.repeat(200));
    const result = selectFacts({
      facts,
      vectors: vectorsFor(facts, (index) => between(0, 1, 1 - index / 100)),
      question: axis(0),
    });

    expect(result.mode).toBe('retrieved');
    expect(result.facts.length).toBeLessThan(facts.length);
    const chars = result.facts.reduce((total, fact) => total + fact.claim.length, 0);
    expect(chars).toBeLessThanOrEqual(FACT_BUDGET_CHARS);
  });

  // The set is always the top N by score. Skipping over a fact that does not
  // fit and taking a lower-scoring shorter one puts a worse answer in front
  // of a visitor to save a few characters.
  it('ends the selection at the first fact that would overflow, never skipping past it', () => {
    const facts = [
      { id: 'best', claim: 'x'.repeat(3900) },
      { id: 'second', claim: 'x'.repeat(300) },
      { id: 'third', claim: 'x'.repeat(10) },
      ...page(RETRIEVAL_MIN_FACTS, 'x'.repeat(10)),
    ];
    const vectors = new Map<string, Float32Array>([
      ['best', axis(0)],
      ['second', between(0, 1, 0.9)],
      ['third', between(0, 1, 0.8)],
      ...page(RETRIEVAL_MIN_FACTS).map(
        (fact) => [fact.id, axis(1)] as [string, Float32Array],
      ),
    ]);

    const result = selectFacts({ facts, vectors, question: axis(0) });

    expect(result.facts.map((fact) => fact.id)).toEqual(['best']);
  });

  // Nothing at all is worse than one long fact: the question matched it above
  // the floor, and a prompt with no facts in it can only refuse.
  it('always sends the best fact, even when it alone exceeds the budget', () => {
    const facts = [
      { id: 'huge', claim: 'x'.repeat(FACT_BUDGET_CHARS + 500) },
      ...page(RETRIEVAL_MIN_FACTS, 'x'.repeat(10)),
    ];
    const vectors = new Map<string, Float32Array>([
      ['huge', axis(0)],
      ...page(RETRIEVAL_MIN_FACTS).map(
        (fact) => [fact.id, axis(1)] as [string, Float32Array],
      ),
    ]);

    const result = selectFacts({ facts, vectors, question: axis(0) });

    expect(result.facts.map((fact) => fact.id)).toEqual(['huge']);
  });

  it('reports the best score it saw, for logging', () => {
    const facts = page(RETRIEVAL_MIN_FACTS);
    const vectors = vectorsFor(facts, () => axis(1));
    vectors.set('f2', axis(0));

    expect(selectFacts({ facts, vectors, question: axis(0) }).bestScore).toBeCloseTo(1);
  });

  it('takes an overridden floor and budget, so the golden set can tune them', () => {
    const facts = page(RETRIEVAL_MIN_FACTS, 'x'.repeat(100));
    const vectors = vectorsFor(facts, (index) => between(0, 1, 1 - index / 100));

    const tight = selectFacts({ facts, vectors, question: axis(0), budgetChars: 250 });
    expect(tight.facts).toHaveLength(2);

    const strict = selectFacts({ facts, vectors, question: axis(0), floor: 0.999 });
    expect(strict.mode).toBe('fallback');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @curios/core test`
Expected: FAIL — `Failed to resolve import "./retrieval.js"`.

- [ ] **Step 3: Write `retrieval.ts`**

```ts
/**
 * Which facts a question needs.
 *
 * Pure, and here rather than in the chat module, for the same reason
 * `isOverCap` and `qualifies` are here: it is a rule the product is made of,
 * it is the rule most likely to be tuned, and a rule with a database
 * connection in it cannot be tested at the twenty cases it deserves.
 *
 * Every path returns facts to send. In fallback that is the whole list, which
 * is exactly what the product did before this slice -- so a caller that
 * ignores `mode` is still correct, only expensive.
 */

/**
 * Below this many verified facts, a page never retrieves.
 *
 * There is nothing to save on a small page -- twenty facts is under a
 * thousand tokens -- and no reason to carry the risk of dropping the one that
 * mattered. Every personal page lands here, and so do the three fixture pages
 * the golden set has had since slice 11.
 */
export const RETRIEVAL_MIN_FACTS = 25;

/**
 * Below this cosine, the best match is not a match.
 *
 * A visitor asking something the page does not cover must reach the model
 * with everything, so that the refusal is the model's judgement about the
 * whole page rather than an artefact of retrieval having found nothing.
 * 0.35 is a starting value, tuned against the golden set.
 */
export const RETRIEVAL_FLOOR = 0.35;

/**
 * How many characters of claims one answer may carry: roughly 1,150 tokens of
 * Malay prose, so a retrieved prompt is about 1,500 tokens against the ~6,000
 * a 114-fact page used to send.
 */
export const FACT_BUDGET_CHARS = 4000;

export type FallbackReason = 'below-minimum' | 'missing-vectors' | 'below-floor';

export interface Selection<T> {
  mode: 'retrieved' | 'fallback';
  /** Null in retrieved mode. */
  reason: FallbackReason | null;
  /** Always what to send: the selected facts, or every fact. */
  facts: T[];
  /** The best cosine seen, or null when scoring never happened. */
  bestScore: number | null;
}

/**
 * Cosine, computed from magnitudes rather than assumed.
 *
 * The provider returns unit vectors today, so a dot product would do. It is
 * computed properly anyway because the assumption is invisible when it breaks:
 * a provider that stops normalising would not fail, it would rank by length.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vectors of different width: ${a.length} and ${b.length}.`);
  }

  let dot = 0;
  let aSquared = 0;
  let bSquared = 0;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    dot += left * right;
    aSquared += left * left;
    bSquared += right * right;
  }

  // Zero magnitude means an unusable vector. Zero, not NaN: NaN compares
  // false against the floor, so it would read as an ordinary weak match and
  // hide the bug in a fallback that looks like a design working correctly.
  if (aSquared === 0 || bSquared === 0) return 0;

  return dot / (Math.sqrt(aSquared) * Math.sqrt(bSquared));
}

export function selectFacts<T extends { id: string; claim: string }>(input: {
  facts: T[];
  vectors: ReadonlyMap<string, Float32Array>;
  question: Float32Array;
  minFacts?: number;
  floor?: number;
  budgetChars?: number;
}): Selection<T> {
  const { facts, vectors, question } = input;
  const minFacts = input.minFacts ?? RETRIEVAL_MIN_FACTS;
  const floor = input.floor ?? RETRIEVAL_FLOOR;
  const budgetChars = input.budgetChars ?? FACT_BUDGET_CHARS;

  const everything = (reason: FallbackReason, bestScore: number | null = null): Selection<T> => ({
    mode: 'fallback',
    reason,
    facts,
    bestScore,
  });

  if (facts.length < minFacts) return everything('below-minimum');

  // Every fact, or none. A page missing one vector cannot be scored fairly:
  // the missing fact would be absent from the ranking rather than ranked
  // last, and it might be the one holding the price.
  const scored: { fact: T; score: number }[] = [];
  for (const fact of facts) {
    const vector = vectors.get(fact.id);
    if (vector === undefined) return everything('missing-vectors');
    scored.push({ fact, score: cosineSimilarity(question, vector) });
  }

  // Sort is stable in every engine this runs on, so facts of equal score keep
  // the order they arrived in -- which the chat path orders by createdAt, so
  // ties break towards the fact the owner has had longest.
  scored.sort((left, right) => right.score - left.score);

  const best = scored[0]?.score ?? 0;
  if (best < floor) return everything('below-floor', best);

  // The first fact is always taken, whatever its length: it scored above the
  // floor, and a prompt with no facts in it can only refuse a question the
  // page can answer. After that the budget ends the selection at the first
  // fact that would overflow -- never skipping past it to a shorter one,
  // which would make the set something other than the top N by score.
  const selected: T[] = [];
  let used = 0;
  for (const { fact } of scored) {
    if (selected.length > 0 && used + fact.claim.length > budgetChars) break;
    selected.push(fact);
    used += fact.claim.length;
  }

  return { mode: 'retrieved', reason: null, facts: selected, bestScore: best };
}
```

- [ ] **Step 4: Export it**

`packages/core/src/index.ts`, appended:

```ts
export {
  cosineSimilarity,
  FACT_BUDGET_CHARS,
  RETRIEVAL_FLOOR,
  RETRIEVAL_MIN_FACTS,
  selectFacts,
} from './retrieval.js';
export type { FallbackReason, Selection } from './retrieval.js';
```

- [ ] **Step 5: Run them and watch them pass**

Run: `pnpm --filter @curios/core test`
Expected: PASS, 17 new tests.

- [ ] **Step 6: Prove each test by mutation**

| Mutation | Test that must go red |
|---|---|
| `if (aSquared === 0 \|\| bSquared === 0) return 0;` deleted | `is 0 against a zero vector, never NaN` |
| `dot / (Math.sqrt(aSquared) * Math.sqrt(bSquared))` → `dot` | `ignores magnitude` |
| the width throw deleted | `refuses vectors of different widths` |
| `facts.length < minFacts` → `facts.length <= minFacts` | `retrieves on a page with exactly the minimum facts` |
| `facts.length < minFacts` → `facts.length < 0` | `falls back on a page with fewer than the minimum facts` |
| `if (vector === undefined) return everything('missing-vectors')` → `continue` | `falls back when one fact has no vector` |
| `best < floor` → `best < 0` | `falls back when the best score is below the floor` |
| `best < floor` → `best <= floor` | `retrieves when the best score is exactly the floor` |
| `sort((left, right) => right.score - left.score)` → `left.score - right.score` | `returns facts in score order, best first` |
| the budget `break` → `continue` | `ends the selection at the first fact that would overflow` |
| `selected.length > 0 &&` removed from the budget check | `always sends the best fact, even when it alone exceeds the budget` |
| `bestScore: best` → `bestScore: null` in the retrieved return | `reports the best score it saw, for logging` |
| `input.budgetChars ?? FACT_BUDGET_CHARS` → `FACT_BUDGET_CHARS` | `takes an overridden floor and budget` |

- [ ] **Step 7: Run the gates and commit**

```bash
git add packages/core
git commit -m "feat(core): choose the facts a question needs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: one writer of vectors, and the worker that calls it

**Files:**
- Create: `packages/db/src/fact-embedding.ts`
- Test: `packages/db/src/fact-embedding.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/workers/src/ingestion/extract.service.ts`
- Modify: `apps/workers/src/ingestion/ingestion.worker.ts`
- Modify: `apps/workers/src/main.ts`
- Modify: `apps/workers/package.json`
- Test: `apps/workers/src/ingestion/extract.service.test.ts` (add cases)

**Interfaces:**
- Consumes: `Embedder`, `encodeVector`, `EMBED_BATCH`, `EMBEDDING_DIMS`, `EMBEDDING_MODEL`, `EMBEDDING_BATCH_TIMEOUT_MS`, `createOpenAiEmbedder` from `@curios/embeddings` (Task 1).
- Produces:
  - `syncFactEmbeddings(prisma: PrismaClient, embedder: Embedder, where: Prisma.FactWhereInput, options?: { batch?: number }): Promise<{ scanned: number; embedded: number }>` from `@curios/db`
  - `ExtractDeps.embedder: Embedder | null`

**Context you need:**

`syncFactEmbeddings` is **the only thing in the product that writes `FactEmbedding` rows**. Three callers use it: the worker after extraction (`{ pageId }`), the backfill script (`{}`, every page), and the golden runner after seeding (`{ pageId }`). One implementation, because three near-identical loops over a batching API is how the batch size and the staleness rule drift apart.

It lives in `packages/db` beside `recordModelCall`, which is the same shape of thing: a domain helper that owns one table's writes and is shared by the app and the worker.

**What counts as needing a vector:** a fact that is not rejected and either has no embedding row, or has one whose `model` or `dims` do not match the embedder passed in. That last part is what makes changing `EMBEDDING_MODEL` a backfill rather than a migration.

**What gets embedded:** `question ?? claim`. Matching a visitor's question against the question a fact answers is the whole idea; the claim is the fallback for facts written before `Fact.question` existed.

**Unverified facts are embedded too.** Chat reads only verified facts, so their vectors are never used — but an owner clicking Accept must not put their page into fallback until the next crawl. It costs about two thousandths of a sen for a whole page.

- [ ] **Step 1: Write the failing tests**

`packages/db/src/fact-embedding.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { decodeVector, EMBEDDING_DIMS, EMBEDDING_MODEL, type Embedder } from '@curios/embeddings';
import { syncFactEmbeddings } from './fact-embedding.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

/** An embedder that returns a vector whose first value is the text's length. */
function embedderCounting(): { embedder: Embedder; calls: () => string[][] } {
  const calls: string[][] = [];
  return {
    calls: () => calls,
    embedder: {
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      embed: async (texts) => {
        calls.push(texts);
        return texts.map((text) => {
          const vector = new Float32Array(EMBEDDING_DIMS);
          vector[0] = text.length;
          return vector;
        });
      },
    },
  };
}

async function seedPage(facts: { claim: string; question?: string | null; rejected?: boolean }[]) {
  const account = await prisma.account.create({
    data: {
      email: `e${Date.now()}${Math.random()}@example.com`,
      pages: {
        create: {
          handle: `h${Date.now()}${Math.floor(Math.random() * 1e6)}`,
          skeleton: `s${Date.now()}${Math.floor(Math.random() * 1e6)}`,
          displayName: 'A Page',
          facts: {
            create: facts.map((fact) => ({
              category: 'PRICE' as const,
              claim: fact.claim,
              question: fact.question ?? null,
              normalizedClaim: fact.claim.toLowerCase(),
              confidence: 1,
              rejectedAt: fact.rejected === true ? new Date() : null,
            })),
          },
        },
      },
    },
    include: { pages: true },
  });
  const page = account.pages[0];
  if (!page) throw new Error('seed produced no page');
  return page.id;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

describe('syncFactEmbeddings', () => {
  it('writes one row per fact that has none', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.' }, { claim: 'Buka 9 pagi.' }]);
    const { embedder } = embedderCounting();

    const result = await syncFactEmbeddings(prisma, embedder, { pageId });

    expect(result).toEqual({ scanned: 2, embedded: 2 });
    expect(await prisma.factEmbedding.count()).toBe(2);
  });

  // The whole idea of the slice. A fact's question is what a visitor's
  // question is matched against; embedding the claim instead is the design
  // that failed twice before.
  it('embeds the question a fact answers, not its claim', async () => {
    const pageId = await seedPage([
      { claim: 'Kek butter 1kg RM95.', question: 'Berapa harga kek butter?' },
    ]);
    const { embedder, calls } = embedderCounting();

    await syncFactEmbeddings(prisma, embedder, { pageId });

    expect(calls()[0]).toEqual(['Berapa harga kek butter?']);
  });

  it('falls back to the claim when a fact has no question', async () => {
    const pageId = await seedPage([{ claim: 'Kek butter 1kg RM95.', question: null }]);
    const { embedder, calls } = embedderCounting();

    await syncFactEmbeddings(prisma, embedder, { pageId });

    expect(calls()[0]).toEqual(['Kek butter 1kg RM95.']);
  });

  it('stores the model and width on every row, so a later change is detectable', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.' }]);
    const { embedder } = embedderCounting();

    await syncFactEmbeddings(prisma, embedder, { pageId });

    const row = await prisma.factEmbedding.findFirstOrThrow();
    expect(row.model).toBe(EMBEDDING_MODEL);
    expect(row.dims).toBe(EMBEDDING_DIMS);
    expect(decodeVector(row.vector, EMBEDDING_DIMS)[0]).toBe('Kek RM95.'.length);
  });

  it('skips a fact that already has a current vector', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.' }]);
    const { embedder, calls } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { pageId });

    const second = await syncFactEmbeddings(prisma, embedder, { pageId });

    expect(second).toEqual({ scanned: 0, embedded: 0 });
    expect(calls()).toHaveLength(1);
  });

  // Changing EMBEDDING_MODEL must be a backfill, not a migration: rows from
  // the old model are re-embedded rather than compared against vectors from
  // a different space.
  it('re-embeds a fact whose stored vector came from another model', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.' }]);
    const { embedder } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { pageId });
    await prisma.factEmbedding.updateMany({ data: { model: 'something-older' } });

    const result = await syncFactEmbeddings(prisma, embedder, { pageId });

    expect(result.embedded).toBe(1);
    expect(await prisma.factEmbedding.findFirstOrThrow()).toMatchObject({ model: EMBEDDING_MODEL });
  });

  it('re-embeds a fact whose stored vector is a different width', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.' }]);
    const { embedder } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { pageId });
    await prisma.factEmbedding.updateMany({ data: { dims: 64 } });

    expect((await syncFactEmbeddings(prisma, embedder, { pageId })).embedded).toBe(1);
  });

  // A rejected fact was dismissed by the owner and can never reach an answer.
  it('leaves rejected facts alone', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.', rejected: true }]);
    const { embedder } = embedderCounting();

    expect(await syncFactEmbeddings(prisma, embedder, { pageId })).toEqual({
      scanned: 0,
      embedded: 0,
    });
  });

  it('honours the caller’s filter and touches no other page', async () => {
    const mine = await seedPage([{ claim: 'Kek RM95.' }]);
    await seedPage([{ claim: 'Roti RM5.' }]);
    const { embedder } = embedderCounting();

    await syncFactEmbeddings(prisma, embedder, { pageId: mine });

    expect(await prisma.factEmbedding.count()).toBe(1);
  });

  it('batches, so one large page is several requests rather than one', async () => {
    const pageId = await seedPage(
      Array.from({ length: 5 }, (_unused, index) => ({ claim: `Fakta ${index}.` })),
    );
    const { embedder, calls } = embedderCounting();

    await syncFactEmbeddings(prisma, embedder, { pageId }, { batch: 2 });

    expect(calls().map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(await prisma.factEmbedding.count()).toBe(5);
  });

  // The vector a fact gets must be its own. A batch written back by position
  // instead of by fact id is the bug that gives every fact on a page its
  // neighbour's vector, and no assertion anywhere else would catch it.
  it('gives each fact its own vector, across a batch boundary', async () => {
    const pageId = await seedPage([
      { claim: 'a' },
      { claim: 'bb' },
      { claim: 'ccc' },
      { claim: 'dddd' },
    ]);
    const { embedder } = embedderCounting();

    await syncFactEmbeddings(prisma, embedder, { pageId }, { batch: 2 });

    const rows = await prisma.factEmbedding.findMany({ include: { fact: true } });
    for (const row of rows) {
      expect(decodeVector(row.vector, EMBEDDING_DIMS)[0]).toBe(row.fact.claim.length);
    }
  });

  it('lets a failure from the provider reach the caller', async () => {
    const pageId = await seedPage([{ claim: 'Kek RM95.' }]);
    const embedder: Embedder = {
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      embed: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
    };

    await expect(syncFactEmbeddings(prisma, embedder, { pageId })).rejects.toThrow(
      /provider unavailable/,
    );
    expect(await prisma.factEmbedding.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @curios/db test`
Expected: FAIL — `Failed to resolve import "./fact-embedding.js"`.

- [ ] **Step 3: Write `fact-embedding.ts`**

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
import { EMBED_BATCH, encodeVector, type Embedder } from '@curios/embeddings';

/**
 * The only thing in the product that writes FactEmbedding rows.
 *
 * Three callers: the worker after an extraction, the backfill script, and the
 * golden runner after it seeds. They differ only in the `where` they pass, and
 * three loops over a batching API is how a batch size and a staleness rule
 * drift apart.
 *
 * "Needs a vector" means: not rejected, and either no row at all or a row
 * whose model or width does not match the embedder handed in. That last part
 * is what makes changing the embedding model a backfill rather than a
 * migration -- until it runs, every affected page sends every fact, which is
 * slow and expensive and never wrong.
 *
 * Unverified facts are embedded too. Chat reads only verified facts, so those
 * vectors sit unused -- but an owner clicking Accept must not drop their page
 * into fallback until the next crawl, and a page of vectors costs about two
 * thousandths of a sen.
 *
 * It does not catch: a caller decides whether a failure to embed is fatal.
 * The worker swallows it (an ingestion that wrote its facts succeeded), the
 * backfill reports it, the golden runner fails the run.
 */
export async function syncFactEmbeddings(
  prisma: PrismaClient,
  embedder: Embedder,
  where: Prisma.FactWhereInput,
  options: { batch?: number } = {},
): Promise<{ scanned: number; embedded: number }> {
  const batchSize = options.batch ?? EMBED_BATCH;

  const pending = await prisma.fact.findMany({
    where: {
      AND: [
        where,
        { rejectedAt: null },
        {
          OR: [
            { embedding: null },
            { embedding: { model: { not: embedder.model } } },
            { embedding: { dims: { not: embedder.dims } } },
          ],
        },
      ],
    },
    select: { id: true, question: true, claim: true },
    orderBy: { createdAt: 'asc' },
  });

  let embedded = 0;

  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    // The question a customer would ask to get this claim, which is what a
    // visitor's question is matched against. The claim is the fallback for
    // facts written before Fact.question existed; the backfill script for
    // questions fills most of those in.
    const vectors = await embedder.embed(batch.map((fact) => fact.question ?? fact.claim));

    for (const [index, fact] of batch.entries()) {
      const vector = vectors[index];
      // Cannot happen -- the embedder contract rejects rather than returning
      // a short array -- but writing a row here without it would hand this
      // fact somebody else's vector.
      if (vector === undefined) {
        throw new Error(`No vector came back for fact ${fact.id}.`);
      }
      const row = { vector: encodeVector(vector), model: embedder.model, dims: embedder.dims };
      await prisma.factEmbedding.upsert({
        where: { factId: fact.id },
        create: { factId: fact.id, ...row },
        update: { ...row, createdAt: new Date() },
      });
      embedded += 1;
    }
  }

  return { scanned: pending.length, embedded };
}
```

`packages/db/src/index.ts`, appended:

```ts
export { syncFactEmbeddings } from './fact-embedding.js';
```

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @curios/db test`
Expected: PASS, 12 new tests.

- [ ] **Step 5: Prove each test by mutation**

| Mutation | Test that must go red |
|---|---|
| `fact.question ?? fact.claim` → `fact.claim` | `embeds the question a fact answers, not its claim` |
| `fact.question ?? fact.claim` → `fact.question ?? ''` | `falls back to the claim when a fact has no question` |
| drop `{ embedding: null }` from the `OR` | `writes one row per fact that has none` |
| drop the `model: { not: embedder.model }` clause | `re-embeds a fact whose stored vector came from another model` |
| drop the `dims: { not: embedder.dims }` clause | `re-embeds a fact whose stored vector is a different width` |
| drop `{ rejectedAt: null }` | `leaves rejected facts alone` |
| drop `where` from the `AND` | `honours the caller's filter and touches no other page` |
| the whole `OR` block deleted | `skips a fact that already has a current vector` |
| `start += batchSize` → `start += pending.length` | `batches, so one large page is several requests` |
| `vectors[index]` → `vectors[0]` | `gives each fact its own vector, across a batch boundary` |
| wrap `embedder.embed` in `try { } catch { continue }` | `lets a failure from the provider reach the caller` |
| `model: embedder.model` → `model: 'x'` | `stores the model and width on every row` |

- [ ] **Step 6: Wire the worker — write the failing tests first**

Add to `apps/workers/src/ingestion/extract.service.test.ts`, following that file's existing helpers for building `ExtractDeps`:

```ts
it('embeds the facts it just wrote', async () => {
  const embedder = countingEmbedder();

  await runExtraction({ prisma, gateway, adapter, embedder: embedder.embedder }, job);

  expect(await prisma.factEmbedding.count()).toBe(expectedFactCount);
});

// An ingestion that wrote its facts succeeded. The page stays in fallback
// until a backfill catches it, which is the correct behaviour and not worth
// throwing away a crawl and an Opus call for.
it('succeeds even when embedding fails, leaving the page in fallback', async () => {
  const embedder: Embedder = {
    model: EMBEDDING_MODEL,
    dims: EMBEDDING_DIMS,
    embed: async () => {
      throw new Error('provider unavailable');
    },
  };

  const result = await runExtraction({ prisma, gateway, adapter, embedder }, job);

  expect(result.extractedCount).toBeGreaterThan(0);
  const ingestion = await prisma.ingestion.findUniqueOrThrow({ where: { id: job.ingestionId } });
  expect(ingestion.status).toBe('SUCCEEDED');
  expect(await prisma.factEmbedding.count()).toBe(0);
});

it('writes facts and succeeds when no embedder is configured', async () => {
  const result = await runExtraction({ prisma, gateway, adapter, embedder: null }, job);

  expect(result.extractedCount).toBeGreaterThan(0);
  expect(await prisma.factEmbedding.count()).toBe(0);
});
```

Adapt the names (`gateway`, `adapter`, `job`, `expectedFactCount`) to whatever that file already builds; do not restructure its existing tests. Write a `countingEmbedder()` helper in that file matching the one in Step 1.

- [ ] **Step 7: Wire the worker — the code**

`apps/workers/src/ingestion/extract.service.ts`:

```ts
import { syncFactEmbeddings, recordModelCall, type PrismaClient } from '@curios/db';
import { EMBEDDING_BATCH_TIMEOUT_MS, type Embedder } from '@curios/embeddings';
```

`ExtractDeps` gains:

```ts
  /**
   * Null when the process has no embeddings key. Facts are still written;
   * the page simply has no vectors, which puts every question on it into
   * fallback until a backfill runs. Never a reason to fail an ingestion.
   */
  embedder: Embedder | null;
```

Immediately after the `prisma.fact.createMany` line and **before** the `ingestion.update` that marks SUCCEEDED, insert:

```ts
    // Its own try, not the outer one. An ingestion that crawled a site, spent
    // an Opus call and wrote its facts has succeeded; a provider blip on the
    // embeddings call must not turn that into a FAILED row the owner sees as
    // "we could not read your website". The page stays in fallback -- every
    // fact on every question, which is exactly what it did before this slice
    // -- until the backfill or the next crawl catches it.
    if (deps.embedder) {
      try {
        await syncFactEmbeddings(prisma, deps.embedder, { pageId: job.pageId });
      } catch (error) {
        deps.log?.warn?.(
          { pageId: job.pageId, err: error instanceof Error ? error.message : String(error) },
          'facts written but not embedded; this page falls back until a backfill runs',
        );
      }
    }
```

`ExtractDeps` also gains the optional log this uses, if it does not already have one:

```ts
  log?: { warn?: (details: object, message: string) => void };
```

`apps/workers/src/ingestion/ingestion.worker.ts` — the deps object gains `embedder: Embedder | null`, and the handler passes it through:

```ts
    async (job) =>
      runExtraction(
        { prisma: deps.prisma, gateway: deps.gateway, adapter, embedder: deps.embedder, log: deps.log },
        job.data,
      ),
```

`apps/workers/src/main.ts`, after the gateway is built:

```ts
const openAiKey = process.env.OPENAI_API_KEY;
if (!openAiKey) throw new Error('OPENAI_API_KEY is not set');

// The batch timeout, not the visitor one: nothing is waiting on an
// ingestion, and a whole page of facts goes in one request.
const embedder = createOpenAiEmbedder(openAiKey, { timeoutMs: EMBEDDING_BATCH_TIMEOUT_MS });
```

and `createIngestionWorker({ connection, prisma, gateway, embedder, log })`.

`apps/workers/package.json` gains `"@curios/embeddings": "workspace:*"` in `dependencies`. Then `pnpm install`.

- [ ] **Step 8: Run them and prove them by mutation**

Run: `pnpm --filter @curios/workers test`

| Mutation | Test that must go red |
|---|---|
| the `syncFactEmbeddings` call deleted | `embeds the facts it just wrote` |
| the inner `try/catch` removed, letting the error reach the outer catch | `succeeds even when embedding fails` |
| `if (deps.embedder)` → `if (true)` with a non-null assertion | `writes facts and succeeds when no embedder is configured` |
| the call moved above `prisma.fact.createMany` | `embeds the facts it just wrote` (nothing to embed yet) |

- [ ] **Step 9: Run the gates and commit**

```bash
git add packages/db apps/workers pnpm-lock.yaml
git commit -m "feat(workers): embed a page's facts as extraction writes them

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: keeping vectors current — the edit path and the backfill

**Files:**
- Modify: `apps/api/src/modules/facts/fact.service.ts`
- Modify: `apps/api/src/modules/facts/fact.routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/package.json`
- Create: `scripts/backfill-fact-embeddings.ts`
- Test: `apps/api/src/modules/facts/fact.service.test.ts` (add cases; create the file if it does not exist)

**Interfaces:**
- Consumes: `syncFactEmbeddings` (Task 4), `Embedder`, `createOpenAiEmbedder`, `EMBEDDING_BATCH_TIMEOUT_MS`.
- Produces:
  - `editFact(prisma, accountId, factId, claim, embedder: Embedder | null): Promise<void>` — a fifth parameter
  - `FactRouteOptions { embedder?: Embedder | null }`
  - `AppOverrides.facts?: FactRouteOptions`

**Context you need — read this before writing any code:**

The spec says "when a fact is edited, the API re-embeds that one fact on save". That is right for the facts this path can actually change the meaning of, and wrong for the rest, so read carefully:

**`editFact` changes `claim` and nothing else.** The vector is of `question ?? claim`. So:

- A fact **with** a question: its vector is of the question, the question did not change, and the vector is **not stale**. Re-embedding it would spend a call to write the same numbers back. Do nothing.
- A fact **without** a question: its vector is of the claim, which just changed. The vector **is** stale. Re-embed it.

There is no path in the product that edits `Fact.question` today. If one is ever added, it must re-embed unconditionally — say so in a comment where someone adding it will read it.

**When re-embedding fails, delete the row.** A stale vector is a wrong answer: it matches the old claim's wording and hands the model a fact that no longer says that. No row at all puts the page in fallback, which is correct by construction. Never leave the old row in place.

**A failure to embed must never fail the owner's save.** The edit is committed by then. Swallow it, log it, and let the deleted row do its job.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/facts/fact.service.test.ts` — follow the setup style of the other service tests in `apps/api` (a module-level `PrismaClient` on `DATABASE_URL_TEST`, `TRUNCATE "Account" CASCADE` in `beforeEach`):

```ts
describe('editFact and the fact’s vector', () => {
  it('re-embeds a fact whose vector was of its claim', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Kek RM95.', question: null });
    const { embedder, calls } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { id: factId });

    await editFact(prisma, accountId, factId, 'Kek RM120.', embedder);

    expect(calls().at(-1)).toEqual(['Kek RM120.']);
    const row = await prisma.factEmbedding.findUniqueOrThrow({ where: { factId } });
    expect(decodeVector(row.vector, EMBEDDING_DIMS)[0]).toBe('Kek RM120.'.length);
  });

  // The vector is of the question, the question did not change, and a call to
  // write the same numbers back is a call nobody needed.
  it('leaves the vector alone when the fact carries a question', async () => {
    const { accountId, factId } = await seedFact({
      claim: 'Kek RM95.',
      question: 'Berapa harga kek?',
    });
    const { embedder, calls } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { id: factId });
    const before = calls().length;

    await editFact(prisma, accountId, factId, 'Kek RM120.', embedder);

    expect(calls()).toHaveLength(before);
    expect(await prisma.factEmbedding.count({ where: { factId } })).toBe(1);
  });

  // A stale vector matches the wording of a claim that no longer exists. No
  // vector means the page falls back and sends everything, which is right.
  it('deletes the vector when re-embedding fails, rather than leaving a stale one', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Kek RM95.', question: null });
    const { embedder } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { id: factId });

    const failing: Embedder = {
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      embed: async () => {
        throw new Error('provider unavailable');
      },
    };
    await editFact(prisma, accountId, factId, 'Kek RM120.', failing);

    expect(await prisma.factEmbedding.count({ where: { factId } })).toBe(0);
    const fact = await prisma.fact.findUniqueOrThrow({ where: { id: factId } });
    expect(fact.claim).toBe('Kek RM120.');
  });

  it('deletes the vector when there is no embedder at all', async () => {
    const { accountId, factId } = await seedFact({ claim: 'Kek RM95.', question: null });
    const { embedder } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { id: factId });

    await editFact(prisma, accountId, factId, 'Kek RM120.', null);

    expect(await prisma.factEmbedding.count({ where: { factId } })).toBe(0);
  });

  it('touches no vector when the edit itself was refused', async () => {
    const { factId } = await seedFact({ claim: 'Kek RM95.', question: null });
    const { embedder, calls } = embedderCounting();
    await syncFactEmbeddings(prisma, embedder, { id: factId });
    const before = calls().length;

    await expect(
      editFact(prisma, 'somebody-else', factId, 'Kek RM120.', embedder),
    ).rejects.toThrow(FactNotFoundError);

    expect(calls()).toHaveLength(before);
    expect(await prisma.factEmbedding.count({ where: { factId } })).toBe(1);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @curios/api test -- fact.service`
Expected: FAIL — `editFact` takes four arguments.

- [ ] **Step 3: Change `editFact`**

`apps/api/src/modules/facts/fact.service.ts`:

```ts
import { syncFactEmbeddings, type PrismaClient } from '@curios/db';
import type { Embedder } from '@curios/embeddings';
```

Replace the body of `editFact` after the not-found throw, and extend its signature and doc comment:

```ts
/**
 * Rewrites a claim, and the dedupe key with it.
 *
 * `normalizeClaim` is re-run rather than left alone, so the key never drifts
 * from the text it is meant to key. That is also what makes a collision
 * possible here, and a collision is an owner-fixable fact rather than a 500.
 *
 * The fact's vector is handled last, and only when it can be stale. A vector
 * is of `question ?? claim`: a fact carrying a question is matched on that
 * question, which this function cannot change, so its vector is still
 * correct and re-embedding it would write the same numbers back. A fact with
 * no question is matched on its claim, which just changed, so it is
 * re-embedded.
 *
 * NOTE for whoever adds an edit-the-question path: that one must re-embed
 * unconditionally. The condition below is not "we can skip this sometimes",
 * it is "this path cannot change what was embedded".
 *
 * A failure to embed never fails the save. The edit is already committed, and
 * an owner watching a spinner does not care which vendor is down. The row is
 * deleted instead: a stale vector matches wording the claim no longer has,
 * which is a wrong answer, and no vector puts the page into fallback, which
 * is merely an expensive right one.
 */
export async function editFact(
  prisma: PrismaClient,
  accountId: string,
  factId: string,
  claim: string,
  embedder: Embedder | null,
): Promise<void> {
  let updated;
  try {
    updated = await prisma.fact.updateMany({
      where: { id: factId, page: { accountId } },
      data: { claim, normalizedClaim: normalizeClaim(claim) },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateFactError();
    throw error;
  }

  // Thrown OUTSIDE the catch above, deliberately. Inside it, a not-found we
  // raised ourselves would be handed to `isUniqueViolation` to classify, and
  // the two would only stay distinct for as long as their `code` values happen
  // to differ. It is also thrown before any embedding work, so a refused edit
  // never spends a call or touches a vector.
  if (updated.count !== 1) throw new FactNotFoundError();

  const fact = await prisma.fact.findUnique({
    where: { id: factId },
    select: { question: true },
  });
  if (fact?.question != null) return;

  try {
    if (!embedder) throw new Error('no embedder is configured');
    // Deleted first, so that a crash between the two leaves no vector rather
    // than a stale one: the failure that costs money is always the safer one.
    await prisma.factEmbedding.deleteMany({ where: { factId } });
    await syncFactEmbeddings(prisma, embedder, { id: factId });
  } catch {
    await prisma.factEmbedding.deleteMany({ where: { factId } });
  }
}
```

- [ ] **Step 4: Wire the route**

`apps/api/src/modules/facts/fact.routes.ts`:

```ts
import type { Embedder } from '@curios/embeddings';
import { createOpenAiEmbedder, EMBEDDING_BATCH_TIMEOUT_MS } from '@curios/embeddings';

export interface FactRouteOptions {
  /**
   * `undefined` builds one from the environment, which is what production
   * does. `null` means no embedder: an edit then deletes the fact's vector
   * and the page falls back. Only tests pass null.
   */
  embedder?: Embedder | null;
}

export const factRoutes: FastifyPluginAsyncZod<FactRouteOptions> = async (app, options) => {
  let embedder = options.embedder;
  if (embedder === undefined) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    // An owner is watching a spinner, not a visitor watching a bubble, and
    // this embeds exactly one short string.
    embedder = createOpenAiEmbedder(apiKey, { timeoutMs: EMBEDDING_BATCH_TIMEOUT_MS });
  }
```

and the PATCH handler passes it:

```ts
      await editFact(app.prisma, request.account.id, request.params.id, request.body.claim, embedder);
```

`apps/api/src/app.ts`: add `facts?: FactRouteOptions;` to `AppOverrides`, import the type, and change the registration to `await scope.register(factRoutes, overrides.facts ?? {});`.

`apps/api/package.json` gains `"@curios/embeddings": "workspace:*"`. Then `pnpm install`.

- [ ] **Step 5: Run them and prove them by mutation**

| Mutation | Test that must go red |
|---|---|
| `if (fact?.question != null) return;` deleted | `leaves the vector alone when the fact carries a question` |
| `if (fact?.question != null) return;` → `if (true) return;` | `re-embeds a fact whose vector was of its claim` |
| the `catch` block emptied | `deletes the vector when re-embedding fails` |
| `if (!embedder) throw` → `if (!embedder) return` | `deletes the vector when there is no embedder at all` |
| the `updated.count !== 1` throw moved below the embedding block | `touches no vector when the edit itself was refused` |

- [ ] **Step 6: Write the backfill script**

`scripts/backfill-fact-embeddings.ts`:

```ts
import { config } from 'dotenv';
import { join } from 'node:path';
import { prisma, syncFactEmbeddings } from '@curios/db';
import {
  createOpenAiEmbedder,
  EMBEDDING_BATCH_TIMEOUT_MS,
  EMBEDDING_MODEL,
} from '@curios/embeddings';

// Resolved from this file's own location rather than the cwd, so the command
// below works from anywhere in the repo. Same trap seed-dev.ts documents.
config({ path: join(import.meta.dirname, '..', '.env') });

/**
 * Fills in the vectors for facts that already exist.
 *
 * Run it once after the migration that added FactEmbedding, and again any
 * time EMBEDDING_MODEL changes -- a fact whose stored vector came from
 * another model is re-embedded, not skipped. Until it has run, the pages it
 * covers answer from every fact they have, which is correct and about seven
 * times the cost.
 *
 *   pnpm exec tsx scripts/backfill-fact-embeddings.ts
 *
 * It runs against whatever DATABASE_URL points at -- check that first. Safe to
 * re-run: it only ever selects facts that need a vector, so a second run does
 * nothing and costs nothing.
 */
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

const embedder = createOpenAiEmbedder(apiKey, { timeoutMs: EMBEDDING_BATCH_TIMEOUT_MS });

console.log(`Embedding with ${EMBEDDING_MODEL} at ${embedder.dims} dimensions.`);

// An empty filter: every page. syncFactEmbeddings adds the rest of the rule
// -- not rejected, and no current vector.
const { scanned, embedded } = await syncFactEmbeddings(prisma, embedder, {});

console.log(`${scanned} facts needed a vector; ${embedded} written.`);

await prisma.$disconnect();
```

- [ ] **Step 7: Run the script against the development database**

```bash
pnpm exec tsx scripts/backfill-fact-embeddings.ts
```

Expected: it names the model, reports a count, and exits 0. Report the two numbers.

Then confirm the vectors are real:

```bash
pnpm --filter @curios/db exec prisma studio
```

or, faster, a one-liner that counts `FactEmbedding` rows against non-rejected `Fact` rows. They should match. Put both counts in your report.

- [ ] **Step 8: Run the gates and commit**

```bash
git add apps/api scripts pnpm-lock.yaml
git commit -m "feat(facts): keep a fact's vector current, and backfill the ones that have none

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: caching becomes a decision, and the fact id goes

**Files:**
- Modify: `packages/gateway/src/types.ts`
- Modify: `packages/gateway/src/anthropic.gateway.ts`
- Test: `packages/gateway/src/anthropic.gateway.test.ts` (add cases; create if absent)
- Modify: `apps/api/src/modules/chat/prompt.ts`
- Test: `apps/api/src/modules/chat/prompt.test.ts` (add and amend cases)

**Interfaces:**
- Produces:
  - `ChatInput.cachePrompt: boolean` — **required**, so no call site can forget to decide
  - `PromptFact { category: FactCategory; claim: string }` — `id` removed

**Context you need:**

Two small independent changes, one task, because they are the two edits to what the model receives and a reviewer should see them together.

**Why caching becomes a decision.** `cache_control` on the system block costs 1.25× the input price to write and 0.1× to read. That pays when the same prefix comes back inside five minutes. In retrieval mode the prefix is different for every question, so every call writes an entry at a 25% premium that nothing ever reads. In fallback mode the prefix is the whole fact list, stable between owner edits, and caching is worth having — so this is a per-call decision, not a removal.

**Why the id goes.** It is `id="cm4x8k2p90001..."` on every fact — about 19 tokens each, 36% of a 114-fact page's prompt — and **nothing ever reads it back**. The model is never asked to cite a fact id, no parser looks for one in the answer, and `citedFactIds` is written from the selection, not from the text. Grep for `id="` and for anything parsing the answer before you delete it, and say in your report what you found.

`PromptFact` keeps `category`, which the model does use to tell a price from a policy.

- [ ] **Step 1: Write the failing gateway test**

`packages/gateway/src/anthropic.gateway.test.ts` — if the file does not exist, create it following the style of `packages/goldens/src/rules.test.ts`. The gateway's `chat` needs an Anthropic client, so test the request shape by passing a fake client if `createAnthropicGateway` allows one; if it does not, **do not refactor the gateway to accept one** — instead assert the branch by extracting the system-block builder:

```ts
/**
 * The `system` field for one call. Extracted and exported so the caching
 * decision can be tested without a client: it is one branch, and it is the
 * difference between paying a 25% premium on every question and not.
 */
export function systemBlockFor(
  systemPrompt: string,
  cachePrompt: boolean,
): Anthropic.MessageCreateParams['system'] {
  return cachePrompt
    ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
    : systemPrompt;
}
```

and the tests:

```ts
describe('systemBlockFor', () => {
  it('marks the prompt cacheable when asked to', () => {
    expect(systemBlockFor('rules and facts', true)).toEqual([
      { type: 'text', text: 'rules and facts', cache_control: { type: 'ephemeral' } },
    ]);
  });

  // A prompt that differs per question writes a fresh cache entry, at a 25%
  // premium, that nothing ever reads.
  it('sends a plain string when caching would never pay', () => {
    expect(systemBlockFor('rules and facts', false)).toBe('rules and facts');
  });
});
```

- [ ] **Step 2: Make it compile and pass**

`packages/gateway/src/types.ts`, in `ChatInput`:

```ts
  /**
   * Whether to mark the system prompt as a cacheable prefix.
   *
   * Required rather than defaulted, because both answers are right in
   * different modes and a default hides which one a caller got. True when the
   * prompt is the page's whole fact list, which is stable between owner edits
   * and shared by every visitor. False when it was built for this question:
   * the prefix differs every time, so each call would write an entry at a 25%
   * premium that nothing ever reads.
   */
  cachePrompt: boolean;
```

`packages/gateway/src/anthropic.gateway.ts` — add `systemBlockFor` above `createAnthropicGateway`, and in `chat`:

```ts
    async *chat({ systemPrompt, messages, cachePrompt }: ChatInput): AsyncIterable<ChatEvent> {
      const started = Date.now();

      // Haiku 4.5 predates adaptive thinking and effort: pass neither.
      // When the prompt is cached, cache_control sits at the end of the system
      // block so the stable fact list is cached and the volatile conversation
      // lands after the breakpoint -- which is why history goes in `messages`
      // and is never appended to the system prompt. When it is not, the whole
      // block is built for this one question and there is nothing to reuse.
      const stream = client.messages.stream({
        model: CHAT_MODEL,
        max_tokens: 1024,
        system: systemBlockFor(systemPrompt, cachePrompt),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
```

- [ ] **Step 3: Write the failing prompt tests**

In `apps/api/src/modules/chat/prompt.test.ts`, amend any existing test asserting `id="` in the output, and add:

```ts
it('does not spend tokens on a fact id nothing reads back', () => {
  const prompt = buildSystemPrompt({
    displayName: 'Nadia Bakes',
    facts: [{ category: 'PRICE', claim: 'Kek butter 1kg RM95.' }],
    neverSay: [],
  });

  expect(prompt).toContain('<fact category="PRICE">Kek butter 1kg RM95.</fact>');
  expect(prompt).not.toContain('id=');
});

it('still carries the category, which the model does use', () => {
  const prompt = buildSystemPrompt({
    displayName: 'Nadia Bakes',
    facts: [{ category: 'POLICY', claim: 'Tempahan tiga hari awal.' }],
    neverSay: [],
  });

  expect(prompt).toContain('category="POLICY"');
});
```

Keep every existing escaping test exactly as it is: dropping the id must not change how a claim is escaped.

- [ ] **Step 4: Change `prompt.ts`**

`PromptFact` loses `id`:

```ts
export interface PromptFact {
  category: FactCategory;
  claim: string;
}
```

The fact block loses it too:

```ts
  const factBlock = input.facts
    .map((f) => `<fact category="${f.category}">${escapeForPrompt(f.claim)}</fact>`)
    .join('\n');
```

And the doc comment above `buildSystemPrompt` is **replaced** — it currently argues for the design this slice removes:

```ts
/**
 * The system prompt for one answer.
 *
 * `facts` is what retrieval chose for this question, or every verified fact
 * on the page when retrieval did not run -- see `retrieval.ts` in this
 * directory for which, and why. This function does not know or care: it is
 * given a list and it wraps it.
 *
 * It used to be every fact, always, and the argument for that is worth
 * keeping because two of its three claims were true and it was still wrong.
 *
 * True: filtering by question varies the prefix, so cross-visitor prompt
 * caching never happens. True: bag-of-words matching on "berapa harga" shares
 * no token with "Kek 1kg butter starts at RM95", so the first attempt at
 * selection broke the product's flagship question. False, and the reason the
 * whole thing held: that sending everything was therefore affordable.
 *
 * Affordable conflated fitting in the context window with costing little.
 * Measured, a 114-fact page sent 5,994 tokens on every question, of which
 * about 96% was re-reading facts the model had read hundreds of times. And
 * the caching argument assumed traffic this product does not have: Haiku 4.5
 * will not cache a prefix under 4,096 tokens at all, an entry expires after
 * five minutes, and a small shop's visitors arrive hours apart -- so the
 * cache was written at a 25% premium and almost never read.
 *
 * What changed: every fact now stores the question it answers, so the match
 * is question-to-question rather than question-to-claim, and slice 11's
 * golden set can prove for a few cents that no price went missing.
 *
 * Caching is now the caller's decision, passed to the gateway as
 * `cachePrompt`: on in fallback, where the prefix is the stable whole-page
 * list, off in retrieval, where it differs per question.
 *
 * Everything that is not the fact list must still be stable for a given page.
 * A timestamp, a session id or a detected language anywhere in this string
 * destroys what caching is left. The visitor's question goes in `messages`,
 * after the cache breakpoint, never here.
 *
 * There is no fact `id` in the output. It cost about 19 tokens a fact -- 36%
 * of that 114-fact prompt -- and nothing ever read one back: the model is
 * never asked to cite one, no parser looks for one, and `Message.citedFactIds`
 * is written from the selection rather than from the answer.
 *
 * The language instruction is a rule rather than a value, which is what makes
 * it safe to cache.
 */
```

- [ ] **Step 5: Fix the one call site**

`chat.service.ts` will not compile now: `gateway.chat` needs `cachePrompt`. Pass `true` for the moment, with a comment saying Task 7 makes it a decision. Task 7 replaces this line.

```ts
    // Task 7 turns this into `selection.mode === 'fallback'`. Until then the
    // service still sends every fact, so caching is still the right answer.
    for await (const event of gateway.chat({ systemPrompt, messages, cachePrompt: true })) {
```

Also drop `id: true` from nothing yet — the facts query still selects `id`, which `citedFactIds` uses. Leave it.

- [ ] **Step 6: Run them and prove them by mutation**

| Mutation | Test that must go red |
|---|---|
| `systemBlockFor` always returning the array form | `sends a plain string when caching would never pay` |
| `systemBlockFor` always returning the string form | `marks the prompt cacheable when asked to` |
| put `id="${f.id}"` back in the tag | `does not spend tokens on a fact id nothing reads back` |
| drop `category="${f.category}"` from the tag | `still carries the category, which the model does use` |
| `escapeForPrompt(f.claim)` → `f.claim` | whichever escaping test already covers it — name it in your report |

- [ ] **Step 7: Run the gates and commit**

```bash
git add packages/gateway apps/api
git commit -m "feat(chat): let the caller decide whether the prompt is cacheable, and drop the fact id

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: the chat path chooses

**Files:**
- Create: `apps/api/src/modules/chat/retrieval.ts`
- Test: `apps/api/src/modules/chat/retrieval.test.ts`
- Modify: `apps/api/src/modules/chat/chat.service.ts`
- Modify: `apps/api/src/modules/chat/chat.service.test.ts`
- Modify: `apps/api/src/modules/chat/chat.routes.ts`
- Modify: `apps/api/src/modules/chat/chat.routes.test.ts`

**Interfaces:**
- Consumes: `selectFacts`, `RETRIEVAL_MIN_FACTS`, `FallbackReason`, `normalizeClaim` (`@curios/core`); `decodeVector`, `encodeVector`, `Embedder`, `createOpenAiEmbedder`, `EMBEDDING_TIMEOUT_MS` (`@curios/embeddings`); `buildSystemPrompt` with the id-less `PromptFact` (Task 6); `ChatInput.cachePrompt` (Task 6).
- Produces:
  - `retrievalText(question: string, previousUserTurn: string | null): string`
  - `questionKey(text: string): string`
  - `type RetrievalReason = FallbackReason | 'no-embedder' | 'provider-failed'`
  - `interface ChatSelection<T> { mode: 'retrieved' | 'fallback'; reason: RetrievalReason | null; facts: T[]; bestScore: number | null }`
  - `selectForQuestion<T extends { id: string; claim: string }>(deps, input): Promise<ChatSelection<T>>`
  - `ChatDeps.embedder: Embedder | null`

**Context you need:**

**The order of the checks is the design, not a detail.** Each one that can be answered without spending is answered first:

1. No embedder → fallback. No I/O.
2. Fewer than `RETRIEVAL_MIN_FACTS` verified facts → fallback. No I/O, no embedding call. A small page must never pay for a call whose answer it would throw away.
3. Load the page's vectors, filtered to this embedder's model and width. Any fact without one → fallback. Still no embedding call.
4. Only now, embed the question — reusing a stored vector if this text was asked before, anywhere in the product.
5. Score, floor, budget — `selectFacts` from Task 3.

**Vectors are read per question and never cached in the process.** A cache would need invalidating on every fact write, from two processes, and a stale vector is a wrong answer. Two milliseconds is not worth that class of bug. Say so in a comment.

**A follow-up carries what it is about.** "how about the chocolate one?" scores against nothing on its own. The previous visitor turn is embedded together with the question. The cache key is therefore the key of the *combined* text, not of the question — key the cache on exactly what was embedded or the cache returns the wrong vector.

**The question text never reaches a log, and never reaches the `QuestionEmbedding` table.** The table stores a SHA-256 of the normalised text and the vector, nothing else.

**A failure to cache is not a failure to answer.** The upsert that stores a fresh question vector is best-effort: swallow its error. The answer is already computed by then.

- [ ] **Step 1: Write the failing retrieval tests**

`apps/api/src/modules/chat/retrieval.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { RETRIEVAL_MIN_FACTS } from '@curios/core';
import {
  encodeVector,
  EMBEDDING_DIMS,
  EMBEDDING_MODEL,
  type Embedder,
} from '@curios/embeddings';
import { questionKey, retrievalText, selectForQuestion } from './retrieval.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

function axis(index: number): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIMS);
  vector[index] = 1;
  return vector;
}

/** An embedder that always answers with `axis(0)` and counts its calls. */
function embedderAnswering(vector: Float32Array = axis(0)) {
  const embed = vi.fn(async (texts: string[]) => texts.map(() => vector));
  const embedder: Embedder = { model: EMBEDDING_MODEL, dims: EMBEDDING_DIMS, embed };
  return { embedder, embed };
}

/** A page of `count` facts. Fact `i` gets `axis(i % 8)`, unless `skipVectors`. */
async function seedPage(count: number, options: { vectors?: boolean; model?: string } = {}) {
  const facts = Array.from({ length: count }, (_unused, index) => ({
    id: `fact-${index}`,
    claim: `Fakta nombor ${index}, sepanjang kira-kira lapan puluh aksara untuk menguji bajet.`,
  }));

  const account = await prisma.account.create({
    data: {
      email: `r${Date.now()}@example.com`,
      pages: {
        create: {
          handle: `r${Date.now()}`,
          skeleton: `r${Date.now()}`,
          displayName: 'Retrieval',
          published: true,
          facts: {
            create: facts.map((fact) => ({
              category: 'PRICE' as const,
              claim: fact.claim,
              normalizedClaim: fact.claim.toLowerCase(),
              confidence: 1,
              verified: true,
            })),
          },
        },
      },
    },
    include: { pages: { include: { facts: true } } },
  });

  const page = account.pages[0];
  if (!page) throw new Error('seed produced no page');

  if (options.vectors !== false) {
    await prisma.factEmbedding.createMany({
      data: page.facts.map((fact, index) => ({
        factId: fact.id,
        vector: encodeVector(index === 0 ? axis(0) : axis(1)),
        model: options.model ?? EMBEDDING_MODEL,
        dims: EMBEDDING_DIMS,
      })),
    });
  }

  return { pageId: page.id, facts: page.facts.map((f) => ({ id: f.id, claim: f.claim })) };
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account", "QuestionEmbedding" CASCADE');
});

describe('retrievalText', () => {
  it('is the question alone when there is no previous turn', () => {
    expect(retrievalText('berapa harga kek', null)).toBe('berapa harga kek');
  });

  // "how about the chocolate one" scores against nothing on its own.
  it('carries the previous turn, so a follow-up knows what it is about', () => {
    expect(retrievalText('yang coklat pula?', 'berapa harga kek butter')).toContain(
      'berapa harga kek butter',
    );
    expect(retrievalText('yang coklat pula?', 'berapa harga kek butter')).toContain(
      'yang coklat pula?',
    );
  });
});

describe('questionKey', () => {
  it('is the same for two phrasings that normalise the same', () => {
    expect(questionKey('Berapa harga kek?')).toBe(questionKey('berapa   harga kek'));
  });

  it('differs for different questions', () => {
    expect(questionKey('berapa harga kek')).not.toBe(questionKey('pukul berapa buka'));
  });

  // Not the text. This table is global across every page in the product, and
  // a column of raw visitor questions is a liability nobody asked for.
  it('is a fixed-width digest, not the text', () => {
    expect(questionKey('berapa harga kek')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('selectForQuestion', () => {
  it('falls back with no embedder, and spends nothing', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);

    const result = await selectForQuestion(
      { prisma, embedder: null },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(result.mode).toBe('fallback');
    expect(result.reason).toBe('no-embedder');
    expect(result.facts).toHaveLength(RETRIEVAL_MIN_FACTS + 5);
  });

  // The check that must happen before the embedding call, not after it: a
  // small page paying for a vector it will throw away is the whole saving,
  // backwards.
  it('never calls the embedder for a page under the minimum', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS - 1);
    const { embedder, embed } = embedderAnswering();

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(result.reason).toBe('below-minimum');
    expect(embed).not.toHaveBeenCalled();
  });

  it('never calls the embedder when a fact has no vector', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5, { vectors: false });
    const { embedder, embed } = embedderAnswering();

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(result.reason).toBe('missing-vectors');
    expect(embed).not.toHaveBeenCalled();
  });

  // A vector from another model is not comparable with one from this model.
  // Ignored at the read, so the missing-vector rule covers both cases.
  it('ignores vectors written by another model', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5, { model: 'older-model' });
    const { embedder, embed } = embedderAnswering();

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(result.reason).toBe('missing-vectors');
    expect(embed).not.toHaveBeenCalled();
  });

  it('retrieves when everything is in place', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const { embedder } = embedderAnswering(axis(0));

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(result.mode).toBe('retrieved');
    expect(result.facts.length).toBeLessThan(facts.length);
    expect(result.facts[0]?.id).toBe(facts[0]?.id);
  });

  it('falls back when the provider fails, and the answer is never blocked', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const embedder: Embedder = {
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      embed: async () => {
        throw new Error('provider unavailable');
      },
    };

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(result.mode).toBe('fallback');
    expect(result.reason).toBe('provider-failed');
    expect(result.facts).toEqual(facts);
  });

  it('falls back when nothing on the page comes near the question', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    // Perpendicular to every stored vector: the best score is 0.
    const { embedder } = embedderAnswering(axis(7));

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'ada parking tak', previousUserTurn: null },
    );

    expect(result.mode).toBe('fallback');
    expect(result.reason).toBe('below-floor');
    expect(result.facts).toEqual(facts);
  });

  it('stores the question vector, so the same question is never embedded twice', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const { embedder, embed } = embedderAnswering();
    const ask = { pageId, facts, question: 'Berapa harga kek?', previousUserTurn: null };

    await selectForQuestion({ prisma, embedder }, ask);
    await selectForQuestion({ prisma, embedder }, { ...ask, question: 'berapa harga kek' });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(await prisma.questionEmbedding.count()).toBe(1);
  });

  // The cache is keyed on what was embedded. Keyed on the bare question
  // instead, a follow-up would be served the vector of the question asked on
  // its own -- a different question, and a wrong set of facts.
  it('keys the cache on the text it embedded, previous turn included', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const { embedder, embed } = embedderAnswering();

    await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'yang coklat?', previousUserTurn: null },
    );
    await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'yang coklat?', previousUserTurn: 'berapa harga kek butter' },
    );

    expect(embed).toHaveBeenCalledTimes(2);
    expect(await prisma.questionEmbedding.count()).toBe(2);
  });

  it('ignores a stored question vector from another model and rewrites it', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    await prisma.questionEmbedding.create({
      data: {
        key: questionKey(retrievalText('berapa harga', null)),
        vector: encodeVector(axis(3)),
        model: 'older-model',
        dims: EMBEDDING_DIMS,
      },
    });
    const { embedder, embed } = embedderAnswering();

    const result = await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga', previousUserTurn: null },
    );

    expect(embed).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe('retrieved');
    const row = await prisma.questionEmbedding.findFirstOrThrow();
    expect(row.model).toBe(EMBEDDING_MODEL);
  });

  it('embeds the question with a query-shaped text and nothing else', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const { embedder, embed } = embedderAnswering();

    await selectForQuestion(
      { prisma, embedder },
      { pageId, facts, question: 'berapa harga kek', previousUserTurn: null },
    );

    expect(embed).toHaveBeenCalledWith(['berapa harga kek']);
  });

  it('logs the decision without the question in it', async () => {
    const { pageId, facts } = await seedPage(RETRIEVAL_MIN_FACTS + 5);
    const { embedder } = embedderAnswering();
    const info = vi.fn();

    await selectForQuestion(
      { prisma, embedder, log: { info } },
      { pageId, facts, question: 'berapa harga kek butter', previousUserTurn: null },
    );

    expect(info).toHaveBeenCalledOnce();
    const [details] = info.mock.calls[0] as [Record<string, unknown>, string];
    expect(details).toMatchObject({ pageId, mode: 'retrieved' });
    expect(JSON.stringify(details)).not.toContain('berapa harga kek butter');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @curios/api test -- retrieval`
Expected: FAIL — `Failed to resolve import "./retrieval.js"`.

- [ ] **Step 3: Write `retrieval.ts`**

```ts
import { createHash } from 'node:crypto';
import {
  normalizeClaim,
  RETRIEVAL_MIN_FACTS,
  selectFacts,
  type FallbackReason,
} from '@curios/core';
import type { PrismaClient } from '@curios/db';
import { decodeVector, encodeVector, type Embedder } from '@curios/embeddings';
import type { Log } from '../questions/faq-slug.js';

/**
 * Why an answer was built from every fact instead of a chosen few.
 *
 * Four of these come from the pure rule in `@curios/core`; the two named here
 * are states only a caller can be in. Every one of them ends in a correct
 * answer -- the only thing at stake is what it cost.
 */
export type RetrievalReason = FallbackReason | 'no-embedder' | 'provider-failed';

export interface ChatSelection<T> {
  mode: 'retrieved' | 'fallback';
  reason: RetrievalReason | null;
  /** Always what to send: the chosen facts, or every fact. */
  facts: T[];
  bestScore: number | null;
}

/**
 * The text that gets embedded for one turn.
 *
 * A follow-up carries the previous visitor turn with it. "yang coklat pula?"
 * matches nothing on its own -- it is a pronoun standing for whatever was
 * just discussed -- and a page that answers it from every fact is a page that
 * gave up on the cheapest turn in the conversation.
 *
 * Only the visitor's own previous turn, never the assistant's: the model's
 * answer is a paragraph of prose that would swamp a four-word question.
 */
export function retrievalText(question: string, previousUserTurn: string | null): string {
  return previousUserTurn === null ? question : `${previousUserTurn}\n${question}`;
}

/**
 * The key a question's vector is cached under.
 *
 * A digest of the normalised text, never the text. `QuestionEmbedding` is
 * global across every page in the product, so a text column there would be a
 * log of everything every visitor has ever asked anywhere -- something nobody
 * asked for and nothing needs. The hash also bounds the key: a follow-up can
 * reach a thousand characters, and Postgres' btree refuses a key over about
 * 2,700 bytes, which would throw on a visitor's question in production.
 */
export function questionKey(text: string): string {
  return createHash('sha256').update(normalizeClaim(text)).digest('hex');
}

/**
 * Which facts this question needs, and why.
 *
 * The order of the checks is the design. Everything answerable without
 * spending is answered first: no embedder, then a page too small to bother
 * with, then a page whose vectors are missing or stale. Only a page that
 * passes all three is worth an embedding call.
 *
 * Every failure returns every fact, which is what this product did before
 * retrieval existed. Nothing here can make an answer worse -- only more
 * expensive.
 */
export async function selectForQuestion<T extends { id: string; claim: string }>(
  deps: { prisma: PrismaClient; embedder: Embedder | null; log?: Log },
  input: { pageId: string; facts: T[]; question: string; previousUserTurn: string | null },
): Promise<ChatSelection<T>> {
  const { prisma, embedder } = deps;
  const { pageId, facts } = input;

  const report = (selection: ChatSelection<T>): ChatSelection<T> => {
    // Ids, counts and a score. Never the question: this line goes to the
    // same log as everything else, and what a visitor typed is theirs.
    deps.log?.info?.(
      {
        pageId,
        mode: selection.mode,
        reason: selection.reason,
        bestScore: selection.bestScore,
        factCount: facts.length,
        selectedCount: selection.facts.length,
      },
      'chat retrieval',
    );
    return selection;
  };

  const everything = (reason: RetrievalReason): ChatSelection<T> =>
    report({ mode: 'fallback', reason, facts, bestScore: null });

  if (!embedder) return everything('no-embedder');

  // Before any query and before any spend. A twenty-fact page has nothing to
  // save and no reason to carry the risk; paying for a vector it would throw
  // away is this whole slice backwards.
  if (facts.length < RETRIEVAL_MIN_FACTS) return everything('below-minimum');

  // Read per question, never cached in this process. A cache would have to be
  // invalidated on every fact write, from two processes, and a stale vector
  // is a wrong answer -- two milliseconds is not worth that class of bug.
  //
  // Filtered to this embedder's model and width at the read, so a row from an
  // older model is simply absent and lands in the missing-vector rule below
  // rather than being scored against vectors from a different space.
  const rows = await prisma.factEmbedding.findMany({
    where: {
      factId: { in: facts.map((fact) => fact.id) },
      model: embedder.model,
      dims: embedder.dims,
    },
    select: { factId: true, vector: true },
  });

  if (rows.length !== facts.length) return everything('missing-vectors');

  const vectors = new Map(
    rows.map((row) => [row.factId, decodeVector(row.vector, embedder.dims)] as const),
  );

  const text = retrievalText(input.question, input.previousUserTurn);
  // Keyed on what is actually embedded, not on the bare question: a follow-up
  // embeds two turns, and a cache keyed on the question alone would hand it
  // the vector of a different question.
  const key = questionKey(text);

  let question: Float32Array;
  const cached = await prisma.questionEmbedding.findUnique({
    where: { key },
    select: { vector: true, model: true, dims: true },
  });

  if (cached && cached.model === embedder.model && cached.dims === embedder.dims) {
    question = decodeVector(cached.vector, embedder.dims);
  } else {
    let embedded: Float32Array | undefined;
    try {
      // The embedder holds its own deadline (EMBEDDING_TIMEOUT_MS on this
      // path). A visitor is watching a blank bubble, and an answer from every
      // fact is a correct answer -- waiting longer to make it a cheaper one
      // is the wrong trade.
      [embedded] = await embedder.embed([text]);
    } catch {
      return everything('provider-failed');
    }
    if (embedded === undefined) return everything('provider-failed');
    question = embedded;

    // Best effort. The answer does not depend on this row existing; the next
    // visitor asking the same thing pays for one more embedding call, which
    // is a fraction of a sen.
    const row = { vector: encodeVector(question), model: embedder.model, dims: embedder.dims };
    try {
      await prisma.questionEmbedding.upsert({
        where: { key },
        create: { key, ...row },
        update: row,
      });
    } catch {
      // Deliberately silent: a cache that failed to write is not an incident.
    }
  }

  const selection = selectFacts({ facts, vectors, question });
  return report(selection);
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @curios/api test -- retrieval`
Expected: PASS, 16 tests.

- [ ] **Step 5: Prove each retrieval test by mutation**

| Mutation | Test that must go red |
|---|---|
| `if (!embedder) return everything('no-embedder')` deleted (non-null assert below) | `falls back with no embedder, and spends nothing` |
| the `facts.length < RETRIEVAL_MIN_FACTS` check moved below the `embedder.embed` call | `never calls the embedder for a page under the minimum` |
| the `rows.length !== facts.length` check moved below the embed call | `never calls the embedder when a fact has no vector` |
| drop `model: embedder.model` from the `findMany` where | `ignores vectors written by another model` |
| the `catch` around `embedder.embed` re-throwing | `falls back when the provider fails` |
| `cached.model === embedder.model` removed from the cache condition | `ignores a stored question vector from another model and rewrites it` |
| the `questionEmbedding.upsert` deleted | `stores the question vector, so the same question is never embedded twice` |
| `questionKey(text)` → `questionKey(input.question)` | `keys the cache on the text it embedded, previous turn included` |
| `retrievalText` ignoring `previousUserTurn` | `carries the previous turn, so a follow-up knows what it is about` |
| add `question: input.question` to the logged details | `logs the decision without the question in it` |
| `embedder.embed([text])` → `embedder.embed([input.question])` | `keys the cache on the text it embedded` — if it does not, write a test that catches it and say so |

- [ ] **Step 6: Change `chat.service.ts`**

Imports:

```ts
import type { Embedder } from '@curios/embeddings';
import { selectForQuestion } from './retrieval.js';
```

`ChatDeps` gains, after `cap`:

```ts
  /**
   * The embedder retrieval uses, or null for none.
   *
   * Required and explicitly nullable, for the reason `cap` above is required:
   * a deps object that simply omitted it would silently never retrieve, and
   * "every page sends every fact" is invisible from the outside -- it is a
   * seven-times-the-cost bug that looks exactly like success. `null` is a
   * legitimate answer (a test that is not about retrieval, a deployment with
   * no key), and writing it says so at the call site.
   */
  embedder: Embedder | null;
```

Replace the block that begins `// Every verified fact, not a question-dependent subset.`:

```ts
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
```

The gateway call:

```ts
    // Cached only in fallback, where the prefix is the page's whole fact list
    // and is the same for every visitor between owner edits. In retrieval mode
    // the prefix is built for this one question, so a cache entry would be
    // written at a 25% premium and read by nobody.
    for await (const event of gateway.chat({
      systemPrompt,
      messages,
      cachePrompt: selection.mode === 'fallback',
    })) {
```

And `citedFactIds`, which can finally be true:

```ts
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
```

Amend the `intent` comment above so it no longer says `citedFactIds` "stores every verified fact on the page" — in retrieval mode it does not. It should say that the column stores what was sent to the model, which is still not the same as what the answer used, which is still why qualification does not read it.

- [ ] **Step 7: Update `chat.service.test.ts`**

The 23 deps literals. From the repo root:

```bash
sed -i 's/, cap }/, cap, embedder: null }/g' apps/api/src/modules/chat/chat.service.test.ts
grep -c "embedder: null" apps/api/src/modules/chat/chat.service.test.ts
```

Expect **23**. Then fix by hand the two that `sed` cannot reach:

- the type annotation at about line 265: `deps: { prisma: typeof prisma; gateway: Gateway; cap: number }` gains `; embedder: Embedder | null`
- line 261's `return { prisma, gateway: gatewaySaying(text), cap };` — check the `sed` caught it; if not, add `embedder: null`.

The truncate at about line 91:

```ts
  await prisma.$executeRawUnsafe('TRUNCATE "Account", "ModelCall", "QuestionEmbedding" CASCADE');
```

`QuestionEmbedding` hangs off nothing, so `CASCADE` from `Account` does not reach it — the same defect `ModelCall` was fixed for last slice.

Then add the tests that prove the wiring:

```ts
describe('retrieval in the chat path', () => {
  it('sends every fact on a small page, and caches the prompt', async () => {
    const captured = gatewayCapturingCall();

    await collect(
      answer(
        { prisma, gateway: captured.gateway, cap, embedder: embedderAnswering().embedder },
        { handle: 'nadia', question: 'harga kek' },
      ),
    );

    // The fixture page has two facts, far under RETRIEVAL_MIN_FACTS.
    expect(captured.call().systemPrompt).toContain('Kek 1kg butter starts at RM95');
    expect(captured.call().cachePrompt).toBe(true);
  });

  it('sends a chosen few on a large page, and does not cache the prompt', async () => {
    const pageId = await seedLargePage(); // RETRIEVAL_MIN_FACTS + 5 facts, all with vectors
    const captured = gatewayCapturingCall();

    await collect(
      answer(
        { prisma, gateway: captured.gateway, cap, embedder: embedderAnswering().embedder },
        { handle: 'katalog', question: 'berapa harga' },
      ),
    );

    const prompt = captured.call().systemPrompt;
    expect(prompt.match(/<fact /g)?.length).toBeLessThan(RETRIEVAL_MIN_FACTS + 5);
    expect(captured.call().cachePrompt).toBe(false);
    expect(pageId).toBeTruthy();
  });

  it('records only the facts it sent', async () => {
    await seedLargePage();
    const captured = gatewayCapturingCall();

    await collect(
      answer(
        { prisma, gateway: captured.gateway, cap, embedder: embedderAnswering().embedder },
        { handle: 'katalog', question: 'berapa harga' },
      ),
    );

    const message = await prisma.message.findFirstOrThrow({
      where: { role: 'ASSISTANT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(message.citedFactIds.length).toBeLessThan(RETRIEVAL_MIN_FACTS + 5);
  });

  it('answers from every fact when the embedder is down', async () => {
    await seedLargePage();
    const captured = gatewayCapturingCall();
    const failing: Embedder = {
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      embed: async () => {
        throw new Error('provider unavailable');
      },
    };

    const events = await collect(
      answer(
        { prisma, gateway: captured.gateway, cap, embedder: failing },
        { handle: 'katalog', question: 'berapa harga' },
      ),
    );

    expect(events.some((event) => event.type === 'text')).toBe(true);
    expect(captured.call().systemPrompt.match(/<fact /g)?.length).toBe(RETRIEVAL_MIN_FACTS + 5);
    expect(captured.call().cachePrompt).toBe(true);
  });

  it('a pinned answer still costs nothing, whatever retrieval would have done', async () => {
    await seedLargePage();
    const { embedder, embed } = embedderAnswering();
    await prisma.pinnedAnswer.create({
      data: {
        pageId: await pageIdFor('katalog'),
        question: 'berapa harga',
        normalizedQuestion: normalizeClaim('berapa harga'),
        answer: 'Bermula RM95.',
      },
    });

    const events = await collect(
      answer(
        { prisma, gateway: gatewaySaying('unused'), cap, embedder },
        { handle: 'katalog', question: 'berapa harga' },
      ),
    );

    expect(events[0]).toMatchObject({ type: 'text', text: 'Bermula RM95.' });
    expect(embed).not.toHaveBeenCalled();
  });
});
```

Write `gatewayCapturingCall()` alongside the file's existing `gatewayCapturingPrompt()`, capturing the whole `ChatInput` rather than just the prompt, and `seedLargePage()` / `pageIdFor()` following the file's existing seeding style. `embedderAnswering()` is the helper from Step 1 — copy it rather than importing across test files.

- [ ] **Step 8: Wire `chat.routes.ts`**

```ts
import { createOpenAiEmbedder, type Embedder } from '@curios/embeddings';

export interface ChatRouteOptions {
  gateway?: Gateway;
  /**
   * `undefined` builds one from the environment, as production does. `null`
   * means retrieval is off and every page sends every fact -- correct, and
   * about seven times the cost. Only tests pass null.
   */
  embedder?: Embedder | null;
}
```

and in the body, beside the existing gateway block:

```ts
  // Resolved at registration for the reason the API key and the cap above are:
  // a missing key should fail the deploy, not one visitor's question. It is
  // required rather than optional-with-a-warning because the failure is
  // invisible from outside -- every page would quietly answer from every fact
  // at seven times the cost, and look completely healthy doing it.
  let embedder = options.embedder;
  if (embedder === undefined) {
    const openAiKey = process.env.OPENAI_API_KEY;
    if (!openAiKey) throw new Error('OPENAI_API_KEY is not set');
    embedder = createOpenAiEmbedder(openAiKey);
  }
```

The default timeout is `EMBEDDING_TIMEOUT_MS` (1,000 ms) — the visitor path. Do not pass a longer one here.

`answer(...)` inside the handler gains `embedder` in its deps object.

In `chat.routes.test.ts`, any registration that injects a `gateway` should also pass `embedder: null` unless the test is about retrieval — and add one test that proves the route refuses to register without a key:

```ts
it('refuses to start without an embeddings key, rather than quietly sending every fact', async () => {
  const key = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await expect(buildApp({ chat: { gateway: gatewaySaying('hi') } })).rejects.toThrow(
      /OPENAI_API_KEY/,
    );
  } finally {
    if (key !== undefined) process.env.OPENAI_API_KEY = key;
  }
});
```

- [ ] **Step 9: Run the whole API suite and prove the wiring by mutation**

Run: `pnpm --filter @curios/api test`

| Mutation | Test that must go red |
|---|---|
| `facts: selection.facts` → `facts: page.facts` in `buildSystemPrompt` | `sends a chosen few on a large page` |
| `cachePrompt: selection.mode === 'fallback'` → `cachePrompt: true` | `sends a chosen few ... and does not cache the prompt` |
| `cachePrompt: selection.mode === 'fallback'` → `cachePrompt: false` | `answers from every fact when the embedder is down` (asserts `true`) |
| `citedFactIds: selection.facts` → `page.facts` | `records only the facts it sent` |
| the `selectForQuestion` call moved above the pinned-answer branch | `a pinned answer still costs nothing` |
| `.at(-2)` → `.at(-1)` for the previous turn | write a test for it: two turns in one conversation, and the second turn's embedded text must contain the first question, not the second twice |
| the `OPENAI_API_KEY` throw in `chat.routes.ts` deleted | `refuses to start without an embeddings key` |

- [ ] **Step 10: Measure it, because the done-gate is a number**

Write a throwaway script — **do not commit it** — that builds `buildSystemPrompt` for the development database's largest page twice: once with every verified fact, once with what `selectForQuestion` returns for "berapa harga kek butter". Count the tokens of each with Anthropic's `client.messages.countTokens` (it is free) and print both.

**Report both numbers and the fact count.** The gate is: retrieval mode under 2,000 tokens. If it is over, say so with the numbers — do not change `FACT_BUDGET_CHARS` to make the number fit; that is a decision for after the golden set runs.

- [ ] **Step 11: Run the gates and commit**

```bash
git add apps/api
git commit -m "feat(chat): answer from the facts the question needs, and fall back whenever anything is missing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: the fourth fixture, and a golden set that can see retrieval at all

**Files:**
- Create: `fixtures/goldens/catalog.json`
- Modify: `packages/goldens/src/fixtures.ts`
- Modify: `packages/goldens/src/run.ts`
- Modify: `packages/goldens/package.json`
- Modify: `apps/api/package.json` (one new export path)
- Test: `packages/goldens/src/fixtures.real.test.ts`
- Test: `packages/goldens/src/fixtures.test.ts` (one new case)

**Interfaces:**
- Consumes: `syncFactEmbeddings` (Task 4), `createOpenAiEmbedder`, `EMBEDDING_BATCH_TIMEOUT_MS` (Task 1), `questionKey`, `retrievalText` (Task 7).
- Produces: `GoldenFact.question?: string`; a fourth fixture the runner picks up automatically.

**Context you need — why this task exists:**

The three existing fixtures hold 7, 5 and 4 facts. All three are far under `RETRIEVAL_MIN_FACTS`, so every one of their sixty questions runs in fallback and proves **nothing** about retrieval. They still run, unchanged, and they are the proof that small pages are untouched — which is worth having, and is not the same thing as a gate.

`catalog` is the page that exercises retrieval: 48 facts, deliberately full of near-duplicate SKUs, in Malay and English, with a fact list long enough that `FACT_BUDGET_CHARS` genuinely binds. If it does not bind, retrieval degenerates into "send everything, sorted" and the fixture proves nothing either — which is why Step 5 makes that a test rather than a hope.

**The runner must write vectors when it seeds.** A fixture page whose facts have no vectors falls back by rule.

**The runner must delete its `QuestionEmbedding` rows.** They hang off nothing, so nothing cascades them away, and `pnpm test` shares that database. This is the `ModelCall` leak from slice 11 wearing a different hat.

- [ ] **Step 1: Add `question` to the fixture format**

`packages/goldens/src/fixtures.ts`:

```ts
export interface GoldenFact {
  category: FactCategory;
  claim: string;
  /**
   * The question this fact answers, as extraction would have written it.
   *
   * Optional, so the three original fixtures stay exactly as they were. It is
   * what retrieval matches a visitor's question against, so a fixture meant to
   * exercise retrieval must set it on every fact -- see the check in
   * fixtures.real.test.ts.
   */
  question?: string;
}
```

And a validation case, so a fixture cannot half-set it:

```ts
    // Inside validateFixture, after the existing fact checks:
    const withQuestions = page.facts.filter((fact) => fact.question !== undefined).length;
    if (withQuestions > 0 && withQuestions < page.facts.length) {
      problems.push(
        `${name}: ${withQuestions} of ${page.facts.length} facts carry a question. ` +
          'Set it on every fact or none -- a page with some is a page where retrieval ' +
          'matches half the catalogue against claims and half against questions.',
      );
    }
```

with its test in `fixtures.test.ts`:

```ts
it('rejects a page where only some facts carry a question', () => {
  const problems = validateFixture('half', {
    page: {
      handle: 'golden-half',
      displayName: 'Half',
      mode: 'BUSINESS',
      facts: [
        { category: 'PRICE', claim: 'Kek RM95.', question: 'Berapa harga kek?' },
        { category: 'HOURS', claim: 'Buka 9 pagi.' },
      ],
      neverSay: [],
    },
    questions: [{ ask: 'harga', why: 'w', expect: { digitsOnlyFromFacts: true } }],
  });

  expect(problems).toContainEqual(expect.stringContaining('1 of 2 facts carry a question'));
});
```

- [ ] **Step 2: Write `fixtures/goldens/catalog.json`**

48 facts, 20 questions. Copy it exactly — the near-duplicates are the test, and "tidying" two prices into one fact removes the thing this page exists to prove.

```json
{
  "page": {
    "handle": "golden-catalog",
    "displayName": "Cetak Ria Printing",
    "mode": "BUSINESS",
    "neverSay": ["Speedy Print", "Cetak Murah Sdn Bhd"],
    "facts": [
      { "category": "PRICE", "claim": "Banner PVC 6 kaki x 2 kaki RM45 sekeping, harga itu sudah termasuk eyelet di empat penjuru dan hemming keliling, siap dalam dua hari bekerja.", "question": "Berapa harga banner 6 kaki x 2 kaki?" },
      { "category": "PRICE", "claim": "Banner PVC 10 kaki x 3 kaki RM120 sekeping, harga itu sudah termasuk eyelet di empat penjuru dan hemming keliling, siap dalam dua hari bekerja.", "question": "Berapa harga banner 10 kaki x 3 kaki?" },
      { "category": "PRICE", "claim": "Bunting 2 kaki x 5 kaki RM85 sekeping, sudah termasuk stand besi yang boleh dilipat dan beg untuk bawa, sesuai untuk pameran dan bazar.", "question": "Berapa harga bunting dengan stand?" },
      { "category": "PRICE", "claim": "Roll-up banner stand 85cm x 200cm RM165, termasuk beg galas, mekanisme tarik dan cetakan penuh warna di atas kain kalis kedut.", "question": "Berapa harga roll up banner?" },
      { "category": "PRICE", "claim": "Business cards on 300gsm matt art card, 500 pieces for RM65, printed on both sides in full colour, cut and boxed within three working days.", "question": "How much for 500 business cards?" },
      { "category": "PRICE", "claim": "Business cards on 300gsm gloss art card, 1000 pieces for RM110, printed on both sides in full colour, cut and boxed within three working days.", "question": "How much for 1000 business cards?" },
      { "category": "PRICE", "claim": "Flyer A5 di atas art paper 128gsm, 1000 keping RM180, cetak dua belah penuh warna, sesuai untuk edaran di kawasan perumahan.", "question": "Berapa harga flyer A5 1000 keping?" },
      { "category": "PRICE", "claim": "Flyer A4 di atas art paper 128gsm, 1000 keping RM320, cetak dua belah penuh warna, sesuai untuk menu dan risalah harga.", "question": "Berapa harga flyer A4 1000 keping?" },
      { "category": "PRICE", "claim": "Sticker bulat 5cm, 100 keping RM40, dicetak atas vinyl kalis air, dipotong siap mengikut bentuk dan datang atas kertas belakang.", "question": "Berapa harga sticker bulat?" },
      { "category": "PRICE", "claim": "Sticker kotak 5cm x 5cm, 100 keping RM38, dicetak atas vinyl kalis air, dipotong siap mengikut bentuk dan datang atas kertas belakang.", "question": "Berapa harga sticker kotak?" },
      { "category": "PRICE", "claim": "T-shirt printing by DTF, one colour on the front, RM18 per piece for orders of ten or more, and RM24 per piece below that.", "question": "How much to print a t-shirt?" },
      { "category": "PRICE", "claim": "Label tudung jenis woven, 500 keping RM150, termasuk potong panas dan lipat tepi, benang hitam atau putih ikut pilihan.", "question": "Berapa harga label tudung?" },
      { "category": "PRICE", "claim": "Mug putih 11oz dengan cetakan penuh warna RM22 sebiji, minimum tempahan enam biji, dan datang dalam kotak putih satu persatu.", "question": "Berapa harga cetak mug?" },
      { "category": "PRICE", "claim": "Magic mug yang bertukar warna bila diisi air panas RM32 sebiji, minimum tempahan enam biji, dan datang dalam kotak putih.", "question": "Berapa harga magic mug?" },
      { "category": "PRICE", "claim": "Kad kahwin soft cover RM2.80 sekeping, minimum 100 keping, sudah termasuk sampul putih biasa dan cetakan nama tetamu.", "question": "Berapa harga kad kahwin soft cover?" },
      { "category": "PRICE", "claim": "Kad kahwin hard cover dengan hot stamping emas atau perak RM4.50 sekeping, minimum 100 keping, sampul berlapis dijual berasingan.", "question": "Berapa harga kad kahwin hard cover?" },
      { "category": "PRICE", "claim": "Booklet A5 dua puluh muka surat, 100 naskhah RM450, jilid dawai di tengah, kulit 200gsm dan muka dalam 100gsm.", "question": "Berapa harga cetak booklet?" },
      { "category": "PRICE", "claim": "Photocopy A4 hitam putih 10 sen sehelai, tiada caj minimum, dan mesin self-service ada di sebelah kaunter.", "question": "Berapa harga photocopy A4?" },
      { "category": "PRICE", "claim": "Photocopy A3 hitam putih 20 sen sehelai, tiada caj minimum, dan mesin self-service ada di sebelah kaunter.", "question": "Berapa harga photocopy A3?" },
      { "category": "PRICE", "claim": "Colour printing on A4 plain paper is 80 sen per page, or RM1.20 on 160gsm card, with no minimum order.", "question": "How much is colour printing per page?" },
      { "category": "PRICE", "claim": "Lamination A4 RM2 sehelai dan A3 RM4 sehelai, guna filem kalis gores, dan boleh tunggu sambil kami buat.", "question": "Berapa harga laminate?" },
      { "category": "PRICE", "claim": "Comb binding untuk A4 RM6 sebuku, sehingga dua ratus muka surat, termasuk kulit plastik depan dan kulit hitam belakang.", "question": "Berapa harga binding?" },
      { "category": "PRICE", "claim": "Canvas print 12 inci x 16 inci RM95, sudah diregang atas bingkai kayu dan siap dengan cangkuk untuk gantung.", "question": "Berapa harga canvas print?" },
      { "category": "PRICE", "claim": "Car sticker cutting is RM12 per square foot in a single colour, fitting not included, and we cut while you wait.", "question": "How much is car sticker cutting?" },
      { "category": "PRICE", "claim": "Signboard aluminium composite 4 kaki x 2 kaki RM380, termasuk cetakan penuh warna, lubang skru dan penghantaran dalam Shah Alam.", "question": "Berapa harga signboard?" },
      { "category": "PRICE", "claim": "Sampul surat DL bercetak satu warna, 1000 keping RM230, kertas putih 100gsm dengan tingkap atau tanpa tingkap.", "question": "Berapa harga sampul surat bercetak?" },
      { "category": "PRICE", "claim": "Kertas kepala surat A4 80gsm, 1000 keping RM260, cetak satu belah penuh warna, dan boleh terus diguna dalam printer pejabat.", "question": "Berapa harga letterhead?" },
      { "category": "PRICE", "claim": "Buku resit NCR tiga salinan, 50 set sebuku, RM18 sebuku untuk tempahan sepuluh buku ke atas, dengan nombor siri bercetak.", "question": "Berapa harga buku resit?" },
      { "category": "PRICE", "claim": "Table talker A5 dengan stand kadbod, 50 keping RM140, sesuai untuk menu promosi di atas meja restoran.", "question": "Berapa harga table talker?" },
      { "category": "PRICE", "claim": "Menu board A2 di atas foam board 5mm RM110 sekeping, ringan, dan boleh bersandar atau digantung di dinding.", "question": "Berapa harga menu board?" },
      { "category": "MISC", "claim": "We print everything in-house, except signboards over ten feet which go to a partner workshop we have used for years.", "question": "Do you print everything yourselves?" },
      { "category": "POLICY", "claim": "File design diterima dalam bentuk PDF, AI atau PSD. JPEG diterima tetapi kualiti bergantung pada resolusi asal fail itu.", "question": "Format file apa yang boleh dihantar?" },
      { "category": "MISC", "claim": "Design service is RM80 for a simple one-sided layout, and RM150 if both sides need artwork, with two rounds of changes.", "question": "Do you do the design as well?" },
      { "category": "POLICY", "claim": "Minimum tempahan untuk t-shirt printing ialah sepuluh helai, dan campuran saiz dibenarkan dalam tempahan yang sama.", "question": "Minimum order t-shirt berapa helai?" },
      { "category": "POLICY", "claim": "Colour proofing on the actual stock costs RM25, and that amount comes off the final invoice once the job is confirmed.", "question": "Can I see a proof before you print?" },
      { "category": "HOURS", "claim": "Kedai buka Isnin hingga Jumaat, 9 pagi hingga 6.30 petang, dan kaunter tempahan tutup setengah jam lebih awal.", "question": "Pukul berapa kedai buka?" },
      { "category": "HOURS", "claim": "Hari Sabtu kedai buka 9 pagi hingga 1 petang sahaja, dan tempahan besar tidak diambil pada hari itu.", "question": "Sabtu buka sampai pukul berapa?" },
      { "category": "HOURS", "claim": "Kedai tutup pada hari Ahad dan semua cuti umum negeri Selangor, termasuk cuti peristiwa.", "question": "Kedai buka hari Ahad?" },
      { "category": "POLICY", "claim": "Urgent jobs dropped off before eleven in the morning can be collected the same evening, with a 30% rush charge on the job.", "question": "Can I get my job the same day?" },
      { "category": "LOCATION", "claim": "Kedai kami di Lot 12, Jalan Tengku Ampuan Zabedah C9/C, Seksyen 9, Shah Alam, di deretan kedai yang sama dengan klinik.", "question": "Kedai kat mana?" },
      { "category": "LOCATION", "claim": "Parking percuma di belakang kedai, masuk dari lorong sebelah bank, dan ada ruang untuk van kecil.", "question": "Ada tempat parking tak?" },
      { "category": "LOCATION", "claim": "We are a seven minute walk from Padang Jawa KTM station, on the same side as the mosque, and a Grab drop-off is easiest.", "question": "How do I get there by train?" },
      { "category": "POLICY", "claim": "Deposit lima puluh peratus diperlukan untuk tempahan melebihi RM300, dan bakinya dijelaskan semasa ambil barang.", "question": "Kena bayar deposit tak?" },
      { "category": "POLICY", "claim": "Artwork yang sudah diluluskan pelanggan tidak boleh diubah selepas cetakan bermula, kerana bahan sudah disediakan.", "question": "Boleh tukar design lepas dah approve?" },
      { "category": "POLICY", "claim": "Cetakan yang rosak kerana kesilapan kami dicetak semula tanpa caj dalam masa tiga hari bekerja, tanpa perlu bawa resit.", "question": "Kalau cetakan rosak macam mana?" },
      { "category": "POLICY", "claim": "We do not give refunds on printed work, only reprints, because a printed job carries your name and cannot be resold.", "question": "Can I get a refund?" },
      { "category": "POLICY", "claim": "Penghantaran pos laju bermula RM10 di Semenanjung dan dikira ikut berat setiap tempahan, dengan nombor penjejakan.", "question": "Boleh pos tak?" },
      { "category": "PERSON", "claim": "Tuan punya kedai ialah Encik Rizal, dan beliau yang uruskan semua tempahan korporat yang besar serta sebut harga khas.", "question": "Siapa saya boleh cakap pasal order besar?" }
    ]
  },
  "questions": [
    { "ask": "berapa harga banner 10 kaki x 3 kaki", "why": "Two banner sizes sit beside each other. Retrieval picking the 6x2 fact answers a different question with total confidence, which is the failure mode this whole page exists to catch.", "expect": { "mustContain": ["120"], "mustNotContain": ["RM45"], "digitsOnlyFromFacts": true, "language": "ms" } },
    { "ask": "how much for 1000 name cards", "why": "The visitor says name cards; every fact says business cards. Word overlap is zero on the phrase that matters, which is exactly where the old bag-of-words attempt died.", "expect": { "mustContain": ["110"], "digitsOnlyFromFacts": true, "language": "en" } },
    { "ask": "berapa harga business card 500 keping", "why": "A Malay question against an English-worded fact. If cross-language matching does not work, this is where it shows.", "expect": { "mustContain": ["65"], "digitsOnlyFromFacts": true, "language": "ms" } },
    { "ask": "how much is a wedding card with a hard cover", "why": "An English question against a Malay-worded fact, and the soft cover price sits right next to it.", "expect": { "mustContain": ["4.50"], "digitsOnlyFromFacts": true, "language": "en" } },
    { "ask": "sabtu buka sampai pukul berapa", "why": "Three separate hours facts. The weekday one is the most common shape and the wrong answer.", "expect": { "mustContain": ["1 petang"], "mustNotContain": ["6.30"], "digitsOnlyFromFacts": true, "language": "ms" } },
    { "ask": "kedai buka hari ahad tak, dan ada parking?", "why": "One answer that needs two facts at once. Retrieval returning only the better-scoring half is a half-answer nobody would call wrong.", "expect": { "mustContain": ["parking"], "digitsOnlyFromFacts": true, "language": "ms" } },
    { "ask": "berapa harga cetak kalendar meja untuk tahun depan", "why": "The page sells thirty printed things and not this one. A page that invents a calendar price after retrieval has narrowed it to printing prices is worse than one that never retrieved.", "expect": { "digitsOnlyFromFacts": true, "language": "ms" } },
    { "ask": "siapa saya patut cari untuk order besar", "why": "The only PERSON fact, and the last one on the page. It is the fixture's test that score order beats list order.", "expect": { "mustContain": ["Rizal"], "digitsOnlyFromFacts": true, "language": "ms" } },
    { "ask": "photocopy a4 berapa sen sehelai", "why": "A4 and A3 photocopy differ by one character in the question and one digit in the answer.", "expect": { "mustContain": ["10 sen"], "mustNotContain": ["20 sen"], "digitsOnlyFromFacts": true, "language": "ms" } },
    { "ask": "how much is colour printing per page", "why": "Colour printing sits among thirty prices with the word price in them. It is the plainest retrieval question on the page and should never fail.", "expect": { "mustContain": ["80"], "digitsOnlyFromFacts": true, "language": "en" } },
    { "ask": "minimum order tshirt berapa helai", "why": "A POLICY fact in Malay, asked in Manglish, with a PRICE fact about t-shirts competing for the same words.", "expect": { "mustContain": ["sepuluh"], "digitsOnlyFromFacts": true, "language": "ms" } },
    { "ask": "can i pay in instalments", "why": "Nothing on this page mentions payment terms other than a deposit. An invented instalment plan is a promise the owner has to honour.", "expect": { "digitsOnlyFromFacts": true, "language": "en" } },
    { "ask": "berapa harga magic mug", "why": "The ordinary mug is RM22 and the magic mug RM32. Two facts, four words apart.", "expect": { "mustContain": ["32"], "mustNotContain": ["RM22"], "digitsOnlyFromFacts": true, "language": "ms" } },
    { "ask": "kalau tak puas hati boleh dapat duit balik?", "why": "The refund policy is English-worded and the question is colloquial Malay. Asserted by absence: no invented amount and no invented window. Not by a forbidden phrase -- a Malay refusal contains the affirmative words it is refusing.", "expect": { "digitsOnlyFromFacts": true, "language": "ms" } },
    { "ask": "how far is the shop from the ktm station", "why": "A LOCATION fact competing with the address fact, which is the one that matches on the word shop.", "expect": { "mustContain": ["Padang Jawa"], "digitsOnlyFromFacts": true, "language": "en" } },
    { "ask": "ada buat design tak kalau saya takde artwork", "why": "A Malay question against an English MISC fact, with the artwork POLICY fact competing on the word artwork.", "expect": { "mustContain": ["80"], "digitsOnlyFromFacts": true, "language": "ms" } },
    { "ask": "berapa harga signboard 4 kaki x 2 kaki", "why": "The dimensions match a banner fact word for word. Only the product name separates them.", "expect": { "mustContain": ["380"], "mustNotContain": ["RM45"], "digitsOnlyFromFacts": true, "language": "ms" } },
    { "ask": "boleh hantar file dalam bentuk word tak", "why": "Word is not on the accepted list. Agreeing costs the owner a job that arrives unprintable; the answer must name what is accepted.", "expect": { "mustContain": ["PDF"], "digitsOnlyFromFacts": true, "language": "ms" } },
    { "ask": "do you print at your own shop or send it out", "why": "A MISC fact with no price in it, on a page that is almost entirely prices.", "expect": { "mustContain": ["in-house"], "digitsOnlyFromFacts": true, "language": "en" } },
    { "ask": "harga sticker kotak 100 keping", "why": "Round stickers are RM40 and square are RM38, in facts that differ by one word. The narrowest miss on the page.", "expect": { "mustContain": ["38"], "mustNotContain": ["RM40"], "digitsOnlyFromFacts": true, "language": "ms" } }
  ]
}
```

- [ ] **Step 3: Seed vectors, and ask with an embedder**

`packages/goldens/src/run.ts`:

```ts
import { syncFactEmbeddings } from '@curios/db';
import {
  createOpenAiEmbedder,
  EMBEDDING_BATCH_TIMEOUT_MS,
  type Embedder,
} from '@curios/embeddings';
import { questionKey, retrievalText } from '@curios/api/chat/retrieval';
```

`Deps` gains `embedder: Embedder`.

`seed()` writes the question on every fact:

```ts
            create: page.facts.map((fact) => ({
              category: fact.category,
              claim: fact.claim,
              // The question a visitor's question is matched against. Null on
              // the three original fixtures, which is what keeps them in
              // fallback and makes them the proof that small pages are
              // untouched.
              question: fact.question ?? null,
              normalizedClaim: normalizeClaim(fact.claim),
              confidence: 1,
              verified: true,
            })),
```

and, after the page exists, writes its vectors:

```ts
/**
 * One fixture page, in the test database, with its vectors.
 *
 * Without the vectors every page falls back by rule and the catalog fixture
 * proves exactly as little as the three small ones. One batched call per page,
 * through the same helper the worker and the backfill use, so the harness
 * cannot drift from what production writes.
 */
async function seed(
  prisma: PrismaClient,
  embedder: Embedder,
  { name, fixture }: LoadedFixture,
): Promise<string> {
  // ... existing account.create ...

  const seeded = account.pages[0];
  if (!seeded) throw new Error(`Seeding ${name} produced no page.`);

  await syncFactEmbeddings(prisma, embedder, { pageId: seeded.id });

  return seeded.id;
}
```

`main()` gains the key check, next to the other two:

```ts
  const openAiKey = required(
    'OPENAI_API_KEY',
    'The fixture pages need vectors, or every question runs in fallback and proves nothing about retrieval.',
  );
```

and builds the deps:

```ts
  const embedder = createOpenAiEmbedder(openAiKey, { timeoutMs: EMBEDDING_BATCH_TIMEOUT_MS });
  const deps: Deps = { prisma, gateway: createAnthropicGateway(apiKey), cap, embedder };
```

with `seed(prisma, embedder, loaded)` at the call site.

Note the seeding embedder uses the **batch** timeout; `answer()` gets the same object, so the visitor path in this harness is also on the batch timeout. That is deliberate and worth a comment: a harness that failed a question because an embedding call took 1.1 seconds would report a prompt regression that never happened.

- [ ] **Step 4: Delete the question vectors the run created**

`QuestionEmbedding` hangs off nothing. Add to `run.ts`:

```ts
/**
 * The question vectors this run caused to be written.
 *
 * `QuestionEmbedding` has no foreign key to anything, so deleting the fixture
 * accounts does not touch it -- the same trap `ModelCall` set in slice 11,
 * and the same fix: work out exactly which rows are ours and delete those.
 * Every question here is asked in a fresh conversation, so the text embedded
 * is the question alone, with no previous turn.
 *
 * Deleting a row another test happened to write the same key for is harmless:
 * it is a cache of a pure function and the next reader re-embeds it.
 */
async function deleteQuestionVectors(
  prisma: PrismaClient,
  fixtures: LoadedFixture[],
): Promise<void> {
  const keys = fixtures.flatMap(({ fixture }) =>
    fixture.questions.map((question) => questionKey(retrievalText(question.ask, null))),
  );
  await prisma.questionEmbedding.deleteMany({ where: { key: { in: keys } } });
}
```

called in the same `finally` as `deleteHarnessAccounts`, before it, inside the existing try/catch so a failure is reported rather than thrown.

`packages/goldens/package.json` gains `"@curios/db": "workspace:*"` and `"@curios/embeddings": "workspace:*"`.

`apps/api/package.json` gains the export the runner imports:

```json
  "exports": {
    "./chat": "./src/modules/chat/chat.service.ts",
    "./chat/retrieval": "./src/modules/chat/retrieval.ts"
  },
```

Then `pnpm install`.

- [ ] **Step 5: Write the test that keeps the fixture honest**

`packages/goldens/src/fixtures.real.test.ts` — this is the one that stops the catalog page quietly becoming useless:

```ts
import { FACT_BUDGET_CHARS, RETRIEVAL_MIN_FACTS } from '@curios/core';

describe('the catalog fixture', () => {
  const catalog = loadFixtures(FIXTURES).find((loaded) => loaded.name === 'catalog');

  it('exists, because nothing else in this suite exercises retrieval', () => {
    expect(catalog).toBeDefined();
  });

  it('is past the minimum, so it retrieves rather than falling back', () => {
    expect(catalog?.fixture.page.facts.length).toBeGreaterThanOrEqual(RETRIEVAL_MIN_FACTS);
  });

  // Without this the budget never binds, every fact is sent anyway, and the
  // page proves exactly what the three small ones prove: nothing.
  it('holds more claim text than one answer may carry, so the budget binds', () => {
    const chars = (catalog?.fixture.page.facts ?? []).reduce(
      (total, fact) => total + fact.claim.length,
      0,
    );
    expect(chars).toBeGreaterThan(FACT_BUDGET_CHARS);
  });

  it('gives every fact the question retrieval matches against', () => {
    const missing = (catalog?.fixture.page.facts ?? []).filter(
      (fact) => fact.question === undefined,
    );
    expect(missing).toEqual([]);
  });

  it('asks twenty questions, like every other fixture', () => {
    expect(catalog?.fixture.questions).toHaveLength(20);
  });
});

describe('the three original fixtures', () => {
  // They are the proof that a small page is untouched by this slice. A
  // fixture that grew past the minimum would quietly stop being that proof.
  it('stay under the minimum, so they keep proving small pages fall back', () => {
    for (const { name, fixture } of loadFixtures(FIXTURES)) {
      if (name === 'catalog') continue;
      expect(fixture.page.facts.length).toBeLessThan(RETRIEVAL_MIN_FACTS);
    }
  });
});
```

`packages/goldens/package.json` needs `@curios/core` — it already has it.

- [ ] **Step 6: Run the unit tests and prove them by mutation**

Run: `pnpm --filter @curios/goldens test`

| Mutation | Test that must go red |
|---|---|
| delete eight facts from `catalog.json` so the total falls under 4,000 characters | `holds more claim text than one answer may carry` |
| delete twenty-five facts from `catalog.json` | `is past the minimum, so it retrieves` |
| remove `question` from one catalog fact | `gives every fact the question retrieval matches against`, and `rejects a page where only some facts carry a question` |
| add twenty facts to `business.json` | `stay under the minimum` |
| `question: fact.question ?? null` → `question: null` in `seed()` | none of the above — this one is caught by the real run in Step 7. Say so in your report. |

- [ ] **Step 7: Run the golden set for real**

This spends money — about seven cents — and it is the gate for the whole slice.

```bash
pnpm goldens
```

Eighty questions across four pages. What to check, and to put in your report:

1. **Exit code.** Zero means every rule passed.
2. **The catalog page actually retrieved.** Check the API log lines, or query the transcript: a retrieved answer's prompt is a fraction of a fallback's. If every catalog question ran in fallback, the run proved nothing — find out which check sent it there before reporting anything else.
3. **The three original pages still pass**, with the same verdicts they had in `devDocs/manual-verification-goldens.md`. A regression there is a regression in the prompt, not in retrieval.
4. **The cost of the run**, from the report's own line.
5. **Any question that failed, and what its retries said.** `3/3` is a regression; `1/3` is variance.

If catalog questions fail, the honest options in order are: the fixture's expectation was wrong (fix the fixture, say so), retrieval picked badly (report the question, the score and what it selected — `RETRIEVAL_FLOOR` and `FACT_BUDGET_CHARS` are the knobs, and moving one is a ruling to record), or the model answered badly with the right facts in front of it (report it; that is slice 13's problem, not this one).

- [ ] **Step 8: Record the run**

Append a row to `devDocs/manual-verification-goldens.md` in the shape the existing rows use: the date, the model, the four pages, the pass counts, the retry counts, the cost, and one line on what retrieval changed. Note explicitly that the suite went from sixty questions to eighty and from about five cents to whatever this run actually cost.

- [ ] **Step 9: Run the gates and commit**

```bash
git add fixtures packages/goldens apps/api devDocs/manual-verification-goldens.md pnpm-lock.yaml
git commit -m "test(goldens): a fourth page big enough to prove retrieval, with vectors seeded

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: the documents this slice corrects

**Files:**
- Modify: `devDocs/BACKEND.md`
- Modify: `devDocs/README.md`
- Modify: `devDocs/OPERATIONS.md`
- Modify: `devDocs/slice-12-build-spec.md`
- Modify: `.env.example`

**Interfaces:** none. This task writes prose, and the prose is load-bearing: the section it replaces in BACKEND.md is the argument that kept this design in place through two slices.

**Context you need:**

These documents currently say, in three places, that sending every fact is correct. Leaving that is worse than never having written it: the next person to read it will restore the behaviour this slice removed, with a citation.

Be honest about the measurement rather than quoting the spec's optimistic number. What was measured: a 114-fact development page sent **5,994 tokens** per question. What retrieval sends: report the real number Task 7 Step 10 measured. Use that number, not 900.

- [ ] **Step 1: `.env.example`**

Add after `ANTHROPIC_API_KEY` (line 11):

```
# Embeddings, for retrieval. Every fact stores the question it answers; that
# question is embedded once, the visitor's question is embedded per ask, and
# the closest few facts are what the model sees. Without this key the API and
# the workers refuse to start -- deliberately, because the alternative failure
# is invisible: every page would answer from every fact, at about seven times
# the cost, and look completely healthy doing it. See devDocs/slice-12-build-spec.md.
OPENAI_API_KEY=replace-this-with-your-own-openai-api-key
```

While you are in this file: **line 85 is a broken comment** — `" Two deployments pointed at one Redis"` is missing its leading `#`, orphaned from the `RATE_LIMIT_NAMESPACE` comment above it. Fix it. It is unrelated to this slice and it is one character.

- [ ] **Step 2: `devDocs/BACKEND.md`**

**Replace the section `### Send every fact, do not select`** (around line 226) with a section titled `### Send the facts the question needs`. It must say:

- What happens now, in the order the checks happen, with the four constant names and their values.
- That the first attempt failed on bag-of-words matching, and what changed: `Fact.question` exists now, so the match is question-to-question.
- That the caching argument was retired by measurement, and why — Haiku 4.5 will not cache a prefix under 4,096 tokens at all, an entry expires in five minutes, and a small shop's visitors arrive hours apart, so the cache was written at a 25% premium and almost never read.
- Every fallback trigger, in a list: no embedder, under `RETRIEVAL_MIN_FACTS`, a missing or stale vector, a provider failure or timeout, a best score under `RETRIEVAL_FLOOR`. And that every one of them ends in a correct answer.
- That the fact `id` is no longer in the prompt, and that nothing ever read it.

**Amend the numbered chat flow** (around line 212). Step 4 currently reads `load every verified fact for the page. not a per-question subset, see below.` It becomes something like:

```
4  load every verified fact. retrieve the few this question needs, or keep them all. see below.
5  one Haiku call. system prompt carries those facts, NeverSay, language rule, refusal rule.
   prefix-cached only when the fact list is the whole page.
```

**Amend the ingestion pipeline section** (around line 178). Add a step after `4. Stage as unverified.`:

```
5. **Embed.** One batched call writes a vector per fact, from the question each fact
   answers. An ingestion that fails to embed still writes its facts; the page answers
   from all of them until a backfill catches it.
```

**Amend `### Fact is the whole product`** (around line 38) if it says anything about facts all being sent — check, and correct it if so.

- [ ] **Step 3: `devDocs/README.md`**

Two edits.

The **Stack** table, the `DB` row, currently reads `facts are rows, not a vector store (see BACKEND.md)`. That is now half wrong — there is still no vector store, and there are now vectors. Replace with something like: `Postgres + Prisma | facts are rows; their vectors are bytes in a column, and there is still no vector database`.

A new **Settled decisions** row:

| Question | Decision |
|---|---|
| Fact retrieval | Each fact stores the question it answers, that question is embedded once, and a visitor's question is matched against it — the closest few facts go to the model, bounded by a character budget. Every failure sends every fact instead: a page under 25 verified facts, a missing or stale vector, a provider failure or a best match under the floor. Prompt caching is on only in that fallback, because caching does not pay on a small shop's traffic — Haiku will not cache a prefix under 4,096 tokens and an entry expires in five minutes. The fact `id` is no longer sent; nothing ever read it. See slice-12-build-spec.md. |

- [ ] **Step 4: `devDocs/OPERATIONS.md`**

Three additions, in the style of the existing sections (a heading, the commands, what the output means, and a `Retire this when` where one applies).

**`## Backfilling fact vectors`** — the command, what it costs (about 2 sen per thousand facts), that it is safe to re-run, that it runs against whatever `DATABASE_URL` points at, and the two times it is needed: once after this slice's migration, and again whenever `EMBEDDING_MODEL` changes.

**`## The embeddings provider is down`** — what to do: nothing. Every page answers from every fact, answers stay correct, and the bill goes up until it recovers. How to confirm that is what is happening: the `chat retrieval` log lines carry `reason: "provider-failed"`. Do not disable retrieval, do not restart anything.

**`## Telling retrieval from fallback`** — two ways. The `chat retrieval` log line, which carries the mode, the reason, the best score and both counts and never the question. And `ModelCall`, where a retrieved answer's prompt is roughly a quarter of a fallback's on a large page — include the SQL, in the style of the existing `psql` blocks in that file.

**Amend `## Running the golden set`** — it says sixty questions, three fixture pages, about five cents. It is now eighty questions across four pages at whatever Task 8 measured, it needs `OPENAI_API_KEY` as well as `ANTHROPIC_API_KEY`, and the fourth page is the only one that exercises retrieval.

- [ ] **Step 5: `devDocs/slice-12-build-spec.md`**

Two corrections, both recorded as rulings in this plan:

- The done-gate's token number. The spec says "under 1,200 tokens"; a 4,000-character budget cannot reach that. Change it to the measured number from Task 7 Step 10 and note the arithmetic: 4,000 characters of Malay prose is about 1,150 tokens, plus roughly 350 for the instruction block.
- The headline "about 85% off every answer" in the goal. Replace it with the measured figure.

Do not rewrite the spec beyond these two corrections. It is the record of what was decided, and a spec quietly edited to match what was built stops being that.

- [ ] **Step 6: Read back what you wrote**

Grep the three documents for the claims this slice invalidated, and fix anything you missed:

```bash
grep -rn "every fact\|every verified fact\|do not select\|vector database\|not a vector store" devDocs/*.md
```

Each hit is either correct in its context or a leftover. Say in your report how many you found and what you did with each.

- [ ] **Step 7: Run the gates and commit**

```bash
git add devDocs .env.example
git commit -m "docs: retrieval, and the three places that said sending every fact was right

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

Run against the spec after the plan was written.

**1. Spec coverage.** Every section of `devDocs/slice-12-build-spec.md` maps to a task:

| Spec requirement | Task |
|---|---|
| A hosted embeddings API behind one package | 1 |
| `FactEmbedding` with `factId`, `vector`, `model`, `dims`, `createdAt` | 2 |
| `QuestionEmbedding` keyed by normalised question, with model and dims | 2 — **keyed by a hash of it**, see the ruling below |
| Matching on `Fact.question`, falling back to `Fact.claim` | 4 |
| Embedded in the worker, one batched call per ingestion | 4 |
| An ingestion that fails to embed still writes its facts | 4 |
| Re-embed on edit; delete the row if that fails | 5 |
| A backfill script | 5 |
| The eight-step answer flow, in that order | 7 |
| `RETRIEVAL_MIN_FACTS`, `RETRIEVAL_FLOOR`, `FACT_BUDGET_CHARS`, `EMBEDDING_TIMEOUT_MS` | 3, 1 |
| Vectors read per question, never cached in process | 7 |
| A follow-up embeds the previous user turn with the question | 7 |
| A repeated question reuses its stored vector | 7 |
| Caching off in retrieval, on in fallback | 6, 7 |
| The fact `id` dropped from the prompt | 6 |
| A fourth fixture page, at least 40 facts, 20 questions | 8 |
| The runner writes embeddings when it seeds | 8 |
| The five question shapes the spec names for that fixture | 8 — far-down fact (Q8), EN against MS (Q4), MS against EN (Q3, Q16), two facts at once (Q6), a genuine gap (Q7, Q12) |
| A test for each of the four fallback triggers | 3 and 7 — plus two the spec does not name, `no-embedder` and `provider-failed` |
| BACKEND, README, OPERATIONS, `prompt.ts` corrected | 9, 6 |

**Three rulings recorded against the spec, all in Global Constraints or here:**

- **The done-gate's token number**, corrected from "under 1,200" to "under 2,000, measured". The spec's own budget makes 1,200 arithmetically impossible. Cost if wrong: answers cost about 0.25 sen instead of 0.15.
- **`QuestionEmbedding` is keyed by a hash of the normalised text, not by the text.** The spec says "keyed by that normalized text". A follow-up embeds two turns, which can exceed Postgres' btree key limit and throw on a visitor's question; and the column would otherwise be a global log of everything anyone ever asked. Cost if wrong: a cache key nobody can read by eye when debugging.
- **An edited fact is only re-embedded when it has no `question`.** The spec says re-embed on every edit. `editFact` cannot change a fact's question, and a fact with one is matched on that question — so its vector is not stale and the call would write the same numbers back. Cost if wrong: a fact whose claim changed keeps matching on its old question, which is what it was always going to do anyway.

**2. Placeholder scan.** No `TBD`, no "implement later", no "similar to Task N". Two tasks ask the implementer to adapt to a file's existing style rather than reproducing it — Task 4 Step 6 and Task 5 Step 1, both in test files whose setup helpers this plan cannot see. Both name exactly what to assert.

**3. Type consistency.** `Embedder` (`model`, `dims`, `embed`) is defined once in Task 1 and consumed unchanged in 4, 5, 7, 8. `encodeVector`/`decodeVector` take and return `Uint8Array`/`Float32Array` everywhere, and the Prisma-6 `Bytes → Uint8Array` mapping is called out where it bites. `selectFacts` returns `Selection<T>`; `selectForQuestion` returns `ChatSelection<T>`, which is the same shape with a wider `reason` — deliberate, and both named at their producing task. `ChatDeps.embedder`, `ChatRouteOptions.embedder` and `FactRouteOptions.embedder` are all `Embedder | null`, with `undefined` meaning "build from the environment" only on the two route options.

**One gap worth naming rather than hiding:** nothing in this plan proves the *quality* of retrieval for a question nobody wrote a fixture for. Eighty questions is a net, not a proof. The honest signal after launch is the `reason` distribution in the retrieval log plus the questions owners see on their Questions screen — which is what the spec says too, and it is the right answer, not a gap to close here.
