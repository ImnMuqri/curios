import type { PrismaClient } from '@curios/db';
import { NEVER_SAY_MAX, NEVER_SAY_MAX_CHARS } from '@curios/core';
import { NoPageError } from '../pages/page.service.js';

export class InvalidNeverSayError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_NEVER_SAY';
  constructor() {
    super(`Write it on one line, up to ${NEVER_SAY_MAX_CHARS} characters.`);
    this.name = 'InvalidNeverSayError';
  }
}

export class DuplicateNeverSayError extends Error {
  readonly statusCode = 409;
  readonly code = 'NEVER_SAY_DUPLICATE';
  constructor() {
    super("That's already on the list.");
    this.name = 'DuplicateNeverSayError';
  }
}

export class NeverSayLimitError extends Error {
  readonly statusCode = 409;
  readonly code = 'NEVER_SAY_LIMIT';
  constructor() {
    super(`You have reached ${NEVER_SAY_MAX}. Remove one first.`);
    this.name = 'NeverSayLimitError';
  }
}

export class NeverSayNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('No such entry.');
    this.name = 'NeverSayNotFoundError';
  }
}

// Check for any control character or line separators
function hasControlChar(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0);
    // Control characters: 0x00-0x1F, 0x7F
    // Line/paragraph separators: 0x2028, 0x2029
    if ((code <= 0x1f) || (code === 0x7f) || (code === 0x2028) || (code === 0x2029)) {
      return true;
    }
  }
  return false;
}

const key = (phrase: string) => phrase.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * One never-say entry. The count-then-create can let two simultaneous adds
 * reach NEVER_SAY_MAX + 1; the cap bounds prompt size, and one over is not
 * worth a lock -- the same trade addLink makes.
 */
export async function addNeverSay(
  prisma: PrismaClient,
  accountId: string,
  raw: string,
): Promise<{ id: string; phrase: string }> {
  const phrase = raw.trim();
  if (phrase === '' || hasControlChar(phrase) || [...phrase].length > NEVER_SAY_MAX_CHARS) {
    throw new InvalidNeverSayError();
  }

  const page = await prisma.page.findUnique({ where: { accountId }, select: { id: true } });
  if (!page) throw new NoPageError();

  const existing = await prisma.neverSay.findMany({ where: { pageId: page.id }, select: { phrase: true } });
  if (existing.some((row) => key(row.phrase) === key(phrase))) throw new DuplicateNeverSayError();
  if (existing.length >= NEVER_SAY_MAX) throw new NeverSayLimitError();

  return prisma.neverSay.create({ data: { pageId: page.id, phrase }, select: { id: true, phrase: true } });
}

export async function removeNeverSay(prisma: PrismaClient, accountId: string, id: string): Promise<void> {
  const { count } = await prisma.neverSay.deleteMany({ where: { id, page: { accountId } } });
  if (count === 0) throw new NeverSayNotFoundError();
}
