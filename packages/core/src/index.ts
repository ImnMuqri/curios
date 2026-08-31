export { normalizeClaim } from './normalize.js';
export { FACT_CATEGORIES, INGEST_QUEUE, MAIL_QUEUE } from './types.js';
export type {
  FactCategory,
  SourceDocument,
  ParsedFact,
  IngestJobData,
  MailJobData,
} from './types.js';
export { parseFactBlocks } from './parse-facts.js';
export type { ParseResult } from './parse-facts.js';
