import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  knowledgeText,
  loadFixtures,
  toFactCreateInput,
  toItemCreateInput,
  validateFixture,
  type GoldenFixture,
} from './fixtures.js';

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
    // Teardown deletes by the account's email domain, not this prefix -- the
    // prefix instead reserves a namespace against `pnpm test`, which seeds its
    // own pages and would collide with a golden fixture that did not carry it.
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

  it('rejects a page where only some facts carry a question', () => {
    const problems = validateFixture('half', {
      page: {
        handle: 'golden-half',
        displayName: 'Half',
        mode: 'BUSINESS',
        facts: [
          { category: 'PRICE', claim: 'Kek RM95.', question: 'Berapa harga kek?' },
          { category: 'HOURS', claim: 'Buka 9 pagi.' },
        ],
        neverSay: [],
      },
      questions: [{ ask: 'harga', why: 'w', expect: { digitsOnlyFromFacts: true } }],
    });

    expect(problems).toContainEqual(expect.stringContaining('1 of 2 facts carry a question'));
  });
});

/** A page with no facts at all, only a shop. */
const shopOnly = (): GoldenFixture => ({
  page: {
    handle: 'golden-shop',
    displayName: 'Kek Lina',
    mode: 'BUSINESS',
    facts: [],
    neverSay: [],
    shop: [{ name: 'Kek Batik', options: [{ label: '1kg', priceCents: 9500 }] }],
  },
  questions: [{ ask: 'berapa harga kek batik', why: 'Shop price.', expect: { mustContain: ['95'] } }],
});

describe('shop fixtures', () => {
  it('does not call a page with a shop and no facts empty, and finds its prices', () => {
    expect(validateFixture('shop', shopOnly())).toEqual([]);
  });

  it('still refuses a page with neither facts nor a shop', () => {
    const fixture = shopOnly();
    delete fixture.page.shop;

    expect(validateFixture('shop', fixture)).toContain('shop: the page has no facts');
  });

  it('refuses a mustContain that neither a fact nor a shop price could satisfy', () => {
    const fixture = shopOnly();
    fixture.questions[0]!.expect = { mustContain: ['170'] };

    expect(validateFixture('shop', fixture)).toEqual([
      'shop: question 1 expects "170", which appears in no fact on this page',
    ]);
  });

  it('knowledgeText lists each fact claim, then each item with its price line', () => {
    const fixture = shopOnly();
    fixture.page.facts = [{ category: 'LOCATION', claim: 'Ambil sendiri.' }];
    fixture.page.shop!.push({ name: 'Cookies', priceCents: 2500 }, { name: 'Brownies', priceCents: 3850 });

    expect(knowledgeText(fixture.page)).toEqual([
      'Ambil sendiri.',
      'Kek Batik 1kg RM95',
      'Cookies RM25',
      'Brownies RM38.50',
    ]);
    expect(knowledgeText(shopOnly().page)).toEqual(['Kek Batik 1kg RM95']);
  });
});

describe('knowledgeText descriptions', () => {
  it('carries an item description, after its price line, as the SHOP block does', () => {
    // The model is given the description, so a number in it ("tahan 5 hari")
    // is not an invented one.
    const page = shopOnly().page;
    page.shop![0]!.description = 'Kek batik Nutella, tahan 5 hari.';

    expect(knowledgeText(page)).toEqual(['Kek Batik 1kg RM95 -- Kek batik Nutella, tahan 5 hari.']);
  });
});

describe('toItemCreateInput', () => {
  it('writes an option item with no price of its own, positions in order', () => {
    expect(
      toItemCreateInput(
        { name: 'Kek Batik', description: 'Nutella.', priceCents: 1, options: [{ label: '1kg', priceCents: 9500 }, { label: '2kg', priceCents: 17000 }] },
        2,
      ),
    ).toEqual({
      name: 'Kek Batik',
      slug: 'item-3',
      description: 'Nutella.',
      priceCents: null,
      position: 2,
      options: {
        create: [
          { label: '1kg', priceCents: 9500, position: 0 },
          { label: '2kg', priceCents: 17000, position: 1 },
        ],
      },
    });
  });

  it('writes a single-price item with null description and no options', () => {
    expect(toItemCreateInput({ name: 'Cookies', priceCents: 2500 }, 0)).toEqual({
      name: 'Cookies',
      slug: 'item-1',
      description: null,
      priceCents: 2500,
      position: 0,
      options: { create: [] },
    });
  });
});

describe('toFactCreateInput', () => {
  it('passes a fact\'s own question through, unchanged, alongside the rest of the row', () => {
    // The whole object, not just `question`: pinning every field is what
    // catches a mutation that quietly drops or renames one of the others
    // (category, claim, normalizedClaim, confidence, verified) too.
    expect(toFactCreateInput({ category: 'PRICE', claim: 'Kek RM95.', question: 'Berapa harga kek?' })).toEqual({
      category: 'PRICE',
      claim: 'Kek RM95.',
      question: 'Berapa harga kek?',
      normalizedClaim: 'kek rm95',
      confidence: 1,
      verified: true,
    });
  });

  it('maps a fact with no question to question: null, not to a missing key', () => {
    // This is the exact line `seed()` used to write inline before it was
    // pulled out here: `fact.question ?? null`. A fact with no `question` at
    // all is the three original fixtures' whole shape, and it is what keeps
    // them in fallback -- `selectForQuestion` treats a page missing even one
    // vector as unscoreable, and a fact whose `question` column is simply
    // absent from the insert (rather than `null`) would be a different bug
    // again, caught by Prisma's own required column rather than by this
    // fixture format at all.
    expect(toFactCreateInput({ category: 'HOURS', claim: 'Buka 9 pagi.' })).toEqual({
      category: 'HOURS',
      claim: 'Buka 9 pagi.',
      question: null,
      normalizedClaim: 'buka 9 pagi',
      confidence: 1,
      verified: true,
    });
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

  it('names the file when its JSON cannot be parsed', () => {
    // A bare "Unexpected token" with no file attached sends whoever hits it
    // looking through all three before they find the broken one.
    dir = mkdtempSync(join(tmpdir(), 'goldens-'));
    writeFileSync(join(dir, 'business.json'), '{ not valid json');

    expect(() => loadFixtures(dir)).toThrow(/^business\.json:/);
  });
});
