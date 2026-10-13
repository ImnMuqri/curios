import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeClaim, type FactCategory } from '@curios/core';
import { priceLine } from '@curios/core/store';
import type { Expectation } from './rules.js';

/**
 * Reserved so a golden fixture's handle cannot collide with one `pnpm test`
 * seeds -- teardown itself deletes by the account's email domain, not this
 * prefix.
 */
export const GOLDEN_HANDLE_PREFIX = 'golden-';

export interface GoldenFact {
  category: FactCategory;
  claim: string;
  /**
   * The question this fact answers, as extraction would have written it.
   *
   * Optional, so the three original fixtures stay exactly as they were. It is
   * what retrieval matches a visitor's question against, so a fixture meant to
   * exercise retrieval must set it on every fact -- see the check in
   * fixtures.real.test.ts.
   */
  question?: string;
}

export interface GoldenQuestion {
  ask: string;
  /** What this question protects. Required: a failure a month from now is read by someone who was not here. */
  why: string;
  expect: Expectation;
}

export interface GoldenItem {
  name: string;
  description?: string;
  /** The item's one price. Ignored when `options` is set, as in the real shop. */
  priceCents?: number;
  options?: { label: string; priceCents: number }[];
}

export interface GoldenPage {
  handle: string;
  displayName: string;
  mode: 'PERSONAL' | 'BUSINESS';
  facts: GoldenFact[];
  neverSay: string[];
  /** Present means a shop: the page is seeded with `storeEnabled` and these items. */
  shop?: GoldenItem[];
}

export interface GoldenFixture {
  page: GoldenPage;
  questions: GoldenQuestion[];
}

export interface LoadedFixture {
  name: string;
  fixture: GoldenFixture;
}

/** One golden fact, shaped for Prisma's `Fact.create`. */
export interface FactCreateInput {
  category: FactCategory;
  claim: string;
  question: string | null;
  normalizedClaim: string;
  confidence: number;
  verified: boolean;
}

/**
 * A golden fixture's fact, mapped to what `seed()` writes to the database.
 *
 * Pure, and pulled out of `run.ts` on purpose: that file has no test seam --
 * no exports, and its module body runs `main()` on import -- so the one line
 * this whole fixture format exists to prove (`question: fact.question ??
 * null`, never a bare `null` that would silently drop back to embedding
 * claims instead of questions -- see `syncFactEmbeddings`) needs a home a
 * test can reach. `confidence: 1` and `verified: true` are fixed: `answer()`
 * only reads verified facts on a published page, and a golden fixture always
 * ships already-reviewed facts.
 */
export function toFactCreateInput(fact: GoldenFact): FactCreateInput {
  return {
    category: fact.category,
    claim: fact.claim,
    question: fact.question ?? null,
    normalizedClaim: normalizeClaim(fact.claim),
    confidence: 1,
    verified: true,
  };
}

/** One golden shop item, shaped for Prisma's nested `Item.create`. */
export function toItemCreateInput(item: GoldenItem, position: number) {
  const options = item.options ?? [];
  return {
    name: item.name,
    description: item.description ?? null,
    // An item with options carries no price of its own, as the editor saves it.
    priceCents: options.length > 0 ? null : (item.priceCents ?? null),
    position,
    options: { create: options.map((option, i) => ({ ...option, position: i })) },
  };
}

/**
 * Everything the page can truthfully say: each fact claim, then each shop item
 * as "<name> <price line>". The one list both validation and the run's
 * `digitsOnlyFromFacts` check read, so a price that lives only in the shop is
 * neither "in no fact" nor an invented number.
 */
export function knowledgeText(page: GoldenPage): string[] {
  const items = (page.shop ?? []).map((item) => {
    const line = priceLine({ priceCents: item.options?.length ? null : (item.priceCents ?? null), options: item.options ?? [] });
    // The description goes to the model after the price, so its digits are
    // knowledge too.
    const described = item.description ? `${line} -- ${item.description}` : line;
    return `${item.name} ${described}`.trim();
  });
  return [...page.facts.map((fact) => fact.claim), ...items];
}

/**
 * Whether a question can fail at all.
 *
 * `language` deliberately does not count: it is advisory, so a question
 * carrying only that one asserts nothing that could ever go red.
 */
function assertsSomething(expect: Expectation): boolean {
  return (
    (expect.mustContain?.length ?? 0) > 0 ||
    (expect.mustNotContain?.length ?? 0) > 0 ||
    expect.digitsOnlyFromFacts === true
  );
}

/**
 * Everything wrong with a fixture, in the order found.
 *
 * Returns problems rather than throwing, so one run can report every broken
 * fixture at once instead of one per attempt.
 */
export function validateFixture(name: string, fixture: GoldenFixture): string[] {
  const problems: string[] = [];
  const { page, questions } = fixture;

  if (!page.handle.startsWith(GOLDEN_HANDLE_PREFIX)) {
    problems.push(`${name}: handle "${page.handle}" must start with "${GOLDEN_HANDLE_PREFIX}"`);
  }
  const knowledge = knowledgeText(page);
  if (knowledge.length === 0) problems.push(`${name}: the page has no facts`);
  if (questions.length === 0) problems.push(`${name}: the page has no questions`);

  const factText = knowledge.join(' ').toLowerCase();
  const asked = new Set<string>();

  questions.forEach((question, index) => {
    const at = `${name}: question ${index + 1}`;
    if (question.why.trim() === '') problems.push(`${at} "${question.ask}" has no why`);
    if (!assertsSomething(question.expect)) problems.push(`${at} "${question.ask}" asserts nothing`);
    // Compared normalised, so a stray case or spacing change is not read as a
    // different question, but reported with the text as the author wrote it,
    // so they can find it in the fixture.
    const normalisedAsk = question.ask.trim().toLowerCase();
    if (asked.has(normalisedAsk)) problems.push(`${at} "${question.ask}" is asked twice`);
    asked.add(normalisedAsk);

    // Skipped when the page has no facts and no shop: that is already
    // reported above, and checking against an empty page here would only pile
    // a second, misleading problem onto every mustContain question.
    if (knowledge.length > 0) {
      for (const needle of question.expect.mustContain ?? []) {
        if (!factText.includes(needle.toLowerCase())) {
          problems.push(`${at} expects "${needle}", which appears in no fact on this page`);
        }
      }
    }
  });

  const withQuestions = page.facts.filter((fact) => fact.question !== undefined).length;
  if (withQuestions > 0 && withQuestions < page.facts.length) {
    problems.push(
      `${name}: ${withQuestions} of ${page.facts.length} facts carry a question. ` +
        'Set it on every fact or none -- a page with some is a page where retrieval ' +
        'matches half the catalogue against claims and half against questions.',
    );
  }

  return problems;
}

/**
 * Every fixture in a directory, validated together.
 *
 * Throws rather than returning problems, because the only caller is the runner
 * and a fixture it cannot trust must stop the run before a connection is
 * opened or a token is spent.
 */
export function loadFixtures(dir: string): LoadedFixture[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new Error(`No fixtures in ${dir}.`);

  const loaded = files.map((file) => {
    const raw = readFileSync(join(dir, file), 'utf8');
    let fixture: GoldenFixture;
    try {
      fixture = JSON.parse(raw) as GoldenFixture;
    } catch (error) {
      // Named, so a broken fixture says which of the three it is rather than
      // a bare "Unexpected token" with no file attached to it.
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${file}: ${message}`);
    }
    return { name: file.replace(/\.json$/, ''), fixture };
  });

  const problems = loaded.flatMap(({ name, fixture }) => validateFixture(name, fixture));
  if (problems.length > 0) {
    throw new Error(`These fixtures cannot be run:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  return loaded;
}
