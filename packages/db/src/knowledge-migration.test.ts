import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

const migrations = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
const dir = readdirSync(migrations).find((name) => name.endsWith('_knowledge'));
if (!dir) throw new Error('no _knowledge migration');
const sql = readFileSync(join(migrations, dir, 'migration.sql'), 'utf8');

/** The UPDATE statements after the backfill marker -- the part that touches data. */
const backfill = sql
  .slice(sql.indexOf('-- Backfill.'))
  .split(';')
  .map((s) => s.replace(/--.*$/gm, '').trim())
  .filter((s) => s.startsWith('UPDATE'));

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account" CASCADE');
  await prisma.$disconnect();
});

async function aPageWithHistory() {
  const account = await prisma.account.create({
    data: {
      email: 'k@example.com',
      pages: { create: { handle: 'kmig', skeleton: 'kmig', displayName: 'K' } },
    },
    include: { pages: true },
  });
  const pageId = account.pages[0]!.id;
  const ingestion = await prisma.ingestion.create({
    data: { pageId, sourceUrl: 'https://k.example/', status: 'SUCCEEDED', extractedCount: 2 },
  });
  await prisma.fact.createMany({
    data: [
      { pageId, category: 'PRICE', claim: 'Kek RM95.', normalizedClaim: 'kek rm95', confidence: 0.9, verified: true },
      { pageId, category: 'HOURS', claim: 'Open 9 to 5.', normalizedClaim: 'open 9 to 5', confidence: 0.8, rejectedAt: new Date() },
    ],
  });
  return { pageId, ingestionId: ingestion.id };
}

describe('the knowledge migration backfill', () => {
  it('has exactly two statements', () => {
    expect(backfill).toHaveLength(2);
  });

  it('marks every existing fact UNTRACKED and every existing ingestion untracked', async () => {
    const { pageId } = await aPageWithHistory();

    for (const statement of backfill) await prisma.$executeRawUnsafe(statement);

    const facts = await prisma.fact.findMany({ where: { pageId } });
    expect(facts.map((f) => f.origin)).toEqual(['UNTRACKED', 'UNTRACKED']);
    const ingestions = await prisma.ingestion.findMany({ where: { pageId } });
    expect(ingestions.map((i) => i.tracked)).toEqual([false]);
  });

  it('changes nothing else about a fact', async () => {
    const { pageId } = await aPageWithHistory();
    const before = await prisma.fact.findMany({ where: { pageId }, orderBy: { claim: 'asc' } });

    for (const statement of backfill) await prisma.$executeRawUnsafe(statement);

    const after = await prisma.fact.findMany({ where: { pageId }, orderBy: { claim: 'asc' } });
    expect(after.map(({ origin: _o, ...rest }) => rest)).toEqual(before.map(({ origin: _o, ...rest }) => rest));
  });

  it('leaves a fact written after the migration EXTRACTED and tracked by default', async () => {
    const { pageId, ingestionId } = await aPageWithHistory();
    const fresh = await prisma.fact.create({
      data: { pageId, ingestionId, category: 'MISC', claim: 'New.', normalizedClaim: 'new', confidence: 1 },
    });
    expect(fresh.origin).toBe('EXTRACTED');
    const row = await prisma.ingestion.create({ data: { pageId, pastedText: 'x' } });
    expect(row.tracked).toBe(true);
  });
});

describe('Fact.ingestion, ON DELETE SET NULL', () => {
  it('outlives the ingestion that wrote it: the fact survives, with ingestionId cleared', async () => {
    const { pageId, ingestionId } = await aPageWithHistory();
    const fact = await prisma.fact.create({
      data: { pageId, ingestionId, category: 'MISC', claim: 'Kept.', normalizedClaim: 'kept', confidence: 1 },
    });

    await prisma.ingestion.delete({ where: { id: ingestionId } });

    const survivor = await prisma.fact.findUnique({ where: { id: fact.id } });
    expect(survivor?.ingestionId).toBeNull();
  });
});
