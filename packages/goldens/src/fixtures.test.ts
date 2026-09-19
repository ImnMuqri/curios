import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFixtures, validateFixture, type GoldenFixture } from './fixtures.js';

/** A fixture with one fact and one question, valid, for tests to bend one way. */
const valid = (): GoldenFixture => ({
  page: {
    handle: 'golden-business',
    displayName: 'Nadia Bakes',
    mode: 'BUSINESS',
    facts: [{ category: 'PRICE', claim: 'Kek butter 1kg RM95.' }],
    neverSay: [],
  },
  questions: [
    {
      ask: 'berapa harga kek butter',
      why: 'The flagship question.',
      expect: { mustContain: ['95'], digitsOnlyFromFacts: true },
    },
  ],
});

describe('validateFixture', () => {
  it('accepts a fixture that says what it asserts', () => {
    expect(validateFixture('business', valid())).toEqual([]);
  });

  it('refuses a question that asserts nothing', () => {
    // The same defect as a test with no assertions: it can never fail, so it
    // buys nothing and costs a model call every run.
    const fixture = valid();
    fixture.questions[0]!.expect = {};

    expect(validateFixture('business', fixture)).toEqual([
      'business: question 1 "berapa harga kek butter" asserts nothing',
    ]);
  });

  it('refuses a question whose only rule is the advisory language check', () => {
    // `language` is reported and never fails, so a question carrying only that
    // one cannot fail either.
    const fixture = valid();
    fixture.questions[0]!.expect = { language: 'ms' };

    expect(validateFixture('business', fixture)).toEqual([
      'business: question 1 "berapa harga kek butter" asserts nothing',
    ]);
  });

  it('refuses a mustContain string that no fact could satisfy', () => {
    // Asserting something the page has no way to say sends whoever debugs it
    // after the model, when the fixture is what is wrong.
    const fixture = valid();
    fixture.questions[0]!.expect = { mustContain: ['RM120'] };

    expect(validateFixture('business', fixture)).toEqual([
      'business: question 1 expects "RM120", which appears in no fact on this page',
    ]);
  });

  it('refuses a handle outside the reserved prefix', () => {
    // Teardown deletes by prefix. A fixture handle that does not carry it would
    // survive the run and collide with the next one.
    const fixture = valid();
    fixture.page.handle = 'nadia';

    expect(validateFixture('business', fixture)).toEqual([
      'business: handle "nadia" must start with "golden-"',
    ]);
  });

  it('refuses two questions that ask the same thing', () => {
    const fixture = valid();
    fixture.questions.push({ ...fixture.questions[0]!, why: 'A duplicate.' });

    expect(validateFixture('business', fixture)).toEqual([
      'business: question 2 "berapa harga kek butter" is asked twice',
    ]);
  });

  it('refuses two questions that differ only in case or spacing', () => {
    // The same question typed twice is the same model call twice, every run,
    // forever. Neither case nor a stray space makes it a different question.
    const fixture = valid();
    fixture.questions.push({ ...fixture.questions[0]!, ask: '  Berapa Harga Kek Butter  ', why: 'A near-duplicate.' });

    expect(validateFixture('business', fixture)).toEqual([
      'business: question 2 "  Berapa Harga Kek Butter  " is asked twice',
    ]);
  });

  it('refuses a question with no why', () => {
    // Whoever debugs a failure next month needs to know what it was protecting.
    const fixture = valid();
    fixture.questions[0]!.why = '   ';

    expect(validateFixture('business', fixture)).toEqual([
      'business: question 1 "berapa harga kek butter" has no why',
    ]);
  });

  it('refuses a page with no facts', () => {
    const fixture = valid();
    fixture.page.facts = [];

    expect(validateFixture('business', fixture)).toEqual(['business: the page has no facts']);
  });

  it('reports every problem it finds, not just the first', () => {
    const fixture = valid();
    fixture.page.handle = 'nadia';
    fixture.questions[0]!.why = '';

    expect(validateFixture('business', fixture)).toHaveLength(2);
  });
});

describe('loadFixtures', () => {
  let dir = '';

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('reads every fixture in the directory, by name, sorted', () => {
    dir = mkdtempSync(join(tmpdir(), 'goldens-'));
    writeFileSync(join(dir, 'personal.json'), JSON.stringify(valid()));
    writeFileSync(join(dir, 'business.json'), JSON.stringify(valid()));

    expect(loadFixtures(dir).map((f) => f.name)).toEqual(['business', 'personal']);
  });

  it('refuses the whole run when one fixture is unusable, and names it', () => {
    // Before a connection is opened or a token is spent.
    dir = mkdtempSync(join(tmpdir(), 'goldens-'));
    const broken = valid();
    broken.questions[0]!.expect = {};
    writeFileSync(join(dir, 'business.json'), JSON.stringify(broken));

    expect(() => loadFixtures(dir)).toThrow(/asserts nothing/);
  });

  it('refuses an empty directory rather than reporting a clean run of nothing', () => {
    dir = mkdtempSync(join(tmpdir(), 'goldens-'));

    expect(() => loadFixtures(dir)).toThrow(/No fixtures/);
  });
});
