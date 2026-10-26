import type { PrismaClient } from '@curios/db';
import { hashSessionValue, PUBLIC_PAGE_WHERE } from '@curios/core';

export class ReportPageNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'PAGE_NOT_FOUND';
  constructor() {
    super('No such page.');
  }
}

export interface ReportInput {
  reason: 'SCAM' | 'IMPERSONATION' | 'WRONG_PRICES' | 'OFFENSIVE' | 'OTHER';
  details?: string | undefined;
}

/**
 * Records a visitor's report of a public page. A page that is missing,
 * unpublished or suspended is the same 404, so a report cannot be used to
 * tell those apart. Only a hash of the address is kept.
 */
export async function reportPage(
  prisma: PrismaClient,
  handle: string,
  ip: string,
  input: ReportInput,
): Promise<void> {
  const page = await prisma.page.findFirst({
    where: { handle: handle.toLowerCase(), ...PUBLIC_PAGE_WHERE },
    select: { id: true },
  });
  if (!page) throw new ReportPageNotFoundError();

  await prisma.report.create({
    data: {
      pageId: page.id,
      reason: input.reason,
      details: input.details?.trim() || null,
      reporterIpHash: hashSessionValue(ip),
    },
  });
}
