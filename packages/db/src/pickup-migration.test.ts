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
/** An old note longer than a place's name may be: it names the place cut short, and is its whole address. */
const LONG = 'Lobby Menara Seri, Jalan Ampang, beside the guardhouse, call when here please';
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
    ('p1', true, '  Seksyen 7  '),
    ('p2', false, null),
    ('p3', true, null),
    ('p4', false, 'Old note, pickup off'),
    ('p5', true, '   '),
    ('p6', true, '${LONG}')`);
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$disconnect();
});

type Row = Record<string, unknown>;
const places = () => prisma.$queryRawUnsafe<Row[]>(`SELECT * FROM "${SCHEMA}"."PickupPlace" ORDER BY "pageId"`);

describe('the pickup_places migration', () => {
  it('makes the note of a page one any-time place, named by the note and with it as the address, trimmed', async () => {
    const rows = (await places()).filter((r) => r.pageId === 'p1');
    expect(rows.map((r) => [r.name, r.address, r.anyTime, r.position])).toEqual([['Seksyen 7', 'Seksyen 7', true, 0]]);
  });

  it('names a place from a long note by its first 60 characters, and keeps the whole note as the address', async () => {
    const rows = (await places()).filter((r) => r.pageId === 'p6');
    expect(rows.map((r) => [r.name, r.address])).toEqual([[LONG.slice(0, 60), LONG]]);
  });

  it('gives no place to a pickup page with no note, or only spaces: it stays on any-time pickup', async () => {
    expect((await places()).filter((r) => r.pageId === 'p3' || r.pageId === 'p5')).toEqual([]);
  });

  it('gives no place to a page with pickup off and no note', async () => {
    expect((await places()).filter((r) => r.pageId === 'p2')).toEqual([]);
  });

  it('keeps a note written while pickup was off, as one place', async () => {
    const rows = (await places()).filter((r) => r.pageId === 'p4');
    expect(rows.map((r) => [r.name, r.address])).toEqual([['Old note, pickup off', 'Old note, pickup off']]);
  });

  it('adds the order snapshot columns, all null on an old order', async () => {
    await prisma.$executeRawUnsafe(`INSERT INTO "${SCHEMA}"."Order" ("id") VALUES ('o1')`);
    const [row] = await prisma.$queryRawUnsafe<Row[]>(`SELECT * FROM "${SCHEMA}"."Order" WHERE "id" = 'o1'`);
    for (const col of ['pickupPlaceId', 'pickupPlaceName', 'pickupPlaceAddress', 'pickupWindowId', 'pickupFrom', 'pickupTo', 'chipTriedMethod']) {
      expect(row).toHaveProperty(col, null);
    }
  });
});
