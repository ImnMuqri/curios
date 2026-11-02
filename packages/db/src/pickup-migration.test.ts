import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const migrations = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
const dir = readdirSync(migrations).find((name) => name.endsWith('_pickup_places'));
if (!dir) throw new Error('no _pickup_places migration');
const sql = readFileSync(join(migrations, dir, 'migration.sql'), 'utf8');

/** Run the migration's statements, rewritten onto a scratch schema holding old-shaped tables. */
const SCHEMA = 'pickup_mig_test';
const statements = sql
  .split(';')
  .map((s) => s.replace(/--.*$/gm, '').trim())
  .filter(Boolean)
  .map((s) => s.replaceAll('"PickupPlace"', `"${SCHEMA}"."PickupPlace"`)
    .replaceAll('"PickupWindow"', `"${SCHEMA}"."PickupWindow"`)
    .replaceAll('"Order"', `"${SCHEMA}"."Order"`)
    .replaceAll('"Page"', `"${SCHEMA}"."Page"`)
    .replaceAll('INDEX "', `INDEX "${SCHEMA}_`));

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "${SCHEMA}"."Page" (
    "id" TEXT PRIMARY KEY, "pickupEnabled" BOOLEAN NOT NULL DEFAULT false, "pickupNote" TEXT)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "${SCHEMA}"."Order" ("id" TEXT PRIMARY KEY, "day" DATE)`);
  await prisma.$executeRawUnsafe(`INSERT INTO "${SCHEMA}"."Page" ("id","pickupEnabled","pickupNote") VALUES
    ('p1', true, 'Seksyen 7'),
    ('p2', false, null),
    ('p3', true, null),
    ('p4', false, 'Old note, pickup off')`);
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$disconnect();
});

type Row = Record<string, unknown>;
const places = () => prisma.$queryRawUnsafe<Row[]>(`SELECT * FROM "${SCHEMA}"."PickupPlace" ORDER BY "pageId"`);

describe('the pickup_places migration', () => {
  it('gives a pickup page its note as the address of one any-time place', async () => {
    const rows = (await places()).filter((r) => r.pageId === 'p1');
    expect(rows.map((r) => [r.name, r.address, r.anyTime, r.position])).toEqual([['Pickup', 'Seksyen 7', true, 0]]);
  });

  it('gives a pickup page with no note an empty address', async () => {
    const rows = (await places()).filter((r) => r.pageId === 'p3');
    expect(rows.map((r) => [r.name, r.address])).toEqual([['Pickup', '']]);
  });

  it('gives no place to a page with pickup off and no note', async () => {
    expect((await places()).filter((r) => r.pageId === 'p2')).toEqual([]);
  });

  it('keeps a note written while pickup was off, as one place', async () => {
    const rows = (await places()).filter((r) => r.pageId === 'p4');
    expect(rows.map((r) => r.address)).toEqual(['Old note, pickup off']);
  });

  it('adds the order snapshot columns, all null on an old order', async () => {
    await prisma.$executeRawUnsafe(`INSERT INTO "${SCHEMA}"."Order" ("id") VALUES ('o1')`);
    const [row] = await prisma.$queryRawUnsafe<Row[]>(`SELECT * FROM "${SCHEMA}"."Order" WHERE "id" = 'o1'`);
    for (const col of ['pickupPlaceId', 'pickupPlaceName', 'pickupPlaceAddress', 'pickupWindowId', 'pickupFrom', 'pickupTo', 'chipTriedMethod']) {
      expect(row).toHaveProperty(col, null);
    }
  });
});
