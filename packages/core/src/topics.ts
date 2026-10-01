import { createHash } from 'node:crypto';
import { normalizeClaim } from './normalize.js';

/** The background job that decides which topic a new wording belongs to. */
export const GROUP_QUEUE = 'group-question';

export interface GroupJobData {
  questionId: string;
}

/** At most this many topics are put to the model as candidates. */
export const GROUP_CANDIDATES = 3;

/**
 * Cosine floor for the shortlist. Deliberately loose: the model is the judge,
 * this only keeps obviously unrelated topics out of its prompt. Tune with the
 * grouping goldens, not by eye.
 */
export const GROUP_SHORTLIST_MIN = 0.7;

/** Wordings shown to the model for each candidate topic. */
export const GROUP_SAMPLE_WORDINGS = 3;

/** A topic's title, counted in code points. */
export const TOPIC_TITLE_MAX = 200;

/** An owner's pinned answer, counted in code points. */
export const ANSWER_MAX = 2000;

/**
 * The key a question's vector is cached under in QuestionEmbedding: a digest
 * of the normalised text, never the text (the table is global across pages).
 * Moved here from apps/api so the grouping worker computes the same key.
 *
 * A digest also bounds the key: a follow-up can reach a thousand characters,
 * and Postgres' btree refuses a key over about 2,700 bytes.
 */
export function questionKey(text: string): string {
  return createHash('sha256').update(normalizeClaim(text)).digest('hex');
}
