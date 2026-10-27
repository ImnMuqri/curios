import { createHmac } from 'node:crypto';
import { Prisma, type PrismaClient, type ReportReason } from '@curios/db';
import { PUBLIC_PAGE_WHERE, type ReportReasonKey } from '@curios/core';

export class ReportPageNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'PAGE_NOT_FOUND';
  constructor() {
    super('No such page.');
  }
}

/** Fails to compile unless core's report reasons and the database enum are the same set. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type ReportReasonsMatchDatabase = Same<ReportReasonKey, ReportReason> extends true ? true : never;
const reasonsMatch: ReportReasonsMatchDatabase = true;
void reasonsMatch;

export interface ReportInput {
  reason: ReportReasonKey;
  details?: string | undefined;
}

/**
 * HMAC-SHA256 of the address under REPORT_IP_SECRET. Keyed, because an IPv4 address is a small
 * space: a bare SHA-256 is undone by hashing every address. Reports stored before the key keep
 * their bare SHA-256 hashes, so a repeat from the same address does not match them and adds a
 * second open report; that only weakens the per-page dedupe for reports already open, and ends
 * once they are decided.
 */
export function hashReporterIp(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(ip).digest('hex');
}

/**
 * Records a visitor's report of a public page. A page that is missing,
 * unpublished or suspended is the same 404, so a report cannot be used to
 * tell those apart. Only a keyed hash of the address is kept.
 *
 * One open report per address per page: a repeat while the first is still open adds nothing and is
 * answered the same as a new one, so one visitor cannot flag a page alone. A partial unique index
 * holds it against two reports sent at once; the loser's unique violation is that same quiet answer.
 */
export async function reportPage(
  prisma: PrismaClient,
  handle: string,
  ip: string,
  input: ReportInput,
  ipSecret: string,
): Promise<void> {
  const page = await prisma.page.findFirst({
    where: { handle: handle.toLowerCase(), ...PUBLIC_PAGE_WHERE },
    select: { id: true },
  });
  if (!page) throw new ReportPageNotFoundError();

  const reporterIpHash = hashReporterIp(ip, ipSecret);
  const open = await prisma.report.findFirst({ where: { pageId: page.id, reporterIpHash, status: 'OPEN' }, select: { id: true } });
  if (open) return;
  try {
    await prisma.report.create({
      data: {
        pageId: page.id,
        reason: input.reason,
        details: input.details?.trim() || null,
        reporterIpHash,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
    throw err;
  }
}
