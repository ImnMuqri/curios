import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getOwnerPage } from './owner-page.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

async function anAccount(page?: { published: boolean }): Promise<string> {
  const slug = randomUUID().slice(0, 8);
  const account = await write.account.create({
    data: {
      email: `owner-page-${randomUUID()}@example.com`,
      ...(page
        ? {
            pages: {
              create: {
                handle: `op-${slug}`,
                skeleton: `op-${slug}`,
                displayName: 'A Shop',
                published: page.published,
              },
            },
          }
        : {}),
    },
    select: { id: true },
  });
  return account.id;
}

describe('getOwnerPage', () => {
  it('returns null for an account that has not claimed a handle yet', async () => {
    // The branch the onboarding flow opens with. Without this the web app
    // cannot tell a new owner from a returning one.
    expect(await getOwnerPage(await anAccount())).toBeNull();
  });

  it('returns an UNPUBLISHED page', async () => {
    const accountId = await anAccount({ published: false });

    // The property that makes this a separate query rather than a reuse of
    // getPublicPage, which filters published: true and would therefore report
    // "no page" for every owner who has not published yet -- which is all of
    // them, at exactly the moment the dashboard needs to know.
    const page = await getOwnerPage(accountId);

    expect(page).not.toBeNull();
    expect(page?.published).toBe(false);
    expect(page?.displayName).toBe('A Shop');
    expect(page?.handle).toMatch(/^op-/);
  });

  it('returns a published page too', async () => {
    const page = await getOwnerPage(await anAccount({ published: true }));

    expect(page?.published).toBe(true);
  });

  it('does not return another owner page', async () => {
    const owner = await anAccount({ published: true });
    const stranger = await anAccount();

    // Both halves, deliberately. Asserting only that the stranger gets null
    // would pass just as well against an empty table, or against a query that
    // returns null for everyone. Proving the decoy IS findable by its owner is
    // what makes the stranger's null mean the filter worked.
    expect(await getOwnerPage(owner)).not.toBeNull();
    expect(await getOwnerPage(stranger)).toBeNull();
  });

  it('carries the plan columns the leads screen explains itself from', async () => {
    // Non-default values on purpose. A page left at mode BUSINESS, paidUntil
    // null and leadsCaptured 0 would pass an assertion against those defaults
    // whether or not the select actually read the columns -- so each is set to
    // something a default could never produce.
    const slug = randomUUID().slice(0, 8);
    const paidUntil = new Date('2026-11-01T00:00:00.000Z');
    const account = await write.account.create({
      data: {
        email: `owner-page-plan-${randomUUID()}@example.com`,
        pages: {
          create: {
            handle: `op-${slug}`,
            skeleton: `op-${slug}`,
            displayName: 'A Shop',
            published: true,
            mode: 'PERSONAL',
            paidUntil,
            leadsCaptured: 2,
          },
        },
      },
      select: { id: true },
    });

    const page = await getOwnerPage(account.id);

    expect(page?.mode).toBe('PERSONAL');
    expect(page?.leadsCaptured).toBe(2);
    expect(page?.paidUntil?.toISOString()).toBe(paidUntil.toISOString());
  });

  it('carries whether the one trial reset has been spent', async () => {
    const accountId = await anAccount({ published: true });
    const before = await getOwnerPage(accountId);
    expect(before?.trialResetAt).toBeNull();

    const spentAt = new Date('2026-09-17T02:00:00.000Z');
    await write.page.updateMany({ where: { accountId }, data: { trialResetAt: spentAt } });

    // Without this column the screen would offer a reset the API then refuses,
    // which is worse than not offering one.
    expect((await getOwnerPage(accountId))?.trialResetAt).toEqual(spentAt);
  });

  it('carries the search-indexing choice, for the Settings switch', async () => {
    const accountId = await anAccount({ published: true });
    expect((await getOwnerPage(accountId))?.allowSearchIndexing).toBe(false);

    await write.page.updateMany({ where: { accountId }, data: { allowSearchIndexing: true } });

    expect((await getOwnerPage(accountId))?.allowSearchIndexing).toBe(true);
  });

  it('does not write, so the read-only role can run it', async () => {
    const accountId = await anAccount({ published: false });
    const before = await write.page.findFirst({ where: { accountId }, select: { published: true } });

    await getOwnerPage(accountId);

    // Runs as curios_readonly. A write here fails in Postgres with SQLSTATE
    // 42501 rather than in review -- the property the whole db-read boundary
    // exists to hold.
    const after = await write.page.findFirst({ where: { accountId }, select: { published: true } });
    expect(after?.published).toBe(before?.published);
  });
});
