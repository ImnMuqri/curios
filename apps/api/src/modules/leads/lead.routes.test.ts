import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FREE_LEADS } from '@curios/core';
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

/**
 * A page and a conversation on it, the conversation qualifying by default
 * (three visitor turns, the last carrying a standalone number) -- the same
 * shape `lead.plan.test.ts`'s `readyToCapture` and `lead.service.test.ts`'s
 * `aQualifyingConversation` use, reused rather than reinvented. `plan` lets a
 * test push the page across the trial boundary without touching the
 * conversation at all, so a refusal here is pinned to `canCapture`, not to
 * `qualifies`.
 */
async function aPageWithConversation(
  plan: { paidUntil?: Date | null; leadsCaptured?: number } = {},
) {
  const slug = `lp-${randomUUID().slice(0, 8)}`;
  const account = await app.prisma.account.create({
    data: {
      email: `lead-post-${randomUUID()}@example.com`,
      pages: {
        create: {
          handle: slug,
          skeleton: slug,
          displayName: 'LP Bakes',
          published: true,
          paidUntil: plan.paidUntil ?? null,
          leadsCaptured: plan.leadsCaptured ?? 0,
        },
      },
    },
    select: { pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]?.id ?? '';
  const conversation = await app.prisma.conversation.create({
    data: {
      pageId,
      messages: {
        create: [
          { role: 'USER', content: 'ada kek butter?' },
          { role: 'ASSISTANT', content: 'Ada, RM95 sekilo.' },
          { role: 'USER', content: 'yang besar' },
          { role: 'ASSISTANT', content: 'RM160 untuk 2kg.' },
          { role: 'USER', content: 'nak 2kg untuk 20 Mac' },
        ],
      },
    },
    select: { id: true },
  });
  return conversation.id;
}

/**
 * A page still inside its trial (so a refusal here cannot be `canCapture`'s
 * doing) whose conversation never qualifies -- one visitor turn, no
 * standalone number. The `NOT_QUALIFIED` a caller gets from this must be
 * indistinguishable from the one `aPageWithConversation({ leadsCaptured:
 * FREE_LEADS })` produces; see the "byte-identical" test below.
 */
async function aPageWithAnUnqualifiedConversation() {
  const slug = `lu-${randomUUID().slice(0, 8)}`;
  const account = await app.prisma.account.create({
    data: {
      email: `lead-post-${randomUUID()}@example.com`,
      pages: {
        create: { handle: slug, skeleton: slug, displayName: 'LU Bakes', published: true },
      },
    },
    select: { pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]?.id ?? '';
  const conversation = await app.prisma.conversation.create({
    data: { pageId, messages: { create: [{ role: 'USER', content: 'buka tak?' }] } },
    select: { id: true },
  });
  return conversation.id;
}

describe('POST /leads', () => {
  it('captures over real HTTP for a page inside its trial', async () => {
    const conversationId = await aPageWithConversation({ leadsCaptured: 0 });

    const res = await app.inject({
      method: 'POST',
      url: '/leads',
      remoteAddress: from(),
      payload: { conversationId, phone: '0123456789', consent: true },
    });

    // { leadId: string } and nothing else -- the route's declared 201 schema.
    // fastify-type-provider-zod's serializer would already refuse to send a
    // response that didn't match it; asserting the exact shape here pins that
    // contract in the test rather than only in the route's own schema.
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ leadId: expect.any(String) });
    expect(await app.prisma.lead.findUnique({ where: { id: res.json().leadId } })).not.toBeNull();
  });

  it('refuses a trial-spent conversation with 400 NOT_QUALIFIED', async () => {
    const conversationId = await aPageWithConversation({ leadsCaptured: FREE_LEADS });

    const res = await app.inject({
      method: 'POST',
      url: '/leads',
      remoteAddress: from(),
      payload: { conversationId, phone: '0123456789', consent: true },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: 'NOT_QUALIFIED', message: expect.any(String) },
    });
  });

  it('refuses a trial-spent conversation identically to one that never qualified', async () => {
    // Deliberate, and the whole reason lead.service.ts's plan gate reuses
    // NotQualifiedError: a distinguishable billing error would make this
    // endpoint an oracle for the owner's billing status, readable by anyone
    // with curl. Asserting the two responses equal each other -- not each
    // against a hard-coded literal -- keeps this test meaningful if the copy
    // in lead.service.ts ever changes; it pins the *sameness*, not the words.
    const spentConversationId = await aPageWithConversation({ leadsCaptured: FREE_LEADS });
    const unqualifiedConversationId = await aPageWithAnUnqualifiedConversation();

    const spentRes = await app.inject({
      method: 'POST',
      url: '/leads',
      remoteAddress: from(),
      payload: { conversationId: spentConversationId, phone: '0123456789', consent: true },
    });
    const unqualifiedRes = await app.inject({
      method: 'POST',
      url: '/leads',
      remoteAddress: from(),
      payload: { conversationId: unqualifiedConversationId, phone: '0123456789', consent: true },
    });

    expect(spentRes.statusCode).toBe(unqualifiedRes.statusCode);
    expect(spentRes.json()).toEqual(unqualifiedRes.json());
  });
});

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

describe('PATCH /leads/:id', () => {
  const patch = (leadId: string, cookie: string | undefined, status: string) =>
    app.inject({
      method: 'PATCH',
      url: `/leads/${leadId}`,
      remoteAddress: from(),
      ...(cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {}),
      payload: { status },
    });

  it('moves a lead the owner owns through contacted, sold and closed, and back', async () => {
    const mine = await anOwnerWithALead();
    for (const status of ['CONTACTED', 'SOLD', 'CLOSED', 'NEW']) {
      const res = await patch(mine.leadId, mine.cookie, status);
      expect(res.statusCode).toBe(200);
      expect((await app.prisma.lead.findUniqueOrThrow({ where: { id: mine.leadId } })).status).toBe(status);
    }
  });

  it('refuses a status that does not exist', async () => {
    const mine = await anOwnerWithALead();
    expect((await patch(mine.leadId, mine.cookie, 'WON')).statusCode).toBe(400);
  });

  it("refuses someone else's lead, and leaves it as it was", async () => {
    const mine = await anOwnerWithALead();
    const theirs = await anOwnerWithALead();
    const res = await patch(theirs.leadId, mine.cookie, 'CLOSED');
    expect(res.statusCode).toBe(404);
    expect((await app.prisma.lead.findUniqueOrThrow({ where: { id: theirs.leadId } })).status).toBe('NEW');
  });

  it('refuses an unauthenticated caller', async () => {
    const mine = await anOwnerWithALead();
    expect((await patch(mine.leadId, undefined, 'CLOSED')).statusCode).toBe(401);
  });
});
