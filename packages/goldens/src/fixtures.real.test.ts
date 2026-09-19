import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixtures, validateFixture } from './fixtures.js';

// packages/goldens/src -> the repo root, then the fixtures BACKEND.md names.
const DIR = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'goldens');

describe('the fixtures this repo ships', () => {
  it('are the three the spec names', () => {
    expect(loadFixtures(DIR).map((f) => f.name)).toEqual(['business', 'hostile', 'personal']);
  });

  it('are all usable', () => {
    // loadFixtures throws on the first unusable one; this reports every problem
    // across all three at once, which is what you want while authoring them.
    const problems = loadFixtures(DIR).flatMap(({ name, fixture }) => validateFixture(name, fixture));

    expect(problems).toEqual([]);
  });

  it('ask twenty questions each, as BACKEND.md says', () => {
    for (const { name, fixture } of loadFixtures(DIR)) {
      expect(fixture.questions, name).toHaveLength(20);
    }
  });
});
