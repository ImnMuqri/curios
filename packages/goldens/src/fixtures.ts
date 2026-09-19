import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FactCategory } from '@curios/core';
import type { Expectation } from './rules.js';

/** Reserved so teardown can delete the harness's own pages and nothing else. */
export const GOLDEN_HANDLE_PREFIX = 'golden-';

export interface GoldenFact {
  category: FactCategory;
  claim: string;
}

export interface GoldenQuestion {
  ask: string;
  /** What this question protects. Required: a failure a month from now is read by someone who was not here. */
  why: string;
  expect: Expectation;
}

export interface GoldenPage {
  handle: string;
  displayName: string;
  mode: 'PERSONAL' | 'BUSINESS';
  facts: GoldenFact[];
  neverSay: string[];
}

export interface GoldenFixture {
  page: GoldenPage;
  questions: GoldenQuestion[];
}

export interface LoadedFixture {
  name: string;
  fixture: GoldenFixture;
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
  if (page.facts.length === 0) problems.push(`${name}: the page has no facts`);
  if (questions.length === 0) problems.push(`${name}: the page has no questions`);

  const factText = page.facts.map((fact) => fact.claim).join(' ').toLowerCase();
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

    // Skipped when the page has no facts at all: that is already reported
    // above, and checking against an empty page here would only pile a
    // second, misleading problem onto every mustContain question.
    if (page.facts.length > 0) {
      for (const needle of question.expect.mustContain ?? []) {
        if (!factText.includes(needle.toLowerCase())) {
          problems.push(`${at} expects "${needle}", which appears in no fact on this page`);
        }
      }
    }
  });

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
