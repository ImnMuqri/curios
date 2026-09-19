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
