import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

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
});
