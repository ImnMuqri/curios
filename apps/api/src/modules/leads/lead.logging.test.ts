import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createSession, SESSION_COOKIE } from '../auth/session.service.js';

/**
 * A real Malaysian mobile number. Every stored/logged spelling this app ever
 * produces -- raw '0123456789', normalized '+60123456789', or a bare
 * '60123456789' -- shares this same 9-digit national-number substring, so
 * checking for it alone catches a leak in any of those forms rather than
 * just the one this test happens to send over the wire.
 */
const PHONE_RAW = '0123456789';
const PHONE_NORMALIZED = '+60123456789';
const PHONE_DIGITS = '123456789';

let app: FastifyInstance;
const lines: string[] = [];
// Typed as what it actually wraps. `ReturnType<typeof vi.spyOn>` resolves to
// the generic default, `MockInstance<(...args: unknown[]) => unknown>`, which
// the overloaded `process.stdout.write` spy is not assignable to -- vitest ran
// this file green regardless, since it does not typecheck, and tsc did not.
let writeSpy: MockInstance<typeof process.stdout.write>;

let nth = 0;
const from = () => `203.0.117.${(nth++ % 200) + 1}`;

beforeAll(async () => {
  // The spy has to exist *before* buildApp() constructs Fastify's pino
  // instance, not after. pino decides at construction time (pino/lib/tools.js,
  // hasBeenTampered) whether to write through process.stdout or to bypass it
  // entirely with a raw file-descriptor SonicBoom stream -- and with
  // `logger: true` (apps/api/src/app.ts) and no explicit stream, it takes the
  // fd bypass whenever process.stdout looks untouched. Installing the spy
  // first makes process.stdout.write differ from its own prototype method, so
  // pino's tamper check trips and it falls back to logging through
  // process.stdout -- which is the only way this spy can see anything at all.
  // (Verified empirically before writing this file: spying after buildApp()
  // captures nothing; spying before it captures every log line.)
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    lines.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  });
  const { buildApp } = await import('../../app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  writeSpy.mockRestore();
  await app.close();
});

/** Three visitor turns, the last carrying a standalone number: a qualifying
 * thread, the same shape lead.service.test.ts's aQualifyingConversation and
 * lead.routes.test.ts's aPageWithConversation use. */
async function aQualifyingConversation() {
  const slug = `ll-${randomUUID().slice(0, 8)}`;
  const account = await app.prisma.account.create({
    data: {
      email: `lead-log-${randomUUID()}@example.com`,
      pages: {
        create: { handle: slug, skeleton: slug, displayName: 'LL Bakes', published: true },
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

async function anOwnerWithALead(phone: string) {
  const slug = `ll-${randomUUID().slice(0, 8)}`;
  const account = await app.prisma.account.create({
    data: {
      email: `lead-log-owner-${randomUUID()}@example.com`,
      pages: { create: { handle: slug, skeleton: slug, displayName: 'LL Owner' } },
    },
    select: { id: true, pages: { select: { id: true } } },
  });
  const pageId = account.pages[0]?.id ?? '';
  const conversation = await app.prisma.conversation.create({ data: { pageId } });
  const lead = await app.prisma.lead.create({
    data: { pageId, conversationId: conversation.id, phone },
    select: { id: true },
  });
  const { value } = await createSession(app.prisma, account.id);
  return { cookie: value, leadId: lead.id };
}

describe('a phone number never reaches the API log', () => {
  it('does not appear in any log line around POST /leads or DELETE /leads/:id', async () => {
    const conversationId = await aQualifyingConversation();

    const postRes = await app.inject({
      method: 'POST',
      url: '/leads',
      remoteAddress: from(),
      payload: { conversationId, phone: PHONE_RAW, consent: true },
    });
    expect(postRes.statusCode).toBe(201);

    // Same number, seeded straight into a lead this owner then deletes --
    // DELETE /leads/:id never takes a phone number as input, so the only way
    // it could leak one is by echoing the deleted row rather than just its id.
    const owner = await anOwnerWithALead(PHONE_NORMALIZED);
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/leads/${owner.leadId}`,
      remoteAddress: from(),
      cookies: { [SESSION_COOKIE]: owner.cookie },
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(deleteRes.statusCode).toBe(200);

    const joined = lines.join('\n');

    // Sanity first: prove the spy is actually wired to real log traffic
    // before trusting its silence about the phone number. An empty capture
    // would make the assertion below vacuously true -- passing, but for the
    // wrong reason. lead.routes.ts logs exactly these two messages, and only
    // the leadId alongside them.
    expect(lines.length).toBeGreaterThan(0);
    expect(joined).toContain('lead captured');
    expect(joined).toContain('lead deleted');

    // The actual claim: no emitted line -- not the two above, not Fastify's
    // own incoming-request/request-completed lines, not anything else pino
    // wrote for this app instance -- contains the phone's digits, in raw or
    // normalized form.
    expect(joined).not.toContain(PHONE_DIGITS);
  });
});
