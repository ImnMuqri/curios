import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getPublicPage } from './page.query.js';

const write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeAll(async () => {
  await write.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  await write.account.create({
    data: {
      email: 'nadia@example.com',
      pages: {
        create: {
          handle: 'nadia',
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

  it('cannot write through the read-only connection', async () => {
    const { prismaRead } = await import('./client.js');
    await expect(
      prismaRead.$executeRawUnsafe(`UPDATE "Page" SET "displayName" = 'hacked'`),
    ).rejects.toThrow(/permission denied/i);
  });
});
