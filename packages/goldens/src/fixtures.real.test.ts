import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FACT_BUDGET_CHARS, RETRIEVAL_MIN_FACTS } from '@curios/core';
import { describe, expect, it } from 'vitest';
import { loadFixtures, validateFixture, type GoldenFixture } from './fixtures.js';

// packages/goldens/src -> the repo root, then the fixtures BACKEND.md names.
const DIR = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'goldens');

describe('the fixtures this repo ships', () => {
  it('are the five this repo ships', () => {
    // `catalog` joined the three original fixtures in Task 8 -- it is the
    // page big enough to exercise retrieval, and the other three stay small
    // on purpose. `shop` joined in slice 17: a page whose prices live only in
    // its shop. See the describe blocks below.
    expect(loadFixtures(DIR).map((f) => f.name)).toEqual(['business', 'catalog', 'hostile', 'personal', 'shop']);
  });

  it('are all usable', () => {
    // Read and validated here directly, rather than through loadFixtures,
    // which throws on the first unusable fixture -- that would crash this
    // test with only the first problem instead of failing the assertion below
    // with every problem across all four, which is what you want while
    // authoring them.
    const problems = readdirSync(DIR)
      .filter((file) => file.endsWith('.json'))
      .flatMap((file) => {
        const name = file.replace(/\.json$/, '');
        const fixture = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as GoldenFixture;
        return validateFixture(name, fixture);
      });

    expect(problems).toEqual([]);
  });

  it('ask twenty questions each, as BACKEND.md says', () => {
    for (const { name, fixture } of loadFixtures(DIR)) {
      // `shop` is the one exception: six questions, all about prices.
      expect(fixture.questions, name).toHaveLength(name === 'shop' ? 6 : 20);
    }
  });
});

describe('the catalog fixture', () => {
  const catalog = loadFixtures(DIR).find((loaded) => loaded.name === 'catalog');

  it('exists, because nothing else in this suite exercises retrieval', () => {
    expect(catalog).toBeDefined();
  });

  it('is past the minimum, so it retrieves rather than falling back', () => {
    expect(catalog?.fixture.page.facts.length).toBeGreaterThanOrEqual(RETRIEVAL_MIN_FACTS);
  });

  // Without this the budget never binds, every fact is sent anyway, and the
  // page proves exactly what the three small ones prove: nothing.
  it('holds more claim text than one answer may carry, so the budget binds', () => {
    const chars = (catalog?.fixture.page.facts ?? []).reduce(
      (total, fact) => total + fact.claim.length,
      0,
    );
    expect(chars).toBeGreaterThan(FACT_BUDGET_CHARS);
  });

  it('gives every fact the question retrieval matches against', () => {
    const missing = (catalog?.fixture.page.facts ?? []).filter(
      (fact) => fact.question === undefined,
    );
    expect(missing).toEqual([]);
  });

  it('asks twenty questions, like every other fixture', () => {
    expect(catalog?.fixture.questions).toHaveLength(20);
  });
});

describe('the three original fixtures', () => {
  // They are the proof that a small page is untouched by this slice. A
  // fixture that grew past the minimum would quietly stop being that proof.
  it('stay under the minimum, so they keep proving small pages fall back', () => {
    for (const { name, fixture } of loadFixtures(DIR)) {
      if (name === 'catalog') continue;
      expect(fixture.page.facts.length).toBeLessThan(RETRIEVAL_MIN_FACTS);
    }
  });
});
