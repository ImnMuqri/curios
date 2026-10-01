import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { EMBEDDING_DIMS, EMBEDDING_MODEL, type Embedder } from '@curios/embeddings';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  // `null`, not omitted: PATCH /facts/:id now reaches an embedder on every
  // successful edit (fact.service.test.ts covers what it does with one).
  // Omitting this would leave PATCH here building a real embedder from the
  // dummy key vitest.setup.ts pins and reaching out to OpenAI on every run --
  // no money spent (the key is a fake), but a real network call this suite
  // does not need and should not depend on. `null` is the documented
  // "only tests pass this" case in FactRouteOptions.
  app = await buildApp({ facts: { embedder: null } });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function anOwnerWithAFact(claim = 'kuih lapis is rm12') {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `fact-${randomUUID()}@example.com`,
      pages: { create: { handle: `f-${slug}`, skeleton: `f-${slug}`, displayName: 'F' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]?.id ?? '';
  const fact = await app.prisma.fact.create({
    data: { pageId, category: 'PRICE', claim, normalizedClaim: claim, confidence: 0.9 },
    select: { id: true },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, pageId, factId: fact.id };
}

describe('POST /facts/:id/verify', () => {
  it('verifies one fact', async () => {
    const mine = await anOwnerWithAFact();

    const res = await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/verify`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    expect(res.statusCode).toBe(200);
    const fact = await app.prisma.fact.findUnique({ where: { id: mine.factId } });
    expect(fact?.verified).toBe(true);
  });

  it('verifies one fact when called the way a browser actually calls it', async () => {
    const mine = await anOwnerWithAFact();

    // The other tests in this file send no content-type at all, which is
    // what app.inject defaults to and is why a browser's actual request
    // shape -- a JSON content type on a route that takes no payload -- went
    // untested. This pins the contract at the API end: `apiFetch` in
    // apps/web now sends '{}' for exactly this reason.
    const res = await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/verify`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const fact = await app.prisma.fact.findUnique({ where: { id: mine.factId } });
    expect(fact?.verified).toBe(true);
  });

  it('refuses another owner fact, and leaves it unverified', async () => {
    const mine = await anOwnerWithAFact();
    const theirs = await anOwnerWithAFact('their price is rm40');

    const res = await app.inject({
      method: 'POST',
      url: `/facts/${theirs.factId}/verify`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    // Verifying is what puts a claim in front of a customer. Doing it to
    // someone else's page is the planted-price attack in one request.
    expect(res.statusCode).toBe(404);
    const fact = await app.prisma.fact.findUnique({ where: { id: theirs.factId } });
    expect(fact?.verified).toBe(false);
  });

  it('refuses an unauthenticated caller', async () => {
    const mine = await anOwnerWithAFact();

    const res = await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/verify`,
      remoteAddress: from(),
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /facts/:id', () => {
  it('re-normalises an edited claim', async () => {
    const mine = await anOwnerWithAFact();

    const res = await app.inject({
      method: 'PATCH',
      url: `/facts/${mine.factId}`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { claim: 'Kuih Lapis is RM14!' },
    });

    expect(res.statusCode).toBe(200);
    const fact = await app.prisma.fact.findUnique({ where: { id: mine.factId } });
    // The dedupe key must never drift from the text it keys.
    expect(fact?.claim).toBe('Kuih Lapis is RM14!');
    expect(fact?.normalizedClaim).toBe('kuih lapis is rm14');
  });

  it('reports an edit that collides with another fact on the same page', async () => {
    const mine = await anOwnerWithAFact('first claim here');
    await app.prisma.fact.create({
      data: {
        pageId: mine.pageId,
        category: 'PRICE',
        claim: 'second claim here',
        normalizedClaim: 'second claim here',
        confidence: 0.9,
      },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/facts/${mine.factId}`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { claim: 'Second claim here' },
    });

    // A P2002 on [pageId, normalizedClaim], surfaced as something an owner can
    // act on rather than a 500.
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('FACT_DUPLICATE');
  });
});

describe('PATCH /facts/:id validates like POST /facts', () => {
  const patch = (mine: { factId: string; cookie: string }, claim: string) =>
    app.inject({
      method: 'PATCH',
      url: `/facts/${mine.factId}`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { claim },
    });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['two lines', 'a\nb'],
    ['501 characters', 'x'.repeat(501)],
  ])('answers INVALID_FACT, not raw validation text, for %s, and changes nothing', async (_name, claim) => {
    const mine = await anOwnerWithAFact('original claim');
    const res = await patch(mine, claim);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_FACT');
    expect((await app.prisma.fact.findUniqueOrThrow({ where: { id: mine.factId } })).claim).toBe('original claim');
  });

  it('accepts 500 emoji and trims', async () => {
    const mine = await anOwnerWithAFact('original claim');
    expect((await patch(mine, '😀'.repeat(500))).statusCode).toBe(200);
    expect((await patch(mine, '  trimmed claim  ')).statusCode).toBe(200);
    expect((await app.prisma.fact.findUniqueOrThrow({ where: { id: mine.factId } })).claim).toBe('trimmed claim');
  });
});

describe('POST /facts/:id/reject', () => {
  it('soft-deletes the fact and stops it being public', async () => {
    const mine = await anOwnerWithAFact();
    await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/verify`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/reject`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    expect(res.statusCode).toBe(200);
    const fact = await app.prisma.fact.findUnique({ where: { id: mine.factId } });
    expect(fact?.rejectedAt).not.toBeNull();
    // Both public read paths filter on `verified`, not on `rejectedAt`. If
    // rejecting a previously accepted fact left verified true, the rejected
    // claim would still be answering customers.
    expect(fact?.verified).toBe(false);
  });

  it('keeps the row, so the next crawl does not re-ask', async () => {
    const mine = await anOwnerWithAFact();

    await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/reject`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    // Extraction writes with skipDuplicates against
    // @@unique([pageId, normalizedClaim]). A hard delete would let the same
    // dismissed claim reappear in the queue on the next crawl.
    expect(await app.prisma.fact.findUnique({ where: { id: mine.factId } })).not.toBeNull();
  });
});

describe('POST /facts', () => {
  it('adds a live fact the owner typed', async () => {
    const mine = await anOwnerWithAFact();

    const res = await app.inject({
      method: 'POST',
      url: '/facts',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { category: 'HOURS', claim: 'Closed on public holidays.' },
    });

    expect(res.statusCode).toBe(201);
    const fact = await app.prisma.fact.findUniqueOrThrow({ where: { id: res.json<{ id: string }>().id } });
    expect(fact).toMatchObject({ pageId: mine.pageId, verified: true, origin: 'OWNER' });
  });

  it('creating a fact verifies no other', async () => {
    const mine = await anOwnerWithAFact('pending claim');
    await app.inject({
      method: 'POST',
      url: '/facts',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { category: 'MISC', claim: 'Another.' },
    });
    expect((await app.prisma.fact.findUniqueOrThrow({ where: { id: mine.factId } })).verified).toBe(false);
  });

  it('says what is wrong with a bad fact', async () => {
    const mine = await anOwnerWithAFact();
    const res = await app.inject({
      method: 'POST',
      url: '/facts',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { category: 'WEATHER', claim: 'Sunny.' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_FACT');
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'POST', url: '/facts', remoteAddress: from(), payload: { category: 'MISC', claim: 'x' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('the one hard rule', () => {
  it('exposes no route that can verify more than one fact', () => {
    const routes = app.printRoutes({ commonPrefix: false });

    // A negative requirement, so it needs a test that fails when someone adds
    // the thing rather than one that passes because they have not yet.
    //
    // What this catches: a bulk route with no id in its path. What it does NOT
    // catch: a bulk accept smuggled through the body of a route that still has
    // an :id. That case is covered behaviourally by the test below, and the
    // real backstop for both is that `verifyFact` takes one id and has no
    // plural form. This test is the cheap outer guard, not the guarantee.
    //
    // `printRoutes({ commonPrefix: false })` prints each node's path SEGMENT
    // relative to its parent, not the full accumulated path -- a node only
    // gets a line of its own once it (or a sibling) forces a branch; a
    // parent with no handler of its own and exactly one child is merged onto
    // that child's line instead. Before this task /facts had no handler, so
    // /facts and /facts/:id merged onto a single line ("/facts/:id
    // (PATCH)"), which a plain `line.includes('/facts')` scan happened to
    // catch. Now that POST /facts exists, /facts prints on its own line and
    // ":id" (PATCH), "/verify" (POST) and "/reject" (POST) each print on
    // their own line, none of which contain the literal text "/facts" --
    // and the last two do not even contain ":id", which is two levels up.
    // Observed with this Fastify version, verified by printing `routes` once
    // during development:
    //   ├── /facts (POST)
    //   │   └── /:id (PATCH)
    //   │       ├── /verify (POST)
    //   │       └── /reject (POST)
    // So this walks the tree by indentation (4 spaces/pipes per level) and
    // reconstructs each line's full path from its ancestors, then asks of
    // the reconstructed path the question the old substring scan could only
    // approximate.
    //
    // Review found the first version of this walk still failed OPEN: any
    // tree line its regex could not parse was silently `continue`d past,
    // rather than failing the outer guard on the product's one hard rule.
    // find-my-way's radix-tree compression prints several real,
    // still-mutating-under-/facts shapes that regex could not see:
    //   - a wildcard route (POST /facts/*) prints as bare "* (POST)" -- no
    //     leading "/", so a segment pattern requiring one skips the line.
    //   - two routes sharing a prefix print only the DIVERGING suffix on the
    //     child's line -- "GET /facts/export" beside "POST
    //     /facts/export-verify-all" prints the child as "-verify-all
    //     (POST)"; "GET /facts/pending" beside "POST
    //     /facts/pendingVerifyAll" prints it as "VerifyAll (POST)". Neither
    //     starts with "/", and neither line contains ":id" even though the
    //     reconstructed path is still id-less and still mutating.
    //   - a version-constrained route prints its constraint as JSON after
    //     the methods group -- "/verify-all (POST)
    //     {"version":"1.0.0"}" -- which a pattern anchoring `$` right after
    //     the methods group cannot match.
    // So this now (a) accepts a bare, non-"/"-prefixed segment, since a
    // diverging suffix or a wildcard is exactly that; (b) allows arbitrary
    // trailing text after the methods group, for a constraint's JSON blob;
    // and (c) asserts every non-blank tree line matches this widened
    // pattern, failing the test outright on any it still cannot parse,
    // rather than skipping it. Subtree membership is decided by the STACK'S
    // ROOT segment being exactly "/facts", not by a string prefix on the
    // reconstructed path: the wildcard's own segment has no leading "/", so
    // its reconstructed path is "/facts*" (no separating slash), which a
    // `.startsWith('/facts/')` check would miss entirely -- precisely the
    // kind of line this guard must not silently pass over.
    //
    // One exemption, by exact path: POST /facts creates ONE fact the owner
    // wrote and touches no other (see "creating a fact verifies no other"
    // below, which is what earns the exemption). Anything else mutating
    // under /facts whose reconstructed path lacks ":id" fails here.
    const stack: string[] = [];
    const factsNodes: { path: string; methods: string }[] = [];
    for (const rawLine of routes.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line.trim() === '') continue;

      const node = line.match(/^([│ ]*)[├└]── (\S+)(?: \(([^)]*)\))?(?: .*)?$/);
      expect(
        node,
        `printRoutes produced a tree line this guard cannot parse: ${JSON.stringify(line)}`,
      ).not.toBeNull();
      const indent = node?.[1] ?? '';
      const segment = node?.[2] ?? '';
      const methods = node?.[3] ?? '';
      const depth = indent.length / 4;
      stack.length = depth;
      stack.push(segment);
      const path = stack.join('');
      if (stack[0] === '/facts') {
        factsNodes.push({ path, methods });
      }
    }

    const mutating = factsNodes.filter((n) => /POST|PATCH|PUT|DELETE/.test(n.methods));
    const create = mutating.filter((n) => n.path === '/facts' && n.methods === 'POST');

    expect(create).toHaveLength(1);
    expect(mutating.length).toBeGreaterThan(1);
    for (const n of mutating.filter((m) => !create.includes(m))) {
      expect(n.path).toMatch(/:id/);
    }
  });

  it('verifies only the fact in the path, whatever the body asks for', async () => {
    const mine = await anOwnerWithAFact('the first claim');
    const second = await app.prisma.fact.create({
      data: {
        pageId: mine.pageId,
        category: 'PRICE',
        claim: 'the second claim',
        normalizedClaim: 'the second claim',
        confidence: 0.9,
      },
      select: { id: true },
    });

    await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/verify`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      // The shape the route-table test cannot see: a bulk accept asked for
      // through the body of a route that does have an :id.
      payload: { alsoVerify: [second.id], all: true },
    });

    expect((await app.prisma.fact.findUnique({ where: { id: second.id } }))?.verified).toBe(false);
  });
});

describe('the other two routes are scoped and guarded too', () => {
  it('refuses to edit another owner fact', async () => {
    const mine = await anOwnerWithAFact();
    const theirs = await anOwnerWithAFact('their claim');

    const res = await app.inject({
      method: 'PATCH',
      url: `/facts/${theirs.factId}`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { claim: 'rewritten by a stranger' },
    });

    expect(res.statusCode).toBe(404);
    const fact = await app.prisma.fact.findUnique({ where: { id: theirs.factId } });
    expect(fact?.claim).toBe('their claim');
  });

  it('refuses to reject another owner fact', async () => {
    const mine = await anOwnerWithAFact();
    const theirs = await anOwnerWithAFact('their other claim');

    const res = await app.inject({
      method: 'POST',
      url: `/facts/${theirs.factId}/reject`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    expect(res.statusCode).toBe(404);
    expect((await app.prisma.fact.findUnique({ where: { id: theirs.factId } }))?.rejectedAt).toBeNull();
  });

  it('refuses an unauthenticated caller on both', async () => {
    const mine = await anOwnerWithAFact();

    const edit = await app.inject({
      method: 'PATCH',
      url: `/facts/${mine.factId}`,
      remoteAddress: from(),
      payload: { claim: 'anything' },
    });
    const reject = await app.inject({
      method: 'POST',
      url: `/facts/${mine.factId}/reject`,
      remoteAddress: from(),
    });

    expect(edit.statusCode).toBe(401);
    expect(reject.statusCode).toBe(401);
  });
});

describe('PATCH /facts/:id actually uses the embedder it was given', () => {
  // `embedder: null` is honoured by an `=== undefined` check specifically so
  // that an explicit null is never confused with "no override given".
  // `!embedder` reads the same in every case above (production never passes
  // null) but treats null as falsy too, silently rebuilding a real embedder
  // from the dummy env key on every request here -- still no money spent (the
  // key is fake), but a real, slow network call this suite must never make.
  // No status code or DB row can tell the two branches apart: the fallback
  // degrades so cleanly that the only observable difference is whether the
  // network was ever reached. The spy has to be in place *before* buildApp()
  // registers factRoutes, because createOpenAiEmbedder closes over whatever
  // `fetch` is at that moment -- spying inside the test, after the shared
  // `app` above was already built in beforeAll, would watch a function this
  // embedder never calls.
  it('never reaches the network when configured with no embedder', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const ownApp = await buildApp({ facts: { embedder: null } });
    await ownApp.ready();

    try {
      const slug = randomUUID().slice(0, 8);
      const account = await ownApp.prisma.account.create({
        data: {
          email: `fact-${randomUUID()}@example.com`,
          pages: { create: { handle: `f-${slug}`, skeleton: `f-${slug}`, displayName: 'F' } },
        },
        select: { id: true, pages: { select: { id: true } } },
      });
      const pageId = account.pages[0]?.id ?? '';
      const fact = await ownApp.prisma.fact.create({
        data: { pageId, category: 'PRICE', claim: 'kek', normalizedClaim: 'kek', confidence: 0.9 },
        select: { id: true },
      });
      const { value: cookie } = await createSession(ownApp.prisma, account.id);

      const res = await ownApp.inject({
        method: 'PATCH',
        url: `/facts/${fact.id}`,
        remoteAddress: from(),
        cookies: { [SESSION_COOKIE]: cookie },
        payload: { claim: 'Kek RM130.' },
      });

      expect(res.statusCode).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await ownApp.close();
      fetchSpy.mockRestore();
    }
  });

  // The shared `app` above is built with `facts: { embedder: null }`, on
  // purpose (see the comment in beforeAll), which means no test using it can
  // tell "the route passed its embedder to editFact" apart from "the route
  // passed null" -- both look identical from the outside once nothing calls
  // it. A stub embedder, and an assertion that it was actually called, is the
  // only way to pin that the PATCH handler threads its resolved `embedder`
  // through rather than, say, passing `null` unconditionally.
  it('threads the configured embedder through to editFact', async () => {
    const embed = vi.fn(async (texts: string[]) =>
      texts.map(() => new Float32Array(EMBEDDING_DIMS)),
    );
    const stub: Embedder = { model: EMBEDDING_MODEL, dims: EMBEDDING_DIMS, embed };
    const ownApp = await buildApp({ facts: { embedder: stub } });
    await ownApp.ready();

    try {
      const mine = await anOwnerWithAFact();

      const res = await ownApp.inject({
        method: 'PATCH',
        url: `/facts/${mine.factId}`,
        remoteAddress: from(),
        cookies: { [SESSION_COOKIE]: mine.cookie },
        payload: { claim: 'Kek RM120.' },
      });

      expect(res.statusCode).toBe(200);
      expect(embed).toHaveBeenCalledWith(['Kek RM120.']);
      const row = await ownApp.prisma.factEmbedding.findUnique({
        where: { factId: mine.factId },
      });
      expect(row).not.toBeNull();
    } finally {
      await ownApp.close();
    }
  });
});

describe('factRoutes requires a real embedder key at boot', () => {
  it('refuses to start when OPENAI_API_KEY is not set', async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      // The message is asserted verbatim, not just "it threw": chatRoutes
      // throws a near-identical error for its own missing key, so a looser
      // assertion here would stay green even if this were accidentally
      // testing that route instead of this one.
      await expect(buildApp()).rejects.toThrow('OPENAI_API_KEY is not set');
    } finally {
      process.env.OPENAI_API_KEY = original;
    }
  });
});
