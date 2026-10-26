import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { decodeVector, encodeVector, EMBEDDING_MODEL } from '@curios/embeddings';

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
    // both deserve the readable URL; the same page cannot have two topics
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

    await prisma.topic.create({ data: { pageId: pageOne, title: 'Berapa harga?', faqSlug: 'berapa-harga' } });
    // Same slug, different page: allowed.
    await expect(
      prisma.topic.create({ data: { pageId: pageTwo, title: 'Berapa harga?', faqSlug: 'berapa-harga' } }),
    ).resolves.toBeTruthy();

    // Same slug, same page: refused.
    await expect(
      prisma.topic.create({ data: { pageId: pageOne, title: 'Harga berapa?', faqSlug: 'berapa-harga' } }),
    ).rejects.toThrow();
  });

  it('leaves faqSlug null for a topic that has not earned a page', async () => {
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

    const topic = await prisma.topic.create({
      data: { pageId: page.id, title: 'Ada kek halal?' },
      select: { faqSlug: true },
    });

    expect(topic.faqSlug).toBeNull();
  });

  it('allows multiple null faqSlugs on the same page — the dominant real-world case', async () => {
    // Most topics on a page stay in faqSlug=null state forever: they never earn
    // enough asks to justify a public page. The unique constraint must permit this.
    // PostgreSQL's unique-index default is NULLS DISTINCT (each NULL is treated as
    // distinct), which is why this works. A future migration using NULLS NOT DISTINCT
    // or a check constraint would silently break topic creation for any second
    // distinct topic on any page.
    const account = await prisma.account.create({
      data: { email: `faq-multi-null-${randomUUID()}@example.com` },
      select: { id: true },
    });
    const skeleton = `faq-${randomUUID().slice(0, 8)}`;
    const page = await prisma.page.create({
      data: { accountId: account.id, handle: skeleton, skeleton, displayName: 'Multi Q Page' },
      select: { id: true },
    });

    // Create two topics on the same page, both with faqSlug omitted.
    const [q1, q2] = await Promise.all([
      prisma.topic.create({ data: { pageId: page.id, title: 'Question one?' }, select: { faqSlug: true } }),
      prisma.topic.create({ data: { pageId: page.id, title: 'Question two?' }, select: { faqSlug: true } }),
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

  it('creates a CHIP payment pending, with no reference yet', async () => {
    const pageId = await aPageForPayments();
    const payment = await prisma.payment.create({
      data: { pageId, plan: 'MONTHLY', amountCents: 3900 },
      select: { provider: true, status: true, providerRef: true, autoRenew: true, autoRenewal: true, paidAt: true, grantedUntil: true },
    });

    expect(payment).toEqual({
      provider: 'CHIP',
      status: 'PENDING',
      providerRef: null,
      autoRenew: false,
      autoRenewal: false,
      paidAt: null,
      grantedUntil: null,
    });
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

  it('keeps a new page out of search results until its owner says otherwise', async () => {
    const pageId = await aPageForPayments();

    const page = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { allowSearchIndexing: true },
    });

    expect(page.allowSearchIndexing).toBe(false);
  });

  it('accepts an ingestion from pasted text alone', async () => {
    const pageId = await aPageForPayments();

    const ingestion = await prisma.ingestion.create({
      data: { pageId, pastedText: 'I bake cakes in Shah Alam.' },
      select: { sourceUrl: true, pastedText: true },
    });

    expect(ingestion).toEqual({ sourceUrl: null, pastedText: 'I bake cakes in Shah Alam.' });
  });

  it('refuses an ingestion with both a website address and pasted text', async () => {
    // Raw SQL, because Prisma's own types would let this through and only the
    // database constraint can refuse it. 23514 is Postgres's check violation.
    const pageId = await aPageForPayments();

    await expect(
      prisma.$executeRaw`INSERT INTO "Ingestion" ("id", "pageId", "sourceUrl", "pastedText", "updatedAt")
        VALUES (${`ing-${randomUUID()}`}, ${pageId}, 'https://nadia.example/', 'About me', now())`,
    ).rejects.toThrow(/23514/);
  });

  it('refuses an ingestion with neither', async () => {
    const pageId = await aPageForPayments();

    await expect(
      prisma.$executeRaw`INSERT INTO "Ingestion" ("id", "pageId", "updatedAt")
        VALUES (${`ing-${randomUUID()}`}, ${pageId}, now())`,
    ).rejects.toThrow(/23514/);
  });

  it('refuses a second payment carrying the same provider reference', async () => {
    // The unique index is what lets one purchase grant exactly once.
    const pageId = await aPageForPayments();
    const providerRef = `purchase-${randomUUID()}`;
    const data = { pageId, plan: 'MONTHLY' as const, amountCents: 3900, providerRef };
    await prisma.payment.create({ data });

    await expect(prisma.payment.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows any number of payments with no reference yet', async () => {
    // A failed call to the provider leaves a pending row with no reference.
    // Several of those must not collide on the unique index.
    const pageId = await aPageForPayments();
    const data = { pageId, plan: 'ANNUAL' as const, amountCents: 39000 };
    await prisma.payment.create({ data });

    await expect(prisma.payment.create({ data })).resolves.toBeTruthy();
  });

  it('keeps a payment, with its page handle and owner email, when the page is deleted', async () => {
    // SetNull: a payment is a financial record and outlives its page; the copied
    // handle and email still say whose it was.
    const pageId = await aPageForPayments();
    const { id } = await prisma.payment.create({
      data: { pageId, plan: 'MONTHLY', amountCents: 3900, pageHandle: 'gone-shop', ownerEmail: 'gone@example.com' },
    });

    await prisma.page.delete({ where: { id: pageId } });

    await expect(prisma.payment.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({
      pageId: null,
      pageHandle: 'gone-shop',
      ownerEmail: 'gone@example.com',
    });
  });

  it('keeps one renewal card per page, deleted with the page', async () => {
    const pageId = await aPageForPayments();
    await prisma.renewalCard.create({ data: { pageId, token: `tok-${randomUUID()}`, plan: 'MONTHLY' } });

    await expect(
      prisma.renewalCard.create({ data: { pageId, token: `tok-${randomUUID()}`, plan: 'ANNUAL' } }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await prisma.page.delete({ where: { id: pageId } });
    expect(await prisma.renewalCard.count({ where: { pageId } })).toBe(0);
  });
});

describe('the shelf', () => {
  it('stores an item with options and cascades both away with the page', async () => {
    const pageId = await aPageForPayments();
    const item = await prisma.item.create({
      data: {
        pageId,
        name: 'Kek Batik',
        slug: 'kek-batik',
        position: 0,
        options: {
          create: [
            { label: '1kg', priceCents: 9500, position: 0 },
            { label: '2kg', priceCents: 17000, position: 1 },
          ],
        },
      },
      include: { options: true },
    });
    expect(item.available).toBe(true);
    expect(item.priceCents).toBeNull();
    expect(item.options).toHaveLength(2);

    const shop = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    expect(shop).toMatchObject({
      storeEnabled: false,
      pickupEnabled: false,
      deliveryMode: 'NONE',
      minNoticeDays: 1,
      shopTilePosition: 0,
      shopTileSize: null,
    });

    await prisma.page.delete({ where: { id: pageId } });
    expect(await prisma.item.count({ where: { id: item.id } })).toBe(0);
    expect(await prisma.itemOption.count({ where: { itemId: item.id } })).toBe(0);
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

async function seedPage(): Promise<{ id: string }> {
  const account = await prisma.account.create({
    data: { email: `embed-${randomUUID()}@example.com` },
    select: { id: true },
  });
  const skeleton = `embed-${randomUUID().slice(0, 8)}`;
  return prisma.page.create({
    data: { accountId: account.id, handle: skeleton, skeleton, displayName: 'Nadia Bakes' },
    select: { id: true },
  });
}

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

  // Not in the brief. Later tasks filter on `Fact.embedding` as a single
  // nullable relation (see the interface note in the task brief), but nothing
  // above ever reads that field -- every test so far goes through
  // `prisma.factEmbedding` directly. `embedding FactEmbedding?` and
  // `embedding FactEmbedding[]` compile to the identical foreign key and
  // produce an identical migration.sql (proved separately: `prisma migrate
  // diff` between the two schemas emits an empty migration), so a mutation
  // from `?` to `[]` passes every other test in this file and every gate.
  // Only the shape read through Prisma's generated client tells them apart.
  it('exposes the relation as a single nullable object, never a list', async () => {
    const page = await seedPage();
    const bare = await prisma.fact.create({
      data: {
        pageId: page.id,
        category: 'PRICE',
        claim: 'Susu RM8.',
        normalizedClaim: 'susu rm8',
        confidence: 1,
      },
      include: { embedding: true },
    });
    expect(bare.embedding).toBeNull();

    const fact = await prisma.fact.create({
      data: {
        pageId: page.id,
        category: 'PRICE',
        claim: 'Roti RM3.',
        normalizedClaim: 'roti rm3',
        confidence: 1,
      },
    });
    await prisma.factEmbedding.create({
      data: { factId: fact.id, vector: new Uint8Array(4), model: 'm', dims: 1 },
    });

    const found = await prisma.fact.findUniqueOrThrow({
      where: { id: fact.id },
      include: { embedding: true },
    });
    expect(Array.isArray(found.embedding)).toBe(false);
    expect(found.embedding?.factId).toBe(fact.id);
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

  // Not in the brief. FactEmbedding got a "holds one row per fact" test;
  // QuestionEmbedding did not get its equivalent, even though the same
  // `<col> @id` line is doing the same job (cache key uniqueness) on both
  // tables. Without this, dropping `@id` from `key` in favour of a separate
  // cuid id -- the same shape of mutation Step 7 names for FactEmbedding --
  // would pass every other test in this file.
  it('holds one row per key', async () => {
    const key = 'b'.repeat(64);
    await prisma.questionEmbedding.create({
      data: { key, vector: new Uint8Array(4), model: 'm', dims: 1 },
    });

    await expect(
      prisma.questionEmbedding.create({
        data: { key, vector: new Uint8Array(4), model: 'm', dims: 1 },
      }),
    ).rejects.toThrow();

    await prisma.questionEmbedding.deleteMany({ where: { key } });
  });
});

describe('digital items', () => {
  async function shopWithDigitalLine() {
    const account = await prisma.account.create({
      data: {
        email: `digital-${randomUUID()}@example.com`,
        pages: { create: { handle: `d${randomUUID().slice(0, 8)}`, skeleton: randomUUID(), displayName: 'Digital Shop' } },
      },
      include: { pages: true },
    });
    const page = account.pages[0]!;
    const item = await prisma.item.create({
      data: { pageId: page.id, name: 'Planner PDF', slug: 'planner', position: 0, priceCents: 1500, kind: 'DIGITAL', delivery: 'CODES' },
    });
    const order = await prisma.order.create({
      data: {
        pageId: page.id,
        number: 1,
        code: 'AB12',
        tokenHash: randomUUID(),
        customerName: 'Aina',
        phone: '+60123456789',
        email: 'aina@example.com',
        itemsCents: 1500,
        deliveryCents: 0,
        totalCents: 1500,
        lines: { create: { itemId: item.id, itemName: 'Planner PDF', unitPriceCents: 1500, quantity: 1, position: 0, kind: 'DIGITAL', delivery: 'CODES' } },
      },
      include: { lines: true },
    });
    return { account, item, order, line: order.lines[0]! };
  }

  it('defaults items and lines to PHYSICAL, and lets an order have no method or day', async () => {
    const { account, item, order } = await shopWithDigitalLine();
    const plain = await prisma.item.create({ data: { pageId: item.pageId, name: 'Cake', slug: 'cake', position: 1, priceCents: 100 } });
    expect(plain.kind).toBe('PHYSICAL');
    expect(plain.delivery).toBeNull();
    expect(order.method).toBeNull();
    expect(order.day).toBeNull();
    await prisma.account.delete({ where: { id: account.id } });
  });

  it('deleting an item with a given code keeps the order line; the code goes with the item', async () => {
    const { account, item, order, line } = await shopWithDigitalLine();
    const code = await prisma.itemCode.create({ data: { itemId: item.id, code: 'SERIAL-1', orderLineId: line.id, givenAt: new Date() } });
    await expect(prisma.itemCode.create({ data: { itemId: item.id, code: 'SERIAL-1' } })).rejects.toThrow();

    await prisma.item.delete({ where: { id: item.id } });

    expect(await prisma.itemCode.findUnique({ where: { id: code.id } })).toBeNull();
    const kept = await prisma.orderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(kept.orderId).toBe(order.id);
    expect(kept.itemId).toBeNull();
    await prisma.account.delete({ where: { id: account.id } });
  });

  it('an order line keeps kind and delivery after the item changes', async () => {
    const { account, item, line } = await shopWithDigitalLine();
    await prisma.item.update({ where: { id: item.id }, data: { kind: 'PHYSICAL', delivery: null } });
    const kept = await prisma.orderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(kept.kind).toBe('DIGITAL');
    expect(kept.delivery).toBe('CODES');
    await prisma.account.delete({ where: { id: account.id } });
  });

  it('a time with bookings cannot be deleted, and a line books once', async () => {
    const { account, item, line } = await shopWithDigitalLine();
    const session = await prisma.itemSession.create({ data: { itemId: item.id, startsAt: new Date(), seats: 2 } });
    await prisma.sessionBooking.create({ data: { sessionId: session.id, orderLineId: line.id, seats: 1 } });
    await expect(prisma.sessionBooking.create({ data: { sessionId: session.id, orderLineId: line.id, seats: 1 } })).rejects.toThrow();
    await expect(prisma.itemSession.delete({ where: { id: session.id } })).rejects.toThrow();
    await expect(prisma.item.delete({ where: { id: item.id } })).rejects.toThrow();
    await prisma.account.delete({ where: { id: account.id } });
  });

  it('deleting an account whose shop has a booked session succeeds and removes the booking', async () => {
    const { account, item, line } = await shopWithDigitalLine();
    const session = await prisma.itemSession.create({ data: { itemId: item.id, startsAt: new Date(), seats: 2 } });
    const booking = await prisma.sessionBooking.create({ data: { sessionId: session.id, orderLineId: line.id, seats: 1 } });
    await prisma.account.delete({ where: { id: account.id } });
    expect(await prisma.sessionBooking.findUnique({ where: { id: booking.id } })).toBeNull();
    expect(await prisma.itemSession.findUnique({ where: { id: session.id } })).toBeNull();
  });

  it('a download grant keeps its file name when the file is deleted', async () => {
    const { account, item, line } = await shopWithDigitalLine();
    const file = await prisma.itemFile.create({ data: { itemId: item.id, key: 'k', name: 'a.pdf', sizeBytes: 1, contentType: 'application/pdf', position: 0 } });
    const grant = await prisma.downloadGrant.create({
      data: { token: randomUUID(), orderLineId: line.id, fileId: file.id, fileName: 'a.pdf', usesLeft: 5, expiresAt: new Date() },
    });
    await prisma.itemFile.delete({ where: { id: file.id } });
    const kept = await prisma.downloadGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(kept.fileId).toBeNull();
    expect(kept.fileName).toBe('a.pdf');
    await prisma.account.delete({ where: { id: account.id } });
  });
});
