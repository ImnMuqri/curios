import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { answer } from '@curios/api/chat';
import { conversationCap, normalizeClaim } from '@curios/core';
import { CHAT_MODEL, createAnthropicGateway, type Gateway } from '@curios/gateway';
import { checkAnswer, failed } from './rules.js';
import { loadFixtures, type GoldenQuestion, type LoadedFixture } from './fixtures.js';
import { formatReport, summarise, type QuestionResult } from './report.js';

// packages/goldens/src -> the repo root.
const ROOT = join(import.meta.dirname, '..', '..', '..');
const FIXTURES = join(ROOT, 'fixtures', 'goldens');
const TRANSCRIPTS = join(ROOT, '.goldens');

/** How many times a failure is re-asked, to tell a regression from variance. */
const RETRIES = 3;

/** Every fixture account carries this domain, which is what teardown deletes by. */
const ACCOUNT_DOMAIN = '@goldens.invalid';

interface Deps {
  prisma: PrismaClient;
  gateway: Gateway;
  cap: number;
}

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set. ${hint}`);
  return value;
}

/**
 * One fixture page, in the test database.
 *
 * Published, with every fact verified, because `answer` reads only verified
 * facts on a published page -- seeded any other way this suite produces twenty
 * confidently factless answers and twenty confusing failures. The account is
 * deleted first so debris from an interrupted run cannot collide with the
 * handle's unique index.
 */
async function seed(prisma: PrismaClient, { name, fixture }: LoadedFixture): Promise<string> {
  const { page } = fixture;
  const email = `golden-${name}${ACCOUNT_DOMAIN}`;
  await prisma.account.deleteMany({ where: { email } });

  const account = await prisma.account.create({
    data: {
      email,
      pages: {
        create: {
          handle: page.handle,
          skeleton: page.handle,
          displayName: page.displayName,
          mode: page.mode,
          published: true,
          facts: {
            create: page.facts.map((fact) => ({
              category: fact.category,
              claim: fact.claim,
              normalizedClaim: normalizeClaim(fact.claim),
              confidence: 1,
              verified: true,
            })),
          },
          neverSay: { create: page.neverSay.map((phrase) => ({ phrase })) },
        },
      },
    },
    include: { pages: true },
  });

  const seeded = account.pages[0];
  if (!seeded) throw new Error(`Seeding ${name} produced no page.`);
  return seeded.id;
}

/** The whole answer, as a visitor would have read it once the stream closed. */
async function ask(deps: Deps, handle: string, question: string): Promise<string> {
  let text = '';
  for await (const event of answer(deps, { handle, question })) {
    if (event.type === 'text') text += event.text;
  }
  return text;
}

async function askAndCheck(
  deps: Deps,
  loaded: LoadedFixture,
  question: GoldenQuestion,
): Promise<QuestionResult> {
  const { name, fixture } = loaded;
  const base = { page: name, ask: question.ask, why: question.why };

  try {
    const text = await ask(deps, fixture.page.handle, question.ask);
    return {
      ...base,
      answer: text,
      verdicts: checkAnswer({
        answer: text,
        question: question.ask,
        facts: fixture.page.facts.map((fact) => fact.claim),
        neverSay: fixture.page.neverSay,
        expect: question.expect,
      }),
    };
  } catch (error) {
    // A call that never returned is not an assertion that failed. Reported
    // apart, so a flaky network never reads as a prompt regression.
    return {
      ...base,
      answer: '',
      verdicts: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  // Before a connection is opened or a token is spent.
  const fixtures = loadFixtures(FIXTURES);

  const apiKey = required(
    'ANTHROPIC_API_KEY',
    'The golden set asks the real model; there is nothing to assert without it.',
  );
  const databaseUrl = required(
    'DATABASE_URL_TEST',
    'The golden set seeds its pages into the test database and never touches the development one.',
  );

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const deps: Deps = { prisma, gateway: createAnthropicGateway(apiKey), cap: conversationCap() };
  const asked: { loaded: LoadedFixture; question: GoldenQuestion; result: QuestionResult }[] = [];
  const pageIds: string[] = [];
  let costMilliCents = 0;

  try {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new Error(
        'The test database is not reachable. If a container restart wiped it, restore it from the repo root:\n' +
          `  DATABASE_URL="$(grep '^DATABASE_URL_TEST=' .env | cut -d= -f2-)" pnpm --filter @curios/db exec prisma migrate deploy\n` +
          '  docker exec -i curios-postgres-test psql -U curios -d curios_test < packages/db/prisma/sql/readonly-role.sql',
      );
    }

    for (const loaded of fixtures) {
      pageIds.push(await seed(prisma, loaded));
      for (const question of loaded.fixture.questions) {
        asked.push({ loaded, question, result: await askAndCheck(deps, loaded, question) });
      }
    }

    // Only the failures, and only after every question has been asked once. A
    // consistent failure is a regression, an intermittent one is the model's
    // own variance, and the questions that passed are not worth paying to
    // re-ask.
    for (const entry of asked) {
      if (entry.result.error !== undefined || !failed(entry.result.verdicts)) continue;
      let stillFailing = 0;
      for (let attempt = 0; attempt < RETRIES; attempt += 1) {
        const retry = await askAndCheck(deps, entry.loaded, entry.question);
        if (retry.error !== undefined || failed(retry.verdicts)) stillFailing += 1;
      }
      entry.result.retries = { failed: stillFailing, of: RETRIES };
    }

    // Summed before teardown, because teardown deletes the rows it reads.
    const spend = await prisma.modelCall.aggregate({
      _sum: { costMilliCents: true },
      where: { pageId: { in: pageIds } },
    });
    costMilliCents = spend._sum.costMilliCents ?? 0;
  } finally {
    // Only this harness's own accounts, which cascade to their pages, facts,
    // conversations, messages, usage counters and model calls. Never a
    // TRUNCATE: `pnpm test` shares this database.
    await prisma.account.deleteMany({ where: { email: { endsWith: ACCOUNT_DOMAIN } } });
    await prisma.$disconnect();
  }

  const results = asked.map((entry) => entry.result);
  const summary = summarise(results);

  // Colons are not legal in a Windows filename.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(TRANSCRIPTS, { recursive: true });
  const transcript = join(TRANSCRIPTS, `${stamp}.json`);
  writeFileSync(
    transcript,
    JSON.stringify({ ranAt: new Date().toISOString(), model: CHAT_MODEL, summary, costMilliCents, results }, null, 2),
  );

  console.log(formatReport(results, costMilliCents));
  console.log(`\nModel: ${CHAT_MODEL}`);
  console.log(`Transcript: ${transcript}`);

  if (summary.failed > 0 || summary.errored > 0) process.exitCode = 1;
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
