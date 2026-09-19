export { checkAnswer, failed, numbersIn } from './rules.js';
export type { Expectation, RuleVerdict } from './rules.js';
export { GOLDEN_HANDLE_PREFIX, loadFixtures, validateFixture } from './fixtures.js';
export type {
  GoldenFact,
  GoldenFixture,
  GoldenPage,
  GoldenQuestion,
  LoadedFixture,
} from './fixtures.js';
export { formatCost, formatReport, summarise } from './report.js';
export type { QuestionResult, Summary } from './report.js';
