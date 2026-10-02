import { SOURCE_LABEL_MAX, type FactCategory } from '@curios/core';
import { prismaRead } from './client.js';

export interface KnowledgeSource {
  id: string;
  /** The link, or null for pasted text. */
  sourceUrl: string | null;
  /** The link, or the first non-empty pasted line, cut to SOURCE_LABEL_MAX. */
  label: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  error: string | null;
  /** False for a source added before slice 14. */
  tracked: boolean;
  /** Facts that removing this source would delete: its non-rejected ones. */
  factCount: number;
  createdAt: Date;
}
export interface KnowledgeFact {
  id: string;
  category: FactCategory;
  claim: string;
  origin: 'EXTRACTED' | 'OWNER' | 'UNTRACKED';
  /** The source's label for EXTRACTED facts; null otherwise. */
  sourceLabel: string | null;
}
export interface KnowledgePinned { topicId: string; question: string; answer: string }
export interface KnowledgeNeverSay { id: string; phrase: string }
export interface Knowledge {
  sources: KnowledgeSource[];
  facts: KnowledgeFact[];
  pinned: KnowledgePinned[];
  neverSay: KnowledgeNeverSay[];
}

/** The link, or the first non-empty pasted line, cut to SOURCE_LABEL_MAX characters. */
export function sourceLabel(sourceUrl: string | null, pastedText: string | null): string {
  const raw = sourceUrl ?? (pastedText ?? '').split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
  if (raw === '') return 'Pasted text';
  const chars = [...raw];
  return chars.length <= SOURCE_LABEL_MAX ? raw : `${chars.slice(0, SOURCE_LABEL_MAX - 1).join('')}…`;
}

/**
 * Everything the chat answers from, for the Knowledge screen.
 *
 * Scoped by the page's owner inside every query. Pasted text is read to make
 * a label and never returned: a source can be 20,000 characters, and the
 * screen needs one line of it.
 */
export async function getKnowledge(accountId: string): Promise<Knowledge | null> {
  const page = await prismaRead.page.findUnique({ where: { accountId }, select: { id: true } });
  if (!page) return null;

  const [rows, facts, topics, neverSay] = await Promise.all([
    prismaRead.ingestion.findMany({
      where: { pageId: page.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sourceUrl: true,
        pastedText: true,
        status: true,
        error: true,
        tracked: true,
        createdAt: true,
        _count: { select: { facts: { where: { rejectedAt: null } } } },
      },
    }),
    prismaRead.fact.findMany({
      where: { pageId: page.id, verified: true, rejectedAt: null },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, category: true, claim: true, origin: true, ingestionId: true },
    }),
    prismaRead.topic.findMany({
      where: { pageId: page.id, answer: { not: null } },
      orderBy: [{ askCount: 'desc' }, { lastAskedAt: 'desc' }],
      select: { id: true, title: true, answer: true },
    }),
    prismaRead.neverSay.findMany({ where: { pageId: page.id }, orderBy: { id: 'asc' }, select: { id: true, phrase: true } }),
  ]);

  const sources: KnowledgeSource[] = rows.map((row) => ({
    id: row.id,
    sourceUrl: row.sourceUrl,
    label: sourceLabel(row.sourceUrl, row.pastedText),
    status: row.status,
    error: row.error,
    tracked: row.tracked,
    factCount: row._count.facts,
    createdAt: row.createdAt,
  }));
  const labels = new Map(sources.map((s) => [s.id, s.label]));

  return {
    sources,
    facts: facts.map((f) => ({
      id: f.id,
      category: f.category,
      claim: f.claim,
      origin: f.origin,
      sourceLabel: f.ingestionId ? (labels.get(f.ingestionId) ?? null) : null,
    })),
    pinned: topics.map((t) => ({ topicId: t.id, question: t.title, answer: t.answer as string })),
    neverSay,
  };
}
