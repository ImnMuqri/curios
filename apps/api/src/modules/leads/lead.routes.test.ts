import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

let app: FastifyInstance;

let nth = 0;
/** A fresh source address per request, so the limiter never sees a flood. */
const from = () => `203.0.114.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

/**
 * `deleteLead` already has direct-call coverage in lead.delete.test.ts. What
 * that file cannot prove is that `DELETE /leads/:id` is actually registered,
 * and behind a session -- `leadRoutes` (anonymous, rate-limited, for the
 * visitor's POST) and `ownerLeadRoutes` (session-guarded, for the owner's
 * DELETE) come from the same module and are wired into two different scopes
 * in app.ts. If ownerLeadRoutes were ever registered into the anonymous
 * scope, every test that calls deleteLead() directly would still pass while
 * any lead became deletable by id by anyone.
 *
 * Emails and the handle below are randomUUID-derived, the same convention as
 * fact.routes.test.ts's anOwnerWithAFact -- collision-free against every
 * other test file sharing this database, including lead.delete.test.ts's
 * static f@example.com / intruder@example.com / faridah.
 */
async function anOwnerWithALead() {
  const slug = randomUUID().slice(0, 8);
  const account = await app.prisma.account.create({
    data: {
      email: `lead-route-${randomUUID()}@example.com`,
      pages: { create: { handle: `lr-${slug}`, skeleton: `lr-${slug}`, displayName: 'LR' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]?.id ?? '';
  const conversation = await app.prisma.conversation.create({ data: { pageId } });
  const lead = await app.prisma.lead.create({
    data: { pageId, conversationId: conversation.id, phone: '+60123456789' },
    select: { id: true },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, leadId: lead.id };
}

describe('DELETE /leads/:id', () => {
  it('deletes a lead the owner owns, called the way the browser actually calls it', async () => {
    const mine = await anOwnerWithALead();

    // apps/web/lib/api.ts sends a JSON content type and a '{}' body on every
    // mutation, DELETE included, even though this route takes no payload.
    // Fastify's JSON parser refuses a JSON content type paired with a
    // genuinely empty body, which is the precise shape that broke before --
    // this pins the contract at the API end the way fact.routes.test.ts does
    // for /facts/:id/verify.
    const res = await app.inject({
      method: 'DELETE',
      url: `/leads/${mine.leadId}`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(await app.prisma.lead.findUnique({ where: { id: mine.leadId } })).toBeNull();
  });

  it('refuses a lead belonging to someone else, and leaves it in place', async () => {
    const mine = await anOwnerWithALead();
    const theirs = await anOwnerWithALead();

    const res = await app.inject({
      method: 'DELETE',
      url: `/leads/${theirs.leadId}`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: mine.cookie },
    });

    // 404, not 403: a 403 confirms the id exists. Only the owner's own rows
    // may ever be deleted, and the scope that enforces that lives in the
    // query, not in a check applied after the read.
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(await app.prisma.lead.findUnique({ where: { id: theirs.leadId } })).not.toBeNull();
  });

  it('refuses an unauthenticated caller', async () => {
    const mine = await anOwnerWithALead();

    const res = await app.inject({
      method: 'DELETE',
      url: `/leads/${mine.leadId}`,
      remoteAddress: from(),
    });

    expect(res.statusCode).toBe(401);
    expect(await app.prisma.lead.findUnique({ where: { id: mine.leadId } })).not.toBeNull();
  });
});
