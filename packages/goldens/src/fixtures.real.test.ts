import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixtures, validateFixture, type GoldenFixture } from './fixtures.js';

// packages/goldens/src -> the repo root, then the fixtures BACKEND.md names.
const DIR = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'goldens');

describe('the fixtures this repo ships', () => {
  it('are the three the spec names', () => {
    expect(loadFixtures(DIR).map((f) => f.name)).toEqual(['business', 'hostile', 'personal']);
  });

  it('are all usable', () => {
    // Read and validated here directly, rather than through loadFixtures,
    // which throws on the first unusable fixture -- that would crash this
    // test with only the first problem instead of failing the assertion below
    // with every problem across all three, which is what you want while
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
      expect(fixture.questions, name).toHaveLength(20);
    }
  });
});
