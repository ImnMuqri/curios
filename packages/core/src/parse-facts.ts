import { FACT_CATEGORIES, type FactCategory, type ParsedFact } from './types.js';

export interface ParseResult {
  facts: ParsedFact[];
  total: number;
  failed: number;
}

const CATEGORIES = new Set<string>(FACT_CATEGORIES);

function parseBlock(block: string): ParsedFact | null {
  const lines = block.split('\n');

  let category: FactCategory | null = null;
  let confidence = 0.5;
  let sourceText = '';
  let question: string | null = null;
  const claimLines: string[] = [];

  for (const line of lines) {
    const category_ = /^category:\s*(.*)$/i.exec(line);
    if (category_ && claimLines.length === 0) {
      const value = (category_[1] ?? '').trim().toUpperCase();
      category = CATEGORIES.has(value) ? (value as FactCategory) : null;
      continue;
    }

    const confidence_ = /^confidence:\s*(.*)$/i.exec(line);
    if (confidence_ && claimLines.length === 0) {
      const value = Number.parseFloat((confidence_[1] ?? '').trim());
      // A bad number is not worth discarding a claim over; fall back to 0.5.
      confidence = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
      continue;
    }

    const source_ = /^source:\s*(.*)$/i.exec(line);
    if (source_ && claimLines.length === 0) {
      sourceText = (source_[1] ?? '').trim();
      continue;
    }

    const question_ = /^question:\s*(.*)$/i.exec(line);
    if (question_ && claimLines.length === 0) {
      const value = (question_[1] ?? '').trim();
      // An empty question line is the model saying nothing, not saying ''.
      question = value === '' ? null : value;
      continue;
    }

    if (line.trim()) claimLines.push(line.trim());
  }

  const claim = claimLines.join(' ').trim();
  if (!category || !claim) return null;

  return { category, confidence, sourceText, claim, question };
}

/**
 * Lenient by design. A malformed block is skipped and counted, never fatal --
 * the caller decides whether the failure rate is bad enough to retry.
 */
export function parseFactBlocks(raw: string): ParseResult {
  if (!raw.trim()) return { facts: [], total: 0, failed: 0 };

  const blocks = raw
    .split(/^\s*---\s*$/m)
    .map((b) => b.trim())
    .filter(Boolean)
    // Preamble has no `category:` line at all; drop it without counting it as a
    // failure, since the model was told not to write it and it carries no claim.
    .filter((b) => /^category:/im.test(b));

  const facts: ParsedFact[] = [];
  let failed = 0;

  for (const block of blocks) {
    const parsed = parseBlock(block);
    if (parsed) facts.push(parsed);
    else failed += 1;
  }

  return { facts, total: blocks.length, failed };
}
