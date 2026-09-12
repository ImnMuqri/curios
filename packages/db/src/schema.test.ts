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
});
