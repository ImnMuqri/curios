import {
  normalizeClaim,
  parseFactBlocks,
  phoneNumbersIn,
  type IngestJobData,
  type ParsedFact,
  type SourceDocument,
} from '@curios/core';
import { recordModelCall, syncFactEmbeddings, type PrismaClient } from '@curios/db';
import { EXTRACT_MODEL, type Gateway } from '@curios/gateway';
import type { Embedder } from '@curios/embeddings';
import type { SourceAdapter } from '../sources/types.js';
import { textAdapter } from '../sources/text.adapter.js';
import { contextAround } from './excerpt.js';
import { completedPart, nextProgress, progressAt, PROGRESS_FETCHED } from './progress.js';

export interface ExtractDeps {
  prisma: PrismaClient;
  gateway: Gateway;
  adapter: SourceAdapter;
  /**
   * Null only in a test or harness: `main.ts` refuses to start this process
   * when `OPENAI_API_KEY` is unset, the same way `chatRoutes` and
   * `factRoutes` do, so a running worker never reaches this function with no
   * embedder. When it is null, facts are still written; the page simply has
   * no vectors, which puts every question on it into fallback until a
   * backfill runs. Never a reason to fail an ingestion.
   */
  embedder: Embedder | null;
  log?: { warn?: (details: object, message: string) => void };
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
    // A URL is crawled; no URL means the owner pasted text, which the row holds.
    const documents: SourceDocument[] = job.sourceUrl
      ? await adapter.fetch(job.sourceUrl)
      : await textAdapter.fetch(await pastedTextOf(prisma, job.ingestionId));

    // Nothing to read: a blocked profile, a dead link, an empty paste. Marked
    // succeeded with zero facts and no model call -- an empty source costs
    // tokens and can only come back empty. The onboarding screen offers the
    // paste box when this happens.
    if (documents.length === 0) {
      await prisma.ingestion.update({
        where: { id: job.ingestionId },
        data: { status: 'SUCCEEDED', extractedCount: 0 },
      });
      return { extractedCount: 0 };
    }

    // Fetched: the first stretch of the bar.
    await prisma.ingestion.update({ where: { id: job.ingestionId }, data: { progress: PROGRESS_FETCHED } });
    const source = documents.map((d) => d.text).join('\n\n');

    // Facts are written as their blocks complete, so the owner sees them
    // arrive (onboarding's list, the source's count) instead of all at the
    // end. Writes queue behind each other in order; one that fails is kept
    // and thrown once the stream ends, into the outer catch like any other.
    let written = 0;
    let created = 0;
    let progress = PROGRESS_FETCHED;
    let writes: Promise<void> = Promise.resolve();
    // An object, so the check after the stream sees what the callbacks set.
    const failure: { error: Error | null } = { error: null };

    const writeNew = async (facts: ParsedFact[]) => {
      // A fact carrying a phone number is not kept: a CV or a website can hold the owner's private
      // number, and a fact is what the chat answers from. The owner publishes a number they want
      // shared as a link (WhatsApp) on My Curios instead.
      const fresh = facts.slice(written).filter((fact) => phoneNumbersIn(fact.claim).length === 0);
      const reached = facts.length;
      if (reached === written) return;
      written = reached;
      if (fresh.length === 0) return;
      // skipDuplicates against @@unique([pageId, normalizedClaim]) is what
      // makes re-running this job produce one set of facts rather than two.
      const result = await prisma.fact.createMany({ data: fresh.map((fact) => factRow(job, fact, source)), skipDuplicates: true });
      created += result.count;
      for (const fact of fresh) progress = nextProgress(progress, progressAt(source, fact.sourceText));
      await prisma.ingestion.update({ where: { id: job.ingestionId }, data: { extractedCount: created, progress } });
    };

    let streamed = '';
    let parsedUpTo = 0;
    const onText = (text: string) => {
      streamed += text;
      if (!text.includes('-')) return;
      const done = completedPart(streamed);
      if (done.length <= parsedUpTo) return;
      parsedUpTo = done.length;
      const { facts } = parseFactBlocks(done);
      writes = writes.then(() => (failure.error ? undefined : writeNew(facts))).catch((error: unknown) => {
        failure.error ??= error instanceof Error ? error : new Error(String(error));
      });
    };

    let raw: string;
    try {
      const result = await gateway.extract({ documents, onText });
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
      await writes;
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

    // The last block has no separator after it, so the whole answer is read
    // once more at the end; the facts already written are skipped by count.
    await writes;
    if (failure.error) throw failure.error;
    await writeNew(parseFactBlocks(raw).facts);

    // Its own try, not the outer one. An ingestion that crawled a site, spent
    // an Opus call and wrote its facts has succeeded; a provider blip on the
    // embeddings call must not turn that into a FAILED row the owner sees as
    // "we could not read your website". The page stays in fallback -- every
    // fact on every question, which is exactly what it did before this slice
    // -- until the backfill or the next crawl catches it.
    if (deps.embedder) {
      try {
        await syncFactEmbeddings(prisma, deps.embedder, { pageId: job.pageId });
      } catch (error) {
        deps.log?.warn?.(
          { pageId: job.pageId, err: error instanceof Error ? error.message : String(error) },
          'facts written but not embedded; this page falls back until a backfill runs',
        );
      }
    }

    await prisma.ingestion.update({
      where: { id: job.ingestionId },
      data: { status: 'SUCCEEDED', extractedCount: created, progress: 100 },
    });

    return { extractedCount: created };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.ingestion.update({
      where: { id: job.ingestionId },
      data: { status: 'FAILED', error: message.slice(0, 500) },
    });
    throw error;
  }
}

/**
 * One parsed fact as a row. Facts are hostile input until reviewed: an
 * injected instruction is flagged and confidence-penalised, never silently
 * dropped -- dropping it hides the attack from the owner and teaches us
 * nothing.
 */
function factRow(job: IngestJobData, fact: ParsedFact, source: string) {
  const flagged = isImperative(fact.claim);
  // What the source says either side of the excerpt, for Review's line.
  const around = contextAround(source, fact.sourceText);
  return {
    pageId: job.pageId,
    // Credited to this ingestion so the owner can remove the source and its
    // facts together. A re-check re-runs the same ingestion id, so new facts
    // from it land on the same source.
    ingestionId: job.ingestionId,
    origin: 'EXTRACTED' as const,
    category: fact.category,
    claim: fact.claim,
    question: fact.question,
    normalizedClaim: normalizeClaim(fact.claim),
    // Taken from the job, not the document: a fact from pasted text has no
    // page, and Review hides the Source link when there is none.
    sourceUrl: job.sourceUrl ?? null,
    sourceText: fact.sourceText,
    sourceBefore: around?.before ?? null,
    sourceAfter: around?.after ?? null,
    confidence: flagged ? Math.min(fact.confidence, 0.2) : fact.confidence,
    flagged,
    verified: false,
  };
}

/**
 * The text an owner pasted for this ingestion. The Ingestion_one_source
 * constraint means a job with no URL always has some; the throw guards the
 * type, and would mean the constraint had been removed.
 */
async function pastedTextOf(prisma: PrismaClient, ingestionId: string): Promise<string> {
  const row = await prisma.ingestion.findUniqueOrThrow({
    where: { id: ingestionId },
    select: { pastedText: true },
  });
  if (row.pastedText === null) {
    throw new Error('This ingestion has neither a website address nor pasted text.');
  }
  return row.pastedText;
}
