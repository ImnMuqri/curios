import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL_TEST } },
});

describe('schema', () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates an account with a google identity and a page', async () => {
    const account = await prisma.account.create({
      data: {
        email: 'nadia@example.com',
        identities: {
          create: { provider: 'GOOGLE', providerUserId: 'google-sub-1', email: 'nadia@example.com' },
        },
        pages: { create: { handle: 'nadia', skeleton: 'nadia', displayName: 'Nadia Bakes' } },
      },
      include: { identities: true, pages: true },
    });

    expect(account.identities).toHaveLength(1);
    expect(account.pages[0]?.handle).toBe('nadia');
    expect(account.pages[0]?.mode).toBe('BUSINESS');
  });

  it('rejects a duplicate normalized claim on the same page', async () => {
    const page = await prisma.page.findFirstOrThrow({ where: { handle: 'nadia' } });
    const base = { pageId: page.id, category: 'PRICE' as const, confidence: 0.9 };

    await prisma.fact.create({
      data: { ...base, claim: 'Kek 1kg butter RM95', normalizedClaim: 'kek 1kg butter rm95' },
    });

    await expect(
      prisma.fact.create({
        data: { ...base, claim: 'Kek 1kg Butter — RM95!', normalizedClaim: 'kek 1kg butter rm95' },
      }),
    ).rejects.toThrow();
  });

  it('rejects a duplicate google identity', async () => {
    await expect(
      prisma.account.create({
        data: {
          email: 'other@example.com',
          identities: {
            create: { provider: 'GOOGLE', providerUserId: 'google-sub-1', email: 'other@example.com' },
          },
        },
      }),
    ).rejects.toThrow();
  });

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
});

describe('the owner surface columns', () => {
  it('refuses a second page for one account', async () => {
    const account = await prisma.account.create({
      data: { email: `one-page-${randomUUID()}@example.com` },
      select: { id: true },
    });
    await prisma.page.create({
      data: {
        accountId: account.id,
        handle: `first-${randomUUID().slice(0, 8)}`,
        skeleton: `first-${randomUUID().slice(0, 8)}`,
        displayName: 'First',
      },
    });

    // One page per account was a slice 1 convention enforced nowhere. The
    // database is the only place it can be enforced against a code path that
    // forgets to check.
    await expect(
      prisma.page.create({
        data: {
          accountId: account.id,
          handle: `second-${randomUUID().slice(0, 8)}`,
          skeleton: `second-${randomUUID().slice(0, 8)}`,
          displayName: 'Second',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses two handles that share a skeleton', async () => {
    const one = await prisma.account.create({
      data: { email: `sk-a-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const two = await prisma.account.create({
      data: { email: `sk-b-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const skeleton = `shape-${randomUUID().slice(0, 8)}`;

    await prisma.page.create({
      data: { accountId: one.id, handle: `${skeleton}-a`, skeleton, displayName: 'A' },
    });

    // Distinct handles, one skeleton. This is the constraint that makes the
    // confusables check atomic instead of a read-then-write race.
    await expect(
      prisma.page.create({
        data: { accountId: two.id, handle: `${skeleton}-b`, skeleton, displayName: 'B' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('keeps a rejected fact as a row', async () => {
    const account = await prisma.account.create({
      data: { email: `rej-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const page = await prisma.page.create({
      data: {
        accountId: account.id,
        handle: `rej-${randomUUID().slice(0, 8)}`,
        skeleton: `rej-${randomUUID().slice(0, 8)}`,
        displayName: 'R',
      },
      select: { id: true },
    });
    const fact = await prisma.fact.create({
      data: {
        pageId: page.id,
        category: 'PRICE',
        claim: 'we are halal certified',
        normalizedClaim: 'we are halal certified',
        confidence: 0.9,
        rejectedAt: new Date(),
      },
      select: { id: true, rejectedAt: true },
    });

    // A hard delete would be undone by the next crawl: extraction writes with
    // skipDuplicates against @@unique([pageId, normalizedClaim]), so the row
    // is what suppresses the re-ask.
    expect(fact.rejectedAt).not.toBeNull();
  });

  it('lets two pages use the same faq slug but not one page twice', async () => {
    // Per page, not global. Two bakeries may both answer "berapa harga kek" and
    // both deserve the readable URL; the same page cannot have two questions
    // resolving to one route.
    const [one, two] = await Promise.all([
      prisma.account.create({ data: { email: `faq-a-${randomUUID()}@example.com` }, select: { id: true } }),
      prisma.account.create({ data: { email: `faq-b-${randomUUID()}@example.com` }, select: { id: true } }),
    ]);

    const mk = async (accountId: string) => {
      const skeleton = `faq-${randomUUID().slice(0, 8)}`;
      const page = await prisma.page.create({
        data: { accountId, handle: skeleton, skeleton, displayName: 'Nadia Bakes' },
        select: { id: true },
      });
      return page.id;
    };

    const [pageOne, pageTwo] = await Promise.all([mk(one.id), mk(two.id)]);

    await prisma.question.create({
      data: { pageId: pageOne, text: 'Berapa harga?', normalizedQuestion: 'berapa harga', faqSlug: 'berapa-harga' },
    });
    // Same slug, different page: allowed.
    await expect(
      prisma.question.create({
        data: { pageId: pageTwo, text: 'Berapa harga?', normalizedQuestion: 'berapa harga', faqSlug: 'berapa-harga' },
      }),
    ).resolves.toBeTruthy();

    // Same slug, same page: refused.
    await expect(
      prisma.question.create({
        data: { pageId: pageOne, text: 'Harga berapa?', normalizedQuestion: 'harga berapa', faqSlug: 'berapa-harga' },
      }),
    ).rejects.toThrow();
  });

  it('leaves faqSlug null for a question that has not earned a page', async () => {
    // The default, and the state most questions stay in forever.
    const account = await prisma.account.create({
      data: { email: `faq-null-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const skeleton = `faq-${randomUUID().slice(0, 8)}`;
    const page = await prisma.page.create({
      data: { accountId: account.id, handle: skeleton, skeleton, displayName: 'Nadia Bakes' },
      select: { id: true },
    });

    const question = await prisma.question.create({
      data: { pageId: page.id, text: 'Ada kek halal?', normalizedQuestion: 'ada kek halal' },
      select: { faqSlug: true },
    });

    expect(question.faqSlug).toBeNull();
  });

  it('allows multiple null faqSlugs on the same page — the dominant real-world case', async () => {
    // Most questions on a page stay in faqSlug=null state forever: they never earn
    // enough asks to justify a public page. The unique constraint must permit this.
    // PostgreSQL's unique-index default is NULLS DISTINCT (each NULL is treated as
    // distinct), which is why this works. A future migration using NULLS NOT DISTINCT
    // or a check constraint would silently break question logging for any second
    // distinct question asked on any page.
    const account = await prisma.account.create({
      data: { email: `faq-multi-null-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const skeleton = `faq-${randomUUID().slice(0, 8)}`;
    const page = await prisma.page.create({
      data: { accountId: account.id, handle: skeleton, skeleton, displayName: 'Multi Q Page' },
      select: { id: true },
    });

    // Create two questions on the same page, both with faqSlug omitted.
    // They need different normalizedQuestion values to avoid violating the other unique constraint.
    const [q1, q2] = await Promise.all([
      prisma.question.create({
        data: { pageId: page.id, text: 'Question one?', normalizedQuestion: 'question one' },
        select: { faqSlug: true },
      }),
      prisma.question.create({
        data: { pageId: page.id, text: 'Question two?', normalizedQuestion: 'question two' },
        select: { faqSlug: true },
      }),
    ]);

    // Both must be null and both must succeed (no constraint violation).
    expect(q1.faqSlug).toBeNull();
    expect(q2.faqSlug).toBeNull();
  });

  it('starts a page unpaid with no leads captured', async () => {
    // The state every page begins in, and the one the trial is measured from.
    const account = await prisma.account.create({
      data: { email: `plan-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const skeleton = `plan-${randomUUID().slice(0, 8)}`;

    const page = await prisma.page.create({
      data: { accountId: account.id, handle: skeleton, skeleton, displayName: 'Nadia Bakes' },
      select: { paidUntil: true, leadsCaptured: true },
    });

    expect(page.paidUntil).toBeNull();
    expect(page.leadsCaptured).toBe(0);
  });

  it('refuses a null leadsCaptured, not only defaulting it to zero', async () => {
    // The default proves a page starts at 0. It does not prove the column cannot
    // hold a null: `Int? @default(0)` passes the test above just as well. The
    // constraint matters because OPERATIONS.md has operators write this column
    // by hand, and a null that reached canCapture would read as `null < 3` --
    // true in JavaScript -- so the page would capture for ever. Written through
    // raw SQL because the Prisma client rejects a null for a required field
    // before it reaches the database, and the database's own constraint is the
    // thing under test.
    const account = await prisma.account.create({
      data: { email: `plan-null-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const skeleton = `plan-${randomUUID().slice(0, 8)}`;
    const page = await prisma.page.create({
      data: { accountId: account.id, handle: skeleton, skeleton, displayName: 'Nadia Bakes' },
      select: { id: true },
    });

    // 23502 is Postgres's not_null_violation. Asserted by code, not by column
    // name: Prisma surfaces the failing row's detail rather than the message
    // naming the column. The statement sets only leadsCaptured, so that code can
    // only mean this column refused the null -- where a bare `toThrow()` would
    // also pass on a parameter that failed to bind.
    await expect(
      prisma.$executeRawUnsafe('UPDATE "Page" SET "leadsCaptured" = NULL WHERE id = $1', page.id),
    ).rejects.toThrow(/23502/);
  });

  it('starts a payment pending, with nothing paid or granted yet', async () => {
    const pageId = await aPageForPayments();
    const payment = await prisma.payment.create({
      data: { pageId, plan: 'MONTHLY', amountCents: 3900, billplzCollectionId: 'col-test' },
      select: { status: true, paidAt: true, grantedUntil: true, billplzBillId: true },
    });

    expect(payment).toEqual({ status: 'PENDING', paidAt: null, grantedUntil: null, billplzBillId: null });
  });

  it('starts a page with its trial reset unused and no reminder recorded', async () => {
    // Both columns are read as "has this happened yet", so their default is the
    // whole of their meaning: the reset's conditional update requires
    // trialResetAt null, and the reminder job treats null as never reminded.
    const pageId = await aPageForPayments();

    const page = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { trialResetAt: true, renewalReminderFor: true },
    });

    expect(page).toEqual({ trialResetAt: null, renewalReminderFor: null });
  });

  it('keeps both stamps once they are written', async () => {
    const pageId = await aPageForPayments();
    const resetAt = new Date('2026-09-17T02:00:00.000Z');
    const remindedFor = new Date('2026-10-01T00:00:00.000Z');

    const page = await prisma.page.update({
      where: { id: pageId },
      data: { trialResetAt: resetAt, renewalReminderFor: remindedFor },
      select: { trialResetAt: true, renewalReminderFor: true },
    });

    expect(page).toEqual({ trialResetAt: resetAt, renewalReminderFor: remindedFor });
  });

  it('refuses a second payment carrying the same Billplz bill id', async () => {
    // The unique index is what lets one bill grant exactly once.
    const pageId = await aPageForPayments();
    const billplzBillId = `bill-${randomUUID()}`;
    const data = { pageId, plan: 'MONTHLY' as const, amountCents: 3900, billplzCollectionId: 'col-test', billplzBillId };
    await prisma.payment.create({ data });

    await expect(prisma.payment.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows any number of payments that never got a bill id', async () => {
    // A failed call to Billplz leaves a pending row with no bill id. Several of
    // those must not collide on the unique index.
    const pageId = await aPageForPayments();
    const data = { pageId, plan: 'ANNUAL' as const, amountCents: 39000, billplzCollectionId: 'col-test' };
    await prisma.payment.create({ data });

    await expect(prisma.payment.create({ data })).resolves.toBeTruthy();
  });

  it('will not delete a page that has a payment', async () => {
    // Restrict, where every other table cascades: a payment is a financial
    // record and must not vanish as a side effect of removing a page.
    const pageId = await aPageForPayments();
    await prisma.payment.create({
      data: { pageId, plan: 'MONTHLY', amountCents: 3900, billplzCollectionId: 'col-test' },
    });

    await expect(prisma.page.delete({ where: { id: pageId } })).rejects.toMatchObject({ code: 'P2003' });
  });
});

async function aPageForPayments(): Promise<string> {
  const skeleton = `pay-${randomUUID().slice(0, 8)}`;
  const account = await prisma.account.create({
    data: {
      email: `payments-${randomUUID()}@example.com`,
      pages: { create: { handle: skeleton, skeleton, displayName: 'Nadia Bakes' } },
    },
    select: { pages: { select: { id: true } } },
  });
  return account.pages[0]?.id ?? '';
}
