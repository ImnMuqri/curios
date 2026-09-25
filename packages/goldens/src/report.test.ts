import { describe, expect, it } from 'vitest';
import {
  formatCost,
  formatReport,
  formatRetrievalTally,
  summarise,
  tallyRetrieval,
  type QuestionResult,
  type RetrievalLogEntry,
} from './report.js';

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

    // Each page's line carries its own counts. Summarising every page's results
    // together would print "3 questions  1 passed  2 failed" on both lines --
    // which looser patterns than these would still match.
    expect(report).toContain('business  1 questions  1 passed  0 failed');
    expect(report).toContain('hostile  2 questions  0 passed  2 failed');
  });
});

const retrieved = (pageId: string, selectedCount: number): RetrievalLogEntry => ({
  pageId,
  mode: 'retrieved',
  reason: null,
  bestScore: 0.8,
  factCount: 48,
  selectedCount,
});

const fallback = (pageId: string, reason: string): RetrievalLogEntry => ({
  pageId,
  mode: 'fallback',
  reason,
  bestScore: null,
  factCount: 48,
  selectedCount: 48,
});

describe('tallyRetrieval', () => {
  it('splits entries by pageId, so one page never bleeds into another', () => {
    const tallies = tallyRetrieval(
      [retrieved('catalog-id', 10), retrieved('business-id', 5)],
      [
        { name: 'business', pageId: 'business-id' },
        { name: 'catalog', pageId: 'catalog-id' },
      ],
    );

    expect(tallies).toEqual([
      { page: 'business', retrieved: 1, fallback: 0, reasons: {}, selectedCountRange: { min: 5, max: 5 } },
      { page: 'catalog', retrieved: 1, fallback: 0, reasons: {}, selectedCountRange: { min: 10, max: 10 } },
    ]);
  });

  it('counts retrieved and fallback separately', () => {
    const [tally] = tallyRetrieval(
      [retrieved('p', 10), retrieved('p', 12), fallback('p', 'below-floor')],
      [{ name: 'catalog', pageId: 'p' }],
    );

    expect(tally!.retrieved).toBe(2);
    expect(tally!.fallback).toBe(1);
  });

  it('tallies fallback reasons by name, and never counts a retrieved line as a reason', () => {
    const [tally] = tallyRetrieval(
      [
        fallback('p', 'below-minimum'),
        fallback('p', 'below-minimum'),
        fallback('p', 'below-floor'),
        retrieved('p', 20),
      ],
      [{ name: 'catalog', pageId: 'p' }],
    );

    expect(tally!.reasons).toEqual({ 'below-minimum': 2, 'below-floor': 1 });
  });

  it('reports the min and max selectedCount seen, across both retrieved and fallback lines', () => {
    const [tally] = tallyRetrieval(
      [retrieved('p', 15), retrieved('p', 40), fallback('p', 'below-floor')],
      [{ name: 'catalog', pageId: 'p' }],
    );

    // fallback('p', ...) selects every fact -- 48 -- which is the max here.
    expect(tally!.selectedCountRange).toEqual({ min: 15, max: 48 });
  });

  it('gives a page with no logged entries an empty tally rather than throwing', () => {
    const [tally] = tallyRetrieval([], [{ name: 'personal', pageId: 'personal-id' }]);

    expect(tally).toEqual({
      page: 'personal',
      retrieved: 0,
      fallback: 0,
      reasons: {},
      selectedCountRange: null,
    });
  });
});

describe('formatRetrievalTally', () => {
  it('names the page and both counts', () => {
    const text = formatRetrievalTally(
      tallyRetrieval([retrieved('p', 10)], [{ name: 'catalog', pageId: 'p' }]),
    );

    expect(text).toContain('catalog');
    expect(text).toContain('retrieved 1');
    expect(text).toContain('fallback 0');
  });

  it('prints each fallback reason and its count', () => {
    const text = formatRetrievalTally(
      tallyRetrieval(
        [fallback('p', 'below-minimum'), fallback('p', 'below-minimum')],
        [{ name: 'business', pageId: 'p' }],
      ),
    );

    expect(text).toContain('below-minimum=2');
  });

  it('omits the reasons parenthetical entirely when nothing fell back', () => {
    const text = formatRetrievalTally(
      tallyRetrieval([retrieved('p', 10)], [{ name: 'catalog', pageId: 'p' }]),
    );

    expect(text).not.toContain('(');
  });

  it('prints n/a for a page nothing was logged for', () => {
    const text = formatRetrievalTally(tallyRetrieval([], [{ name: 'personal', pageId: 'p' }]));

    expect(text).toContain('selectedCount n/a');
  });
});
