import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { BlockedAddressError } from '@curios/core';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  // Resolution stands in rather than runs: a real lookup would make an
  // authorization suite depend on DNS and fail offline for a reason that has
  // nothing to do with authorization. It refuses the metadata address so one
  // test below can watch that refusal travel out to a client.
  app = await buildApp({
    ingest: {
      guard: async (hostname) => {
        if (hostname === '169.254.169.254') throw new BlockedAddressError(hostname);
      },
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function anOwnerWithAPage(): Promise<{ cookie: string; pageId: string }> {
  const handle = `h-${randomUUID().slice(0, 8)}`;
  const account = await app.prisma.account.create({
    data: {
      email: `owner-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle,
          skeleton: handle,
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
      remoteAddress: from(),
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
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { pageId: theirs.pageId, sourceUrl: 'https://example.com/' },
    });

    // Facts land unverified, so a successful cross-owner ingest plants claims
    // in a stranger's review queue.
    expect(res.statusCode).toBe(404);
    // The code, not just the status. errorsPlugin whitelists client-facing
    // codes and rewrites anything else to INTERNAL_ERROR, so a 404 saying
    // INTERNAL_ERROR is what an unlisted code looks like from outside.
    expect(res.json().error.code).toBe('NOT_FOUND');
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
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: theirs.cookie },
      payload: { pageId: theirs.pageId, sourceUrl: 'https://example.com/' },
    });
    const ingestionId = started.json().ingestionId as string;

    const res = await app.inject({
      method: 'GET',
      url: `/ingest/${ingestionId}`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    // 404 rather than 403: a 403 confirms the id exists.
    expect(res.statusCode).toBe(404);
  });
});

describe('the order of the session check and the limiters', () => {
  it('does not let a signed-in stranger burn an owner daily budget', async () => {
    const mine = await anOwnerWithAPage();
    const stranger = await anOwnerWithAPage();

    // Signed in as themselves, naming someone else's page. The session hook
    // lets these through -- they ARE authenticated -- and the per-page limiter
    // counts at preHandler, before the handler checks ownership. So the 404 is
    // returned only after the owner's budget has already been spent.
    for (let i = 0; i < 25; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/ingest',
        remoteAddress: from(),
        cookies: { [SESSION_COOKIE]: stranger.cookie },
        payload: { pageId: mine.pageId, sourceUrl: 'https://example.com/' },
      });
    }

    const owner = await app.inject({
      method: 'POST',
      url: '/ingest',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { pageId: mine.pageId, sourceUrl: 'https://example.com/' },
    });

    expect(owner.statusCode).not.toBe(429);
  });

  it('does not let an unauthenticated caller burn an owner daily budget', async () => {
    const mine = await anOwnerWithAPage();

    // Each from its own address, so the per-IP budget is never the reason
    // anything is refused. That leaves the per-page budget as the only thing
    // these requests could consume, which is exactly what this is about.
    for (let i = 0; i < 25; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/ingest',
        remoteAddress: from(),
        payload: { pageId: mine.pageId, sourceUrl: 'https://example.com/' },
      });
    }

    // Well past the per-page budget. If the limiter counted those, the real
    // owner is now locked out of their own page by someone who never signed in.
    const owner = await app.inject({
      method: 'POST',
      url: '/ingest',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { pageId: mine.pageId, sourceUrl: 'https://example.com/' },
    });

    expect(owner.statusCode).not.toBe(429);
  });

  it('answers 400 with BLOCKED_SOURCE_URL for a private address', async () => {
    // The stub guard above refuses this hostname, standing in for the real
    // resolution that would. What this asserts is the trip out to the client:
    // that the refusal arrives as BLOCKED_SOURCE_URL rather than being
    // rewritten to INTERNAL_ERROR by the allow-list in errors.ts.
    const mine = await anOwnerWithAPage();

    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      payload: { pageId: mine.pageId, sourceUrl: 'http://169.254.169.254/latest/meta-data/' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BLOCKED_SOURCE_URL');
  });
});
