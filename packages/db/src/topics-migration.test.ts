import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
const migrations = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
const dir = readdirSync(migrations).find((name) => name.endsWith('_question_topics'));
if (!dir) throw new Error('no _question_topics migration');
const sql = readFileSync(join(migrations, dir, 'migration.sql'), 'utf8');

/** Run the migration's statements, rewritten onto a scratch schema holding old-shaped tables. */
const SCHEMA = 'topics_mig_test';
const statements = sql
  .split(';')
  .map((s) => s.replace(/--.*$/gm, '').trim())
  .filter(Boolean)
  .map((s) => s.replaceAll('"Topic"', `"${SCHEMA}"."Topic"`)
    .replaceAll('"FaqRedirect"', `"${SCHEMA}"."FaqRedirect"`)
    .replaceAll('"Question"', `"${SCHEMA}"."Question"`)
    .replaceAll('"PinnedAnswer"', `"${SCHEMA}"."PinnedAnswer"`)
    .replaceAll('"Page"', `"${SCHEMA}"."Page"`)
    .replaceAll('INDEX "', `INDEX "${SCHEMA}_`)
    .replaceAll(`DROP INDEX "${SCHEMA}_`, `DROP INDEX "${SCHEMA}"."${SCHEMA}_`));

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "${SCHEMA}"."Page" ("id" TEXT PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "${SCHEMA}"."Question" (
    "id" TEXT PRIMARY KEY, "pageId" TEXT NOT NULL, "text" TEXT NOT NULL, "normalizedQuestion" TEXT NOT NULL,
    "askCount" INTEGER NOT NULL DEFAULT 1, "answered" BOOLEAN NOT NULL DEFAULT false,
    "faqSuppressed" BOOLEAN NOT NULL DEFAULT false, "faqSlug" TEXT,
    "firstAskedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastAskedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "${SCHEMA}_Question_pageId_faqSlug_key" ON "${SCHEMA}"."Question"("pageId","faqSlug")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "${SCHEMA}"."PinnedAnswer" (
    "id" TEXT PRIMARY KEY, "pageId" TEXT NOT NULL, "question" TEXT NOT NULL, "normalizedQuestion" TEXT NOT NULL, "answer" TEXT NOT NULL)`);
  await prisma.$executeRawUnsafe(`INSERT INTO "${SCHEMA}"."Page" VALUES ('p1'), ('p2')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "${SCHEMA}"."Question" ("id","pageId","text","normalizedQuestion","askCount","answered","faqSlug","faqSuppressed","lastAskedAt") VALUES
    ('q1','p1','What is Iman''s full name','what is imans full name',4,true,'what-is-imans-full-name',false,'2026-09-01'),
    ('q2','p1','Do you take FPX','do you take fpx',2,false,null,false,'2026-09-02'),
    ('q3','p1','Kek berapa','kek berapa',5,true,'kek-berapa',true,'2026-09-03'),
    ('q4','p2','Kek berapa','kek berapa',1,false,null,false,'2026-09-04')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "${SCHEMA}"."PinnedAnswer" VALUES
    ('a1','p1','What is Iman''s full name','what is imans full name','Iman Muqri'),
    ('a3','p1','Kek berapa','kek berapa','RM95')`);
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$disconnect();
});

type Row = Record<string, unknown>;
const rows = (table: string) => prisma.$queryRawUnsafe<Row[]>(`SELECT * FROM "${SCHEMA}"."${table}" ORDER BY "id"`);

describe('the question_topics migration', () => {
  it('gives every question its own topic, carrying answer, slug, suppression and count', async () => {
    const topics = await rows('Topic');
    expect(topics.map((t) => [t.id, t.title, t.answer, t.faqSlug, t.faqSuppressed, t.askCount])).toEqual([
      ['q1', "What is Iman's full name", 'Iman Muqri', 'what-is-imans-full-name', false, 4],
      ['q2', 'Do you take FPX', null, null, false, 2],
      ['q3', 'Kek berapa', 'RM95', 'kek-berapa', true, 5],
      // Same normalised wording on another page: p1's answer must not leak across pages.
      ['q4', 'Kek berapa', null, null, false, 1],
    ]);
  });

  it('sets answeredAt only on answered topics', async () => {
    const topics = await rows('Topic');
    expect(topics.map((t) => t.answeredAt !== null)).toEqual([true, false, true, false]);
  });

  it('points every question at its topic and leaves it ungrouped', async () => {
    const questions = await rows('Question');
    expect(questions.map((q) => [q.id, q.topicId, q.groupedAt, q.pinnedByOwner])).toEqual([
      ['q1', 'q1', null, false],
      ['q2', 'q2', null, false],
      ['q3', 'q3', null, false],
      ['q4', 'q4', null, false],
    ]);
  });

  it('drops the moved columns and PinnedAnswer', async () => {
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = 'Question'`,
    );
    expect(cols.map((c) => c.column_name)).not.toEqual(expect.arrayContaining(['answered']));
    expect(cols.map((c) => c.column_name)).not.toContain('faqSlug');
    const pinned = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM information_schema.tables WHERE table_schema = '${SCHEMA}' AND table_name = 'PinnedAnswer'`,
    );
    expect(Number(pinned[0]?.n)).toBe(0);
  });
});
