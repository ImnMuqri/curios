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
  /** The question a visitor would ask to reach this claim. Null when the model omitted it. */
  question: string | null;
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

/**
 * Transactional mail. Same rule as the ingest queue, and here for the same
 * reason: `apps/api` enqueues, `apps/workers` sends, and neither imports the
 * other.
 *
 * Mail leaves the request on purpose. The build spec requires it -- nothing
 * slow runs inside a request -- and two security properties depend on it. A
 * send that fails no longer fails the HTTP call that triggered it, so a signup
 * can never leave an account written but unreachable. And an address that has
 * no account costs the same as one that does, because neither waits for SMTP,
 * which is what stops the response time answering a question the response body
 * refuses to.
 */
export const MAIL_QUEUE = 'mail';
export const LEAD_QUEUE = 'lead';

/**
 * Slot extraction plus the owner's notification, in that order. Extraction is
 * a model call, and nothing generative runs inside an HTTP request -- doing it
 * here also means the mail is only built once the slots exist, so an owner
 * never receives a second email correcting the first.
 */
export interface LeadJobData {
  leadId: string;
}

export interface MailJobData {
  to: string;
  subject: string;
  text: string;
}

/**
 * The billing schedule. The name lives here for the same reason as every other
 * queue's: apps/workers consumes it, and a name spelled inside one app is how the
 * next app to need it gets it wrong. Scheduled jobs carry no data; the job name says
 * which check to run.
 */
export const BILLING_QUEUE = 'billing';
export const PENDING_CHECK_JOB = 'pending-check';
