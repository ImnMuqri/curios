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
    await anAccount({ published: true });
    const stranger = await anAccount();

    // Scoped by accountId in the query. The same rule every other query in
    // this plan follows, on a read that carries a handle and a display name.
    expect(await getOwnerPage(stranger)).toBeNull();
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
