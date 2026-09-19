import { describe, expect, it } from 'vitest';
import { formatCost, formatReport, summarise, type QuestionResult } from './report.js';

const passing = (page: string, ask: string): QuestionResult => ({
  page,
  ask,
  why: 'Because.',
  answer: 'Harganya RM95.',
  verdicts: [{ rule: 'mustContain:95', passed: true, advisory: false }],
});

const failing = (page: string, ask: string): QuestionResult => ({
  page,
  ask,
  why: 'Because.',
  answer: 'Lebih kurang RM190.',
  verdicts: [
    {
      rule: 'digitsOnlyFromFacts',
      passed: false,
      advisory: false,
      detail: 'in no fact and not in the question: 190',
    },
  ],
  retries: { failed: 3, of: 3 },
});

describe('summarise', () => {
  it('counts what passed, what failed, and what never got an answer', () => {
    const summary = summarise([
      passing('business', 'a'),
      failing('business', 'b'),
      { ...passing('personal', 'c'), error: 'the model call timed out' },
    ]);

    expect(summary).toEqual({
      questions: 3,
      passed: 1,
      failed: 1,
      errored: 1,
      advisoryMisses: 0,
    });
  });

  it('counts an advisory miss without counting it as a failure', () => {
    // The language check is reported and never fails a run. If it ever starts
    // failing one, this is the test that says so.
    const summary = summarise([
      {
        ...passing('business', 'a'),
        verdicts: [
          { rule: 'mustContain:95', passed: true, advisory: false },
          { rule: 'language:ms', passed: false, advisory: true },
        ],
      },
    ]);

    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(1);
    expect(summary.advisoryMisses).toBe(1);
  });
});

describe('formatCost', () => {
  it('renders milli-cents as dollars, because that is what the prices are in', () => {
    // 1 cent = 1000 milli-cents, so 1480 milli-cents is 1.48 cents.
    expect(formatCost(1480)).toBe('$0.0148');
  });

  it('renders a free run as zero rather than as nothing', () => {
    expect(formatCost(0)).toBe('$0.0000');
  });
});

describe('formatReport', () => {
  it('shows a failing question, why it failed, and what it actually said', () => {
    const report = formatReport([passing('business', 'harga kek'), failing('business', 'kek 2kg berapa')], 1480);

    expect(report).toContain('kek 2kg berapa');
    expect(report).toContain('in no fact and not in the question: 190');
    expect(report).toContain('Lebih kurang RM190.');
    expect(report).toContain('failed 3 of 3');
  });

  it('does not print the answers that passed', () => {
    // Sixty answers is a wall of text nobody reads. The transcript file has
    // them all; the terminal shows the ones that need a human.
    const report = formatReport([passing('business', 'harga kek')], 0);

    expect(report).not.toContain('Harganya RM95.');
  });

  it('counts each page separately, so a whole bad page is obvious at a glance', () => {
    const report = formatReport([passing('business', 'a'), failing('hostile', 'b'), failing('hostile', 'c')], 0);

    expect(report).toMatch(/business.*1 passed/);
    expect(report).toMatch(/hostile.*2 failed/);
  });
});
