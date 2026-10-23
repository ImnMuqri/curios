import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getPageAvailability, getPageStatus, getPublicPage } from './page.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  await write.account.create({
    data: {
      email: 'nadia@example.com',
      pages: {
        create: {
          handle: 'nadia',
          skeleton: 'nadia',
          displayName: 'Nadia Bakes',
          published: true,
          links: { create: { label: 'WhatsApp', url: 'https://wa.me/60123456789', position: 0 } },
          facts: {
            create: [
              {
                category: 'PRICE',
                claim: 'Kek 1kg butter starts at RM95',
                normalizedClaim: 'kek 1kg butter starts at rm95',
                confidence: 0.9,
                verified: true,
              },
              {
                category: 'PRICE',
                claim: 'Unverified draft claim',
                normalizedClaim: 'unverified draft claim',
                confidence: 0.4,
                verified: false,
              },
            ],
          },
        },
      },
    },
  });
  await write.account.create({
    data: {
      email: 'unpublished@example.com',
      pages: {
        create: {
          handle: 'draft',
          skeleton: 'draft',
          displayName: 'Not Live Yet',
          published: false,
        },
      },
    },
  });
});

afterAll(async () => {
  await write.$disconnect();
});

describe('getPublicPage', () => {
  it('returns the page with links and verified facts', async () => {
    const page = await getPublicPage('nadia');
    expect(page?.displayName).toBe('Nadia Bakes');
    expect(page?.links).toHaveLength(1);
    expect(page?.facts).toHaveLength(1);
    expect(page?.facts[0]?.claim).toBe('Kek 1kg butter starts at RM95');
  });

  it('never returns unverified facts', async () => {
    const page = await getPublicPage('nadia');
    expect(page?.facts.map((f) => f.claim)).not.toContain('Unverified draft claim');
  });

  it('returns null for an unknown handle', async () => {
    expect(await getPublicPage('nobody')).toBeNull();
  });

  it('returns null for an unpublished page', async () => {
    expect(await getPublicPage('draft')).toBeNull();
  });

  it('hides a suspended page and says why it is hidden, in its own language, until it is brought back', async () => {
    const account = await write.account.create({
      data: {
        email: 'suspended-page@example.com',
        pages: { create: { handle: 'suspended-one', skeleton: 'suspendedone', displayName: 'Sus', language: 'ms', published: true, suspendedAt: new Date(), suspendReason: 'Scam reports' } },
      },
      select: { pages: { select: { id: true } } },
    });

    expect(await getPublicPage('suspended-one')).toBeNull();
    expect(await getPageStatus('suspended-one')).toBe('suspended');
    expect(await getPageAvailability('Suspended-One')).toEqual({ status: 'suspended', language: 'ms' });
    expect(await getPageStatus('nadia')).toBe('live');
    expect(await getPageStatus('draft')).toBe('missing');
    expect(await getPageStatus('nobody')).toBe('missing');

    await write.page.update({ where: { id: account.pages[0]!.id }, data: { suspendedAt: null, suspendReason: null } });
    expect(await getPublicPage('suspended-one')).not.toBeNull();
    expect(await getPageStatus('suspended-one')).toBe('live');
  });

  it('carries what the capture gate needs', async () => {
    // The page decides whether to render the card, so it needs the same two
    // facts the endpoint checks. Without them the card is shown to a lapsed
    // owner and fails only when a visitor tries to use it.
    const page = await getPublicPage('nadia');

    expect(page).toMatchObject({ paidUntil: null, leadsCaptured: 0 });
  });

  it('carries whether a personal page opted into search results', async () => {
    await write.account.create({
      data: {
        email: 'indexed@example.com',
        pages: {
          create: {
            handle: 'indexed',
            skeleton: 'indexed',
            displayName: 'Opted In',
            published: true,
            mode: 'PERSONAL',
            allowSearchIndexing: true,
          },
        },
      },
    });

    expect((await getPublicPage('indexed'))?.allowSearchIndexing).toBe(true);
  });

  it('carries the appearance and each link size the page renders with', async () => {
    const page = await getPublicPage('nadia');

    expect(page).toMatchObject({ style: 'SOFT', accentColor: '#2340c8', headingFont: 'JAKARTA', avatarKey: null, coverKey: null, background: 'PAPER' });
    expect(page?.links[0]).toMatchObject({ size: null });
  });

  it('cannot write through the read-only connection', async () => {
    const { prismaRead } = await import('./client.js');
    await expect(
      prismaRead.$executeRawUnsafe(`UPDATE "Page" SET "displayName" = 'hacked'`),
    ).rejects.toThrow(/permission denied/i);
  });
});
