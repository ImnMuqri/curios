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
export interface Gateway {
  extract(input: ExtractInput): Promise<ExtractOutput>;
  chat(input: ChatInput): AsyncIterable<ChatEvent>;
}
