import { failed, type RuleVerdict } from './rules.js';

/** One question, asked once, with every rule's verdict on the answer. */
export interface QuestionResult {
  page: string;
  ask: string;
  why: string;
  answer: string;
  verdicts: RuleVerdict[];
  /** Set when the model call itself failed, which is not the same as an assertion failing. */
  error?: string;
  /** How many re-runs also failed. Only set on questions that failed the first time. */
  retries?: { failed: number; of: number };
}

export interface Summary {
  questions: number;
  passed: number;
  failed: number;
  errored: number;
  /** Advisory verdicts that did not hold. Reported, never fatal. */
  advisoryMisses: number;
}

export function summarise(results: QuestionResult[]): Summary {
  const errored = results.filter((result) => result.error !== undefined);
  const assertions = results.filter((result) => result.error === undefined);
  const failures = assertions.filter((result) => failed(result.verdicts));

  return {
    questions: results.length,
    passed: assertions.length - failures.length,
    failed: failures.length,
    errored: errored.length,
    advisoryMisses: results.filter((result) =>
      result.verdicts.some((verdict) => verdict.advisory && !verdict.passed),
    ).length,
  };
}

/**
 * A run's cost, in dollars.
 *
 * `ModelCall.costMilliCents` is milli-cents and 1 cent = 1000 milli-cents, so a
 * dollar is 100,000 of them. Four decimal places, because a Haiku run of sixty
 * questions costs about five cents and rounding it to two would print "$0.05" for
 * every run forever.
 */
export function formatCost(milliCents: number): string {
  return `$${(milliCents / 100_000).toFixed(4)}`;
}

/**
 * What the terminal shows: one line per page, then only the questions that
 * need a human, with the answer they actually gave. Every answer is in the
 * transcript file; printing sixty of them here would bury the two that matter.
 */
export function formatReport(results: QuestionResult[], costMilliCents: number): string {
  const pages = [...new Set(results.map((result) => result.page))];
  const lines: string[] = [];

  for (const page of pages) {
    const mine = results.filter((result) => result.page === page);
    const summary = summarise(mine);
    lines.push(
      `${page}  ${summary.questions} questions  ${summary.passed} passed  ${summary.failed} failed` +
        (summary.errored > 0 ? `  ${summary.errored} errored` : ''),
    );

    for (const result of mine) {
      if (result.error !== undefined) {
        lines.push(`  ERROR ${result.ask}`);
        lines.push(`        ${result.error}`);
        continue;
      }
      if (!failed(result.verdicts)) continue;

      lines.push(`  FAIL  ${result.ask}`);
      lines.push(`        why: ${result.why}`);
      for (const verdict of result.verdicts.filter((v) => !v.passed && !v.advisory)) {
        lines.push(`        ${verdict.rule}${verdict.detail === undefined ? '' : `: ${verdict.detail}`}`);
      }
      if (result.retries) {
        lines.push(`        failed ${result.retries.failed} of ${result.retries.of} re-runs`);
      }
      lines.push(`        > ${result.answer}`);
    }
  }

  const total = summarise(results);
  lines.push('');
  lines.push(
    `${total.questions} questions, ${total.passed} passed, ${total.failed} failed, ` +
      `${total.errored} errored, ${total.advisoryMisses} language misses (advisory)`,
  );
  lines.push(`Cost: ${formatCost(costMilliCents)}`);

  return lines.join('\n');
}

/**
 * One `'chat retrieval'` log line, as `selectForQuestion` in
 * apps/api/src/modules/chat/retrieval.ts writes it -- ids, a mode, a reason, a
 * score and two counts. Never the question: this is the whole point of using
 * this shape rather than logging the answer transcript.
 */
export interface RetrievalLogEntry {
  pageId: string;
  mode: 'retrieved' | 'fallback';
  reason: string | null;
  bestScore: number | null;
  factCount: number;
  selectedCount: number;
}

/** One page's worth of retrieval log lines, boiled down to what a human reads. */
export interface RetrievalTally {
  page: string;
  retrieved: number;
  fallback: number;
  /** How many times each fallback reason fired. Empty when nothing fell back. */
  reasons: Record<string, number>;
  /** The smallest and largest `selectedCount` logged, or null if nothing was. */
  selectedCountRange: { min: number; max: number } | null;
}

/**
 * Turns a run's retrieval log lines into one tally per page.
 *
 * Pure, for the same reason `summarise` above is: it is the one part of this
 * observability that can be tested without a database or a model call, so it
 * holds the counting and the runner holds none.
 */
export function tallyRetrieval(
  entries: RetrievalLogEntry[],
  pages: { name: string; pageId: string }[],
): RetrievalTally[] {
  return pages.map(({ name, pageId }) => {
    const mine = entries.filter((entry) => entry.pageId === pageId);
    const reasons: Record<string, number> = {};
    for (const entry of mine) {
      if (entry.reason !== null) reasons[entry.reason] = (reasons[entry.reason] ?? 0) + 1;
    }
    const counts = mine.map((entry) => entry.selectedCount);

    return {
      page: name,
      retrieved: mine.filter((entry) => entry.mode === 'retrieved').length,
      fallback: mine.filter((entry) => entry.mode === 'fallback').length,
      reasons,
      selectedCountRange: counts.length > 0 ? { min: Math.min(...counts), max: Math.max(...counts) } : null,
    };
  });
}

/** What the terminal shows for `tallyRetrieval`'s output: one line per page. */
export function formatRetrievalTally(tallies: RetrievalTally[]): string {
  return tallies
    .map((tally) => {
      const reasonsText = Object.entries(tally.reasons)
        .map(([reason, count]) => `${reason}=${count}`)
        .join(', ');
      const range = tally.selectedCountRange
        ? `${tally.selectedCountRange.min}-${tally.selectedCountRange.max}`
        : 'n/a';

      return (
        `${tally.page}  retrieved ${tally.retrieved}  fallback ${tally.fallback}` +
        (reasonsText === '' ? '' : `  (${reasonsText})`) +
        `  selectedCount ${range}`
      );
    })
    .join('\n');
}
