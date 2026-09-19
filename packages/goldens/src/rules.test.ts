import { describe, expect, it } from 'vitest';
import { checkAnswer, failed, numbersIn } from './rules.js';

const NO_RULES = { facts: [] as string[], neverSay: [] as string[], question: '' };

describe('numbersIn', () => {
  it('reads a decimal as one number, not two', () => {
    // A rounded price must not pass by matching its own first digit against a
    // fact that happens to contain it.
    expect(numbersIn('RM9.50 sekilo')).toEqual(['9.5']);
  });

  it('reads a price written with cents as the price', () => {
    // A fact says RM95 and an answer says RM95.00. That is the same price
    // written politely, not an invented one, and failing it would train
    // whoever reads the report to ignore the rule.
    expect(numbersIn('RM95.00')).toEqual(['95']);
  });

  it('ignores thousands separators, so RM1,200 and RM1200 are one number', () => {
    expect(numbersIn('RM1,200')).toEqual(['1200']);
    expect(numbersIn('RM1,234,567')).toEqual(['1234567']);
  });
});

describe('checkAnswer, digitsOnlyFromFacts', () => {
  it('passes an answer whose numbers all come from the facts', () => {
    const verdicts = checkAnswer({
      ...NO_RULES,
      answer: 'Kek butter 1kg RM95.',
      facts: ['Kek butter 1kg RM95, tempahan 3 hari awal.'],
      expect: { digitsOnlyFromFacts: true },
    });

    expect(failed(verdicts)).toBe(false);
  });

  it('fails a rounded price that no fact contains', () => {
    // The product's central promise. RM95 rounded to RM100 is the failure this
    // whole suite exists to catch.
    const verdicts = checkAnswer({
      ...NO_RULES,
      answer: 'Lebih kurang RM100.',
      facts: ['Kek butter 1kg RM95.'],
      expect: { digitsOnlyFromFacts: true },
    });

    expect(failed(verdicts)).toBe(true);
    expect(verdicts[0]?.detail).toContain('100');
  });

  it('allows a number the question itself used', () => {
    // Asked about 10 boxes, a good answer says "10 kotak" back. That invents
    // nothing, and failing it would make the rule cry wolf on good answers.
    const verdicts = checkAnswer({
      ...NO_RULES,
      answer: 'Untuk 10 kotak, saya kena tanya owner dulu.',
      question: 'boleh bagi diskaun untuk 10 kotak?',
      facts: ['Kek butter 1kg RM95.'],
      expect: { digitsOnlyFromFacts: true },
    });

    expect(failed(verdicts)).toBe(false);
  });

  it('does not let RM95 pass against a fact that says RM950', () => {
    // Substring matching would pass this. Numbers are whole tokens.
    const verdicts = checkAnswer({
      ...NO_RULES,
      answer: 'RM95.',
      facts: ['Kek grand 5kg RM950.'],
      expect: { digitsOnlyFromFacts: true },
    });

    expect(failed(verdicts)).toBe(true);
  });

  it('is not applied when the question does not ask for it', () => {
    const verdicts = checkAnswer({
      ...NO_RULES,
      answer: 'RM12345 out of nowhere.',
      facts: ['Kek butter 1kg RM95.'],
      expect: { mustContain: ['RM'] },
    });

    expect(verdicts.some((v) => v.rule === 'digitsOnlyFromFacts')).toBe(false);
  });
});

describe('checkAnswer, the string rules', () => {
  it('fails when a required string is missing, and passes when it is there', () => {
    const missing = checkAnswer({ ...NO_RULES, answer: 'Saya tak pasti.', expect: { mustContain: ['95'] } });
    const present = checkAnswer({ ...NO_RULES, answer: 'Harganya RM95.', expect: { mustContain: ['95'] } });

    expect(failed(missing)).toBe(true);
    expect(failed(present)).toBe(false);
  });

  it('matches without regard to case', () => {
    const verdicts = checkAnswer({
      ...NO_RULES,
      answer: 'We are in SHAH ALAM.',
      expect: { mustContain: ['Shah Alam'] },
    });

    expect(failed(verdicts)).toBe(false);
  });

  it('fails when a forbidden string appears', () => {
    const verdicts = checkAnswer({
      ...NO_RULES,
      answer: 'Boleh, kami bagi diskaun 10%.',
      expect: { mustNotContain: ['diskaun 10'] },
    });

    expect(failed(verdicts)).toBe(true);
  });
});

describe('checkAnswer, NeverSay', () => {
  it('fails a NeverSay phrase without the question having to ask for it', () => {
    // A page-wide promise. A fixture author should not have to repeat it on
    // twenty questions for it to hold on all twenty.
    const verdicts = checkAnswer({
      ...NO_RULES,
      answer: 'Ya, semua kek kami halal.',
      neverSay: ['halal'],
      expect: { mustContain: ['kek'] },
    });

    expect(failed(verdicts)).toBe(true);
    expect(verdicts.some((v) => v.rule === 'neverSay:halal' && !v.passed)).toBe(true);
  });

  it('passes an answer that keeps off the list', () => {
    const verdicts = checkAnswer({
      ...NO_RULES,
      answer: 'Kek butter ada.',
      neverSay: ['halal'],
      expect: { mustContain: ['kek'] },
    });

    expect(failed(verdicts)).toBe(false);
  });
});

describe('checkAnswer, the language check', () => {
  it('reports the language it found, and never fails the run for it', () => {
    // Advisory on purpose: a cheap marker-word check has false positives, and a
    // gate you learn to ignore is worse than a number you read.
    const verdicts = checkAnswer({
      ...NO_RULES,
      answer: 'I am not sure about that, sorry.',
      expect: { language: 'ms' },
    });

    const language = verdicts.find((v) => v.rule === 'language:ms');
    expect(language?.passed).toBe(false);
    expect(language?.advisory).toBe(true);
    expect(failed(verdicts)).toBe(false);
  });

  it('recognises a Malay answer by its markers', () => {
    const verdicts = checkAnswer({
      ...NO_RULES,
      answer: 'Harga kek butter RM95, boleh tempah tiga hari awal.',
      expect: { language: 'ms' },
    });

    expect(verdicts.find((v) => v.rule === 'language:ms')?.passed).toBe(true);
  });
});
