import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { countPendingFacts, getMyCurios } from './my-curios.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
let accountId = '';

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  const account = await write.account.create({
    data: {
      email: 'curios@example.com',
      pages: {
        create: {
          handle: 'iman',
          skeleton: 'iman',
          displayName: 'Iman Muqri',
          bio: 'Software developer.',
          accentColor: '#6d3fb3',
          links: {
            create: [
              { label: 'GitHub', url: 'https://github.com/iman', position: 1, size: 'WIDE' },
              { label: 'Portfolio', url: 'https://iman.dev', position: 0 },
            ],
          },
          facts: {
            create: [
              { category: 'MISC', claim: 'waiting', normalizedClaim: 'waiting', confidence: 1, verified: false },
              { category: 'MISC', claim: 'accepted', normalizedClaim: 'accepted', confidence: 1, verified: true },
              { category: 'MISC', claim: 'rejected', normalizedClaim: 'rejected', confidence: 1, verified: false, rejectedAt: new Date() },
            ],
          },
        },
      },
    },
    select: { id: true },
  });
  accountId = account.id;
});

afterAll(async () => {
  await write.$disconnect();
});

describe('getMyCurios', () => {
  it('returns the profile, appearance and links in the order visitors see them', async () => {
    const page = await getMyCurios(accountId);

    expect(page).toMatchObject({
      handle: 'iman',
      displayName: 'Iman Muqri',
      bio: 'Software developer.',
      style: 'SOFT',
      accentColor: '#6d3fb3',
      headingFont: 'JAKARTA',
      avatarKey: null,
      coverKey: null,
      background: 'PAPER', backgroundColor: null,
    });
    expect(page?.links.map((l) => [l.label, l.size])).toEqual([
      ['Portfolio', null],
      ['GitHub', 'WIDE'],
    ]);
  });

  it('is null for an account with no page', async () => {
    const bare = await write.account.create({ data: { email: 'bare@example.com' }, select: { id: true } });
    expect(await getMyCurios(bare.id)).toBeNull();
  });

  // The brief's fixture only ever writes 'SOFT', 'JAKARTA' and 'WIDE'. A typo
  // or a deleted member anywhere else in the three enums -- 'CONTRAST';
  // 'SMALL', 'TALL', 'BIG'; 'BRICOLAGE', 'FRAUNCES', 'SPACE_GROTESK',
  // 'DM_SERIF', 'OUTFIT' -- would still leave every other test green, because
  // a narrower Prisma-generated union is still assignable to the wider
  // @curios/core/bento type. This writes and reads back one of each.
  it('round-trips every tile size and the non-default appearance enums', async () => {
    const account = await write.account.create({
      data: {
        email: 'enums@example.com',
        pages: {
          create: {
            handle: 'enums',
            skeleton: 'enums',
            displayName: 'Enum Coverage',
            style: 'CONTRAST',
            headingFont: 'OUTFIT',
            avatarKey: 'avatars/enums.png',
            links: {
              create: [
                { label: 'A', url: 'https://a.example', position: 0, size: 'SMALL' },
                { label: 'B', url: 'https://b.example', position: 1, size: 'TALL' },
                { label: 'C', url: 'https://c.example', position: 2, size: 'BIG' },
              ],
            },
          },
        },
      },
      select: { id: true },
    });

    const page = await getMyCurios(account.id);

    expect(page).toMatchObject({ style: 'CONTRAST', headingFont: 'OUTFIT', avatarKey: 'avatars/enums.png' });
    expect(page?.links.map((l) => l.size)).toEqual(['SMALL', 'TALL', 'BIG']);
  });
});

describe('countPendingFacts', () => {
  // The same filter as the review queue, or the sidebar count and the screen
  // it links to disagree.
  it('counts only facts still waiting for review', async () => {
    expect(await countPendingFacts(accountId)).toBe(1);
  });
});
