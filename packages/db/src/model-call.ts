import { costFor, type TokenUsage } from '@curios/gateway';
import type { PrismaClient } from '@prisma/client';

export interface ModelCallFields {
  pageId?: string;
  conversationId?: string;
  ingestionId?: string;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  ok: boolean;
  errorCode?: string;
}

/**
 * Every provider call gets a row, failures included. This is the only place the
 * margin becomes visible, and it cannot be backfilled.
 */
export async function recordModelCall(
  prisma: PrismaClient,
  fields: ModelCallFields,
): Promise<void> {
  const { costMilliCents, priceVersion } = costFor(fields.model, fields.usage);

  await prisma.modelCall.create({
    data: {
      pageId: fields.pageId ?? null,
      conversationId: fields.conversationId ?? null,
      ingestionId: fields.ingestionId ?? null,
      model: fields.model,
      inputTokens: fields.usage.inputTokens,
      outputTokens: fields.usage.outputTokens,
      cacheReadTokens: fields.usage.cacheReadTokens,
      cacheWriteTokens: fields.usage.cacheWriteTokens,
      costMilliCents,
      priceVersion,
      latencyMs: fields.latencyMs,
      ok: fields.ok,
      errorCode: fields.errorCode ?? null,
    },
  });
}
