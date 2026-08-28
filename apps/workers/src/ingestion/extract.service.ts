import {
  normalizeClaim,
  parseFactBlocks,
  type IngestJobData,
  type SourceDocument,
} from '@curios/core';
import { recordModelCall, type PrismaClient } from '@curios/db';
import type { Gateway } from '@curios/gateway';
import type { SourceAdapter } from '../sources/types.js';

export interface ExtractDeps {
  prisma: PrismaClient;
  gateway: Gateway;
  adapter: SourceAdapter;
}

/** Phrases that indicate scraped text is addressing the model, not describing the business. */
const INJECTION_MARKERS = [
  'ignore your instruction',
  'ignore previous',
  'ignore all previous',
  'disregard the above',
  'you are now',
  'system prompt',
  'act as',
];

export function isImperative(claim: string): boolean {
  const lower = claim.toLowerCase();
  return INJECTION_MARKERS.some((marker) => lower.includes(marker));
}

export async function runExtraction(
  deps: ExtractDeps,
  job: IngestJobData,
): Promise<{ extractedCount: number }> {
  const { prisma, gateway, adapter } = deps;

  await prisma.ingestion.update({
    where: { id: job.ingestionId },
    data: { status: 'RUNNING' },
  });

  // The crawl gets its own failure path. It runs before any model call, so a
  // failure here writes no ModelCall — a zero-token row would pollute the
  // margin data this table exists to provide. But the Ingestion row must still
  // reach a terminal state: the onboarding screen polls it, and the Instagram
  // adapter throws NOT_CONFIGURED by design, so "crawl threw" is a guaranteed
  // path rather than a hypothetical one. Left unhandled it spins forever.
  let documents: SourceDocument[];
  try {
    documents = await adapter.fetch(job.sourceUrl);
  } catch (error) {
    await prisma.ingestion.update({
      where: { id: job.ingestionId },
      data: { status: 'FAILED', error: (error as Error).message.slice(0, 500) },
    });
    throw error;
  }

  let raw: string;
  try {
    const result = await gateway.extract({ documents });
    raw = result.raw;
    await recordModelCall(prisma, {
      pageId: job.pageId,
      ingestionId: job.ingestionId,
      model: result.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
      ok: true,
    });
  } catch (error) {
    await recordModelCall(prisma, {
      pageId: job.pageId,
      ingestionId: job.ingestionId,
      model: 'claude-opus-5',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      latencyMs: 0,
      ok: false,
      errorCode: 'PROVIDER_UNAVAILABLE',
    });
    await prisma.ingestion.update({
      where: { id: job.ingestionId },
      data: { status: 'FAILED', error: (error as Error).message.slice(0, 500) },
    });
    throw error;
  }

  const { facts } = parseFactBlocks(raw);

  // Facts are hostile input until reviewed. An injected instruction is flagged
  // and confidence-penalised, never silently dropped -- dropping it hides the
  // attack from the owner and teaches us nothing.
  const rows = facts.map((fact) => {
    const flagged = isImperative(fact.claim);
    return {
      pageId: job.pageId,
      category: fact.category,
      claim: fact.claim,
      normalizedClaim: normalizeClaim(fact.claim),
      sourceUrl: job.sourceUrl,
      sourceText: fact.sourceText,
      confidence: flagged ? Math.min(fact.confidence, 0.2) : fact.confidence,
      flagged,
      verified: false,
    };
  });

  // skipDuplicates against @@unique([pageId, normalizedClaim]) is what makes
  // re-running this job produce one set of facts rather than two.
  const created = await prisma.fact.createMany({ data: rows, skipDuplicates: true });

  await prisma.ingestion.update({
    where: { id: job.ingestionId },
    data: { status: 'SUCCEEDED', extractedCount: rows.length },
  });

  return { extractedCount: created.count };
}
