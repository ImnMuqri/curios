export const FACT_CATEGORIES = [
  'PRICE',
  'HOURS',
  'LOCATION',
  'POLICY',
  'PRODUCT',
  'PERSON',
  'MISC',
] as const;

export type FactCategory = (typeof FACT_CATEGORIES)[number];

/** One fetched page or profile, before extraction. */
export interface SourceDocument {
  url: string;
  title: string;
  text: string;
}

/** One atomic claim, after extraction and before it is written to the database. */
export interface ParsedFact {
  category: FactCategory;
  confidence: number;
  sourceText: string;
  claim: string;
}

/**
 * The queue contract lives here, not in either app.
 *
 * `apps/api` enqueues and `apps/workers` consumes, but the two must never
 * import each other. Putting the name and payload shape in a package both
 * depend on is what keeps that rule true rather than aspirational.
 */
export const INGEST_QUEUE = 'ingest';

export interface IngestJobData {
  ingestionId: string;
  pageId: string;
  sourceUrl: string;
  idempotencyKey: string;
}
