import type { SourceDocument } from '@curios/core';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ExtractInput {
  documents: SourceDocument[];
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
}
