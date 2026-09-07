import {
  normalizeClaim,
  parseFactBlocks,
  type IngestJobData,
  type SourceDocument,
} from '@curios/core';
import { recordModelCall, type PrismaClient } from '@curios/db';
import { EXTRACT_MODEL, type Gateway } from '@curios/gateway';
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

  // Invariant: every exit from this function, however it fails, must leave the
  // Ingestion row in a terminal state. The onboarding screen polls it, and
  // BullMQ exhausting its retries after a thrown error does not reconcile
  // anything on its own -- an update left unhandled anywhere below strands the
  // row at RUNNING forever. One outer catch marks FAILED for every path. The
  // gateway's own inner catch below exists only to record its ModelCall
  // before rethrowing for this one to catch and mark the row FAILED. The try
  // opens here, before the RUNNING update itself, so even that first write
  // is covered -- if it throws, the FAILED write below will usually also
  // fail (same unreachable database), which is expected: the point is that
  // the attempt is no longer skipped.
  try {
    await prisma.ingestion.update({
      where: { id: job.ingestionId },
      data: { status: 'RUNNING' },
    });

    // The crawl runs before any model call. A failure here reaches the outer
    // catch directly, with no recordModelCall in between -- a zero-token row
    // would pollute the margin data that table exists to provide. The
    // Instagram adapter throws NOT_CONFIGURED by design, so "crawl threw" is a
    // guaranteed path rather than a hypothetical one.
    const documents: SourceDocument[] = await adapter.fetch(job.sourceUrl);

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
      // A call that fails here has already consumed tokens (or the attempt to
      // make it failed outright); either way it must be visible in the one
      // table that tracks margin, not silently absent like the crawl case.
      await recordModelCall(prisma, {
        pageId: job.pageId,
        ingestionId: job.ingestionId,
        model: EXTRACT_MODEL,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        latencyMs: 0,
        ok: false,
        errorCode: 'PROVIDER_UNAVAILABLE',
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
        question: fact.question,
        normalizedClaim: normalizeClaim(fact.claim),
        sourceUrl: job.sourceUrl,
        sourceText: fact.sourceText,
        confidence: flagged ? Math.min(fact.confidence, 0.2) : fact.confidence,
        flagged,
        verified: false,
      };
    });

    // skipDuplicates against @@unique([pageId, normalizedClaim]) is what makes
    // re-running this job produce one set of facts rather than two. A failure
    // here (or in the ingestion.update just below) previously escaped every
    // try/catch in this function and left the row RUNNING forever -- it is
    // now covered by the outer catch like everything else.
    const created = await prisma.fact.createMany({ data: rows, skipDuplicates: true });

    await prisma.ingestion.update({
      where: { id: job.ingestionId },
      data: { status: 'SUCCEEDED', extractedCount: rows.length },
    });

    return { extractedCount: created.count };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.ingestion.update({
      where: { id: job.ingestionId },
      data: { status: 'FAILED', error: message.slice(0, 500) },
    });
    throw error;
  }
}
