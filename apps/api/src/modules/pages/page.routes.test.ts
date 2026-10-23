import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';
import { editDistance } from './page.service.js';

let app: FastifyInstance;

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.113.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function anOwner(): Promise<string> {
  const account = await app.prisma.account.create({
    data: { email: `claim-${randomUUID()}@example.com`, emailVerifiedAt: new Date() },
    select: { id: true },
  });
  return (await createSession(app.prisma, account.id)).value;
}

const claim = (cookie: string, handle: string) =>
  app.inject({
    method: 'POST',
    url: '/pages',
    remoteAddress: from(),
    cookies: { [SESSION_COOKIE]: cookie },
    payload: { handle, displayName: 'A Shop' },
  });

const claimAs = (cookie: string, handle: string, mode: 'PERSONAL' | 'BUSINESS') =>
  app.inject({
    method: 'POST',
    url: '/pages',
    remoteAddress: from(),
    cookies: { [SESSION_COOKIE]: cookie },
    payload: { handle, displayName: 'Nadia', mode },
  });

const call = (cookie: string | undefined, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({
    method,
    url,
    remoteAddress: from(),
    cookies: cookie ? { [SESSION_COOKIE]: cookie } : {},
    ...(payload ? { payload } : {}),
  });

const modeOf = async (handle: string) =>
  (await app.prisma.page.findUniqueOrThrow({ where: { handle }, select: { mode: true } })).mode;

describe('POST /pages', () => {
  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/pages',
      remoteAddress: from(),
      payload: { handle: `h${randomUUID().slice(0, 8)}`, displayName: 'A Shop' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('claims a handle and stores it lowercased', async () => {
    const cookie = await anOwner();
    const handle = `Shop${randomUUID().slice(0, 8)}`;

    const res = await claim(cookie, handle);

    expect(res.statusCode).toBe(201);
    expect(res.json().handle).toBe(handle.toLowerCase());
  });

  it('refuses a handle that is already taken', async () => {
    const handle = `dup${randomUUID().slice(0, 8)}`;
    await claim(await anOwner(), handle);

    const res = await claim(await anOwner(), handle);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('HANDLE_TAKEN');
  });

  it('refuses a handle that only differs by a lookalike', async () => {
    const cookie = await anOwner();
    const stem = `shape${randomUUID().slice(0, 6)}`;
    await claim(cookie, `${stem}o`);

    // Same skeleton, different handle: 0 folds to o. Told apart from "taken"
    // on purpose -- an owner who cannot tell the two apart keeps guessing.
    const res = await claim(await anOwner(), `${stem}0`);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('HANDLE_TOO_SIMILAR');
  });

  it('refuses a second page for an account that already has one', async () => {
    const cookie = await anOwner();
    await claim(cookie, `first${randomUUID().slice(0, 8)}`);

    const res = await claim(cookie, `second${randomUUID().slice(0, 8)}`);

    // Not "taken": the handle is free. Reporting the wrong reason here sends
    // someone off inventing handles to fix a problem that is not the handle.
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PAGE_EXISTS');
  });

  it('refuses a malformed handle and a reserved one, distinguishably', async () => {
    const cookie = await anOwner();

    // Both length boundaries, and both must come back as domain errors. If the
    // route schema ever restates the length rule, these arrive as
    // INTERNAL_ERROR instead and the caller cannot tell a typo from an outage.
    expect((await claim(cookie, 'ab')).json().error.code).toBe('HANDLE_INVALID');
    expect((await claim(cookie, 'a'.repeat(31))).json().error.code).toBe('HANDLE_INVALID');
    expect((await claim(cookie, 'admin')).json().error.code).toBe('HANDLE_RESERVED');
    expect((await claim(cookie, 'adm1n')).json().error.code).toBe('HANDLE_RESERVED');
  });

  it('writes no page when the handle is rejected', async () => {
    const cookie = await anOwner();

    await claim(cookie, 'admin');

    const res = await claim(cookie, `after${randomUUID().slice(0, 8)}`);
    // If the rejected attempt had written a row, this would be PAGE_EXISTS.
    expect(res.statusCode).toBe(201);
  });

  it('claims a personal page when the owner asks for one', async () => {
    const handle = `h${randomUUID().slice(0, 8)}`;

    const res = await claimAs(await anOwner(), handle, 'PERSONAL');

    expect(res.statusCode).toBe(201);
    expect(await modeOf(handle)).toBe('PERSONAL');
  });

  it('claims a business page when no tier is sent', async () => {
    // The column's own default. Existing callers send no mode, and must keep
    // getting what they got before this slice.
    const handle = `h${randomUUID().slice(0, 8)}`;

    const res = await claim(await anOwner(), handle);

    expect(res.statusCode).toBe(201);
    expect(await modeOf(handle)).toBe('BUSINESS');
  });
});

describe('POST /publish', () => {
  it('publishes the caller own page', async () => {
    const cookie = await anOwner();
    const handle = `pub${randomUUID().slice(0, 8)}`;
    await claim(cookie, handle);

    const res = await app.inject({
      method: 'POST',
      url: '/publish',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect(res.statusCode).toBe(200);
    // The status alone proves only that a row was matched -- publishPage
    // throws when the count is not 1. It would pass just as well if the
    // update wrote `published: false`, which is the one thing this whole
    // task exists to do. So read it back.
    const page = await app.prisma.page.findUnique({ where: { handle } });
    expect(page?.published).toBe(true);
  });

  it('is harmless to publish twice', async () => {
    const cookie = await anOwner();
    const handle = `twice${randomUUID().slice(0, 8)}`;
    await claim(cookie, handle);

    const first = await app.inject({
      method: 'POST',
      url: '/publish',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: cookie },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/publish',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: cookie },
    });

    // A double-clicked button is the ordinary way this happens. updateMany
    // matches an already-published row just as well, so the count stays 1 and
    // the second call succeeds -- but that is worth pinning rather than
    // inferring.
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const page = await app.prisma.page.findUnique({ where: { handle } });
    expect(page?.published).toBe(true);
  });

  it('takes no page id at all', () => {
    const routes = app.printRoutes({ commonPrefix: false });

    // One page per account is a database constraint, so the caller's page is
    // never ambiguous. Taking an id would create an IDOR surface to defend for
    // no benefit -- the same class of hole plan 1 closed on /ingest.
    //
    // What this catches: a `:param` segment, which is the only parametric
    // idiom used anywhere in this codebase. What it does NOT catch: a wildcard
    // segment such as /publish/*, which carries no colon. Same caveat as the
    // route-table test in fact.routes.test.ts, and stated for the same reason
    // -- a syntactic guard should say what it cannot see.
    const publishRoutes = routes.split('\n').filter((line) => line.includes('publish'));
    expect(publishRoutes.length).toBeGreaterThan(0);
    for (const line of publishRoutes) expect(line).not.toMatch(/:/);
  });

  it('refuses an owner with no page yet', async () => {
    const cookie = await anOwner();

    const res = await app.inject({
      method: 'POST',
      url: '/publish',
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NO_PAGE');
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'POST', url: '/publish', remoteAddress: from() });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /pages/upgrade', () => {
  it('refuses an unauthenticated caller', async () => {
    expect((await call(undefined, 'POST', '/pages/upgrade')).statusCode).toBe(401);
  });

  it('makes a personal page a business page', async () => {
    const cookie = await anOwner();
    const handle = `h${randomUUID().slice(0, 8)}`;
    await claimAs(cookie, handle, 'PERSONAL');

    const res = await call(cookie, 'POST', '/pages/upgrade');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'business' });
    expect(await modeOf(handle)).toBe('BUSINESS');
  });

  it('succeeds without change on a page that is already business', async () => {
    // A second click, or a stale screen, must not produce an error: there is
    // nothing to refuse.
    const cookie = await anOwner();
    const handle = `h${randomUUID().slice(0, 8)}`;
    await claimAs(cookie, handle, 'BUSINESS');

    const res = await call(cookie, 'POST', '/pages/upgrade');

    expect(res.statusCode).toBe(200);
    expect(await modeOf(handle)).toBe('BUSINESS');
  });

  it('answers NO_PAGE for an owner with no page yet', async () => {
    const res = await call(await anOwner(), 'POST', '/pages/upgrade');

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NO_PAGE' } });
  });
});

describe('PATCH /pages/search-indexing', () => {
  const allowed = async (handle: string) =>
    (
      await app.prisma.page.findUniqueOrThrow({
        where: { handle },
        select: { allowSearchIndexing: true },
      })
    ).allowSearchIndexing;

  it('refuses an unauthenticated caller', async () => {
    const res = await call(undefined, 'PATCH', '/pages/search-indexing', { allow: true });

    expect(res.statusCode).toBe(401);
  });

  it('turns search indexing on, and off again', async () => {
    const cookie = await anOwner();
    const handle = `h${randomUUID().slice(0, 8)}`;
    await claimAs(cookie, handle, 'PERSONAL');

    const on = await call(cookie, 'PATCH', '/pages/search-indexing', { allow: true });
    expect(on.json()).toEqual({ allowSearchIndexing: true });
    expect(await allowed(handle)).toBe(true);

    await call(cookie, 'PATCH', '/pages/search-indexing', { allow: false });
    expect(await allowed(handle)).toBe(false);
  });

  it('answers NO_PAGE for an owner with no page yet', async () => {
    const res = await call(await anOwner(), 'PATCH', '/pages/search-indexing', { allow: true });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NO_PAGE' } });
  });
});

describe('PATCH /pages/notifications', () => {
  const notifies = async (handle: string) =>
    (await app.prisma.page.findUniqueOrThrow({ where: { handle }, select: { notifyLeads: true } })).notifyLeads;

  it('refuses an unauthenticated caller', async () => {
    const res = await call(undefined, 'PATCH', '/pages/notifications', { leads: false });
    expect(res.statusCode).toBe(401);
  });

  it('starts on, turns the lead email off, and on again', async () => {
    const cookie = await anOwner();
    const handle = `h${randomUUID().slice(0, 8)}`;
    await claimAs(cookie, handle, 'BUSINESS');
    expect(await notifies(handle)).toBe(true);

    const off = await call(cookie, 'PATCH', '/pages/notifications', { leads: false });
    expect(off.json()).toEqual({ leads: false });
    expect(await notifies(handle)).toBe(false);

    await call(cookie, 'PATCH', '/pages/notifications', { leads: true });
    expect(await notifies(handle)).toBe(true);
  });

  it('turns the order and receipt emails off each on its own, leaving the rest as they were', async () => {
    const cookie = await anOwner();
    const handle = `h${randomUUID().slice(0, 8)}`;
    await claimAs(cookie, handle, 'BUSINESS');
    const flags = async () =>
      app.prisma.page.findUniqueOrThrow({ where: { handle }, select: { notifyLeads: true, notifyOrders: true, notifyReceipts: true } });
    expect(await flags()).toEqual({ notifyLeads: true, notifyOrders: true, notifyReceipts: true });

    const orders = await call(cookie, 'PATCH', '/pages/notifications', { orders: false });
    expect(orders.json()).toEqual({ orders: false });
    expect(await flags()).toEqual({ notifyLeads: true, notifyOrders: false, notifyReceipts: true });

    const receipts = await call(cookie, 'PATCH', '/pages/notifications', { receipts: false });
    expect(receipts.json()).toEqual({ receipts: false });
    expect(await flags()).toEqual({ notifyLeads: true, notifyOrders: false, notifyReceipts: false });
  });

  it('refuses a body that switches nothing', async () => {
    const res = await call(await anOwner(), 'PATCH', '/pages/notifications', {});
    expect(res.statusCode).toBe(400);
  });

  it('answers NO_PAGE for an owner with no page yet', async () => {
    const res = await call(await anOwner(), 'PATCH', '/pages/notifications', { leads: true });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /pages/handle-check', () => {
  const check = async (cookie: string | undefined, handle: string) =>
    (await call(cookie, 'GET', `/pages/handle-check?handle=${encodeURIComponent(handle)}`)).json();

  it('refuses an unauthenticated caller', async () => {
    const res = await call(undefined, 'GET', '/pages/handle-check?handle=abc');
    expect(res.statusCode).toBe(401);
  });

  it('says an address is free, taken, too like a taken one, reserved, or not a handle', async () => {
    const cookie = await anOwner();
    const taken = `h${randomUUID().slice(0, 8)}`;
    await claimAs(await anOwner(), taken, 'BUSINESS');

    expect(await check(cookie, `h${randomUUID().slice(0, 8)}`)).toEqual({ status: 'available' });
    expect(await check(cookie, taken)).toEqual({ status: 'taken' });
    expect(await check(cookie, taken.toUpperCase())).toEqual({ status: 'taken' });
    expect(await check(cookie, 'admin')).toEqual({ status: 'reserved' });
    expect(await check(cookie, 'a b')).toEqual({ status: 'invalid' });
    expect(await check(cookie, 'ab')).toEqual({ status: 'invalid' });
  });
});

describe('GET /pages/near', () => {
  const near = async (handle: string) => (await call(undefined, 'GET', `/pages/near?handle=${encodeURIComponent(handle)}`)).json();
  const published = async (handle: string, live = true) => {
    await claimAs(await anOwner(), handle, 'BUSINESS');
    await app.prisma.page.update({ where: { handle }, data: { published: live } });
  };

  it('names the published page a mistyped address was meant to be, with no session', async () => {
    const real = `n${randomUUID().slice(0, 8)}`;
    await published(real);

    // One letter doubled, one changed: within two.
    expect(await near(`${real.slice(0, 3)}${real[3]}${real.slice(3)}`)).toEqual({ handle: real });
    expect(await near(`${real.slice(0, -1)}${real.endsWith('z') ? 'y' : 'z'}`)).toEqual({ handle: real });
    expect(await near(real.toUpperCase().slice(0, -1) + (real.endsWith('z') ? 'Y' : 'Z'))).toEqual({ handle: real });
  });

  it('does not name a suspended page', async () => {
    const real = `n${randomUUID().slice(0, 8)}`;
    await published(real);
    const typo = `${real.slice(0, -1)}${real.endsWith('z') ? 'y' : 'z'}`;
    expect(await near(typo)).toEqual({ handle: real });

    await app.prisma.page.update({ where: { handle: real }, data: { suspendedAt: new Date(), suspendReason: 'x' } });
    expect(await near(typo)).toEqual({ handle: null });
  });

  it('suggests nothing for a live address, a far one, or a page not published', async () => {
    const real = `n${randomUUID().slice(0, 8)}`;
    const hidden = `n${randomUUID().slice(0, 8)}`;
    await published(real);
    await published(hidden, false);

    expect(await near(real)).toEqual({ handle: null });
    expect(await near(`q${randomUUID().slice(0, 8)}`)).toEqual({ handle: null });
    expect(await near(`${hidden.slice(0, -1)}${hidden.endsWith('z') ? 'y' : 'z'}`)).toEqual({ handle: null });
  });
});

describe('editDistance', () => {
  it('counts the letters added, dropped or changed', () => {
    expect(editDistance('keklina', 'keklina')).toBe(0);
    expect(editDistance('kekklina', 'keklina')).toBe(1);
    expect(editDistance('keklinna', 'kekline')).toBe(2);
    expect(editDistance('', 'abc')).toBe(3);
  });
});
