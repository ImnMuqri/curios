import type { SourceDocument } from '@curios/core';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ExtractInput {
  documents: SourceDocument[];
  /**
   * Each piece of the answer as it arrives, so the worker can write a fact the
   * moment its block is complete instead of all of them at the end. The
   * whole answer still comes back in `raw`.
   */
  onText?: (text: string) => void;
}

export interface ExtractOutput {
  raw: string;
  usage: TokenUsage;
  model: string;
  latencyMs: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatInput {
  systemPrompt: string;
  /**
   * The conversation so far, oldest first, ending with the question being
   * asked now. Bounded by the caller -- this interface does not know what a
   * sensible window is, and the caller does.
   */
  messages: ChatMessage[];
  /**
   * Whether to mark the system prompt as a cacheable prefix.
   *
   * Required rather than defaulted, because both answers are right in
   * different modes and a default hides which one a caller got. True when the
   * prompt is the page's whole fact list, which is stable between owner edits
   * and shared by every visitor. False when it was built for this question:
   * the prefix differs every time, so each call would write an entry at a 25%
   * premium that nothing ever reads.
   */
  cachePrompt: boolean;
}

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; usage: TokenUsage; model: string; latencyMs: number };

/**
 * The seam. Tests stub this interface, never the HTTP layer — mocking the wire
 * format couples tests to Anthropic's response shape instead of our own.
 */
export interface SlotsInput {
  /** The whole conversation, oldest first, already attributed. */
  transcript: string;
}

/**
 * What a customer asked for, pulled out of the conversation they had.
 *
 * Every field is nullable and every consumer must cope with all three being
 * null: this runs once per captured lead, and a lead with no slots is worth
 * far more than no lead. BACKEND.md's score is the count of these that came
 * back filled -- a number an owner can verify by looking, not a model opinion.
 */
export interface SlotsOutput {
  product: string | null;
  date: string | null;
  location: string | null;
  /** How many people it is for, and what they can spend: an enquiry's "For" and "Budget". Not scored. */
  people: string | null;
  budget: string | null;
}

export interface SameQuestionCandidate {
  id: string;
  title: string;
  wordings: string[];
}

export interface SameQuestionInput {
  pageName: string;
  mode: 'PERSONAL' | 'BUSINESS';
  wording: string;
  candidates: SameQuestionCandidate[]; // 1..GROUP_CANDIDATES
}

export interface SameQuestionOutput {
  match: string | null; // a candidate id, or null
  usage: TokenUsage;
  model: string;
  latencyMs: number;
}

/**
 * One question to the dashboard's Help chat. The system prompt is the whole help guide, the same for
 * every owner, so it is cached; the owner's details and question come in `messages`, after it.
 */
export interface HelpInput {
  systemPrompt: string;
  /** Oldest first, ending with the question. */
  messages: ChatMessage[];
  /** The guide's entry ids: the only ids the answer may name, besides "none". */
  entryIds: string[];
}

export interface HelpOutput {
  /** An id from `entryIds`, or null when no entry fits (the model said "none"). */
  entryId: string | null;
  answer: string;
  usage: TokenUsage;
  model: string;
  latencyMs: number;
}

export interface Gateway {
  extract(input: ExtractInput): Promise<ExtractOutput>;
  chat(input: ChatInput): AsyncIterable<ChatEvent>;
  /**
   * Runs once, when a lead is captured -- not per turn. Reading the whole
   * transcript at once beats accumulating slots turn by turn, and it spends
   * model tokens only where a lead already exists.
   */
  slots(input: SlotsInput): Promise<SlotsOutput>;
  /**
   * Haiku decides whether a new wording asks the same thing as one of a few
   * shortlisted topics -- 'same' meaning one answer would be correct for both.
   * Background only; never in a request.
   */
  sameQuestion(input: SameQuestionInput): Promise<SameQuestionOutput>;
  /**
   * The Help chat: which guide entry answers the owner, and the answer, as structured output so the
   * panel never trusts a link the model wrote. Throws when the model fails or answers out of shape.
   */
  help(input: HelpInput): Promise<HelpOutput>;
}
