import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
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
 * Deletes the accounts matched by `where`, and only the ModelCall rows they made.
 *
 * `ModelCall.pageId` is a plain column, not a foreign key -- the schema and
 * its init migration carry no `ON DELETE CASCADE` for it, deliberately:
 * margin data is meant to outlive a deleted page. Deleting an account
 * therefore cascades away its pages, facts, conversations, messages,
 * questions and usage counters, but leaves every ModelCall row behind --
 * one leaked row per question, plus retries, in every single run, in the
 * test database `pnpm test` shares. So this finds the pages under `where`
 * first, deletes only the ModelCall rows on those pages -- never "rows
 * whose page no longer exists", which would also catch rows other tests
 * left behind -- and only then deletes the accounts.
 */
async function deleteHarnessAccounts(prisma: PrismaClient, where: Prisma.AccountWhereInput): Promise<void> {
  const pages = await prisma.page.findMany({ where: { account: where }, select: { id: true } });
  if (pages.length > 0) {
    await prisma.modelCall.deleteMany({ where: { pageId: { in: pages.map((page) => page.id) } } });
  }
  await prisma.account.deleteMany({ where });
}

/**
 * One fixture page, in the test database.
 *
 * Published, with every fact verified, because `answer` reads only verified
 * facts on a published page -- seeded any other way this suite produces twenty
 * confidently factless answers and twenty confusing failures. The account
 * (and any ModelCall debris an interrupted run left on its page) is deleted
 * first, so that debris cannot collide with the handle's unique index and
 * cannot leak past this run either.
 */
async function seed(prisma: PrismaClient, { name, fixture }: LoadedFixture): Promise<string> {
  const { page } = fixture;
  const email = `golden-${name}${ACCOUNT_DOMAIN}`;
  await deleteHarnessAccounts(prisma, { email });

  const account = await prisma.account.create({
    data: {
      email,
      pages: {
        create: {
          handle: page.handle,
          // Its own unique index, but nothing distinct to put in it: the
          // handle above is already unique, and answer() never reads this
          // column, so reusing the handle satisfies the constraint without
          // inventing a second identifier for the same page.
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

  let text: string;
  try {
    text = await ask(deps, fixture.page.handle, question.ask);
  } catch (error) {
    // A call that never returned is not an assertion that failed. Reported
    // apart, so a flaky network never reads as a prompt regression. Only the
    // model call goes through this try: a bug in checkAnswer itself must
    // surface as what it is, not as a false model error.
    return {
      ...base,
      answer: '',
      verdicts: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

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

  // The only way this harness can reach the development database is a
  // misconfigured .env: it never reads DATABASE_URL, only DATABASE_URL_TEST,
  // but if an owner's .env points both at the same place there is nothing
  // else here to stop it from seeding and deleting fixture pages there.
  if (databaseUrl === process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL_TEST is the same as DATABASE_URL. Refusing to start: this harness seeds ' +
        'and deletes fixture accounts, and the development database is not something a run can ' +
        'restore the way the test database\'s two commands do.',
    );
  }

  const cap = conversationCap();
  // Every question -- and every retry of a failing one -- opens a new
  // conversation (answer() is never given a conversationId here), so a
  // page's worst case is every one of its questions failing once and being
  // re-asked RETRIES more times. A cap smaller than that turns every later
  // answer into CAP_REACHED_REPLY partway through a page, which reads exactly
  // like a prompt collapse rather than what it is.
  const worstCase = Math.max(...fixtures.map((f) => f.fixture.questions.length)) * (1 + RETRIES);
  if (cap < worstCase) {
    throw new Error(
      `conversationCap() is ${cap}, smaller than the ${worstCase} conversations one page can open ` +
        'in a single run. Raise CONVERSATION_CAP_PER_MONTH before running the golden set.',
    );
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const deps: Deps = { prisma, gateway: createAnthropicGateway(apiKey), cap };
  const asked: { loaded: LoadedFixture; question: GoldenQuestion; result: QuestionResult }[] = [];
  const pageIds: string[] = [];
  let costMilliCents = 0;
  let results: QuestionResult[] = [];
  let transcript = '';

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

    // Written inside the try, immediately after the cost is summed and
    // before teardown runs. Sixty answers and a few cents are real money
    // spent; the evidence must be on disk before anything else -- a dropped
    // connection, a restarted container -- gets a chance to throw it away.
    results = asked.map((entry) => entry.result);
    const summary = summarise(results);

    // Colons are not legal in a Windows filename.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    mkdirSync(TRANSCRIPTS, { recursive: true });
    transcript = join(TRANSCRIPTS, `${stamp}.json`);
    writeFileSync(
      transcript,
      JSON.stringify({ ranAt: new Date().toISOString(), model: CHAT_MODEL, summary, costMilliCents, results }, null, 2),
    );
  } finally {
    try {
      // Only this harness's own accounts, which cascade to their pages,
      // facts, conversations, messages, questions and usage counters --
      // ModelCall does not cascade, so deleteHarnessAccounts deletes those
      // rows by hand, through the pages it looks up first. Never a
      // TRUNCATE: `pnpm test` shares this database.
      await deleteHarnessAccounts(prisma, { email: { endsWith: ACCOUNT_DOMAIN } });
    } catch (error) {
      // Best-effort: the transcript is already on disk by this point, so a
      // failed teardown loses no evidence, only tidiness. Reported loudly
      // rather than swallowed, because the accounts it may have left behind
      // are real rows in a database `pnpm test` shares.
      console.error(
        'Teardown failed. Fixture accounts under `@goldens.invalid`, and the pages, facts, ' +
          'conversations and ModelCall rows they own, may remain in the test database. The next ' +
          "run's seed step deletes each by email before it seeds, so this is not permanent, but " +
          'it should be looked at:',
      );
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    } finally {
      // Runs even if the delete above threw, so a failed teardown never
      // also leaks the connection.
      await prisma.$disconnect();
    }
  }

  const summary = summarise(results);

  console.log(formatReport(results, costMilliCents));
  console.log(`\nModel: ${CHAT_MODEL}`);
  console.log(`Transcript: ${transcript}`);

  if (summary.failed > 0 || summary.errored > 0) process.exitCode = 1;
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
