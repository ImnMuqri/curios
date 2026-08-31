import type { PrismaClient } from '@curios/db';
import { checkHandle } from '@curios/core';

export class HandleInvalidError extends Error {
  readonly statusCode = 400;
  readonly code = 'HANDLE_INVALID';
  constructor() {
    super('Handles are 3 to 30 characters, letters, numbers, hyphens and underscores, and cannot start or end with a separator.');
    this.name = 'HandleInvalidError';
  }
}

export class HandleReservedError extends Error {
  readonly statusCode = 400;
  readonly code = 'HANDLE_RESERVED';
  constructor() {
    super('That handle is reserved. Pick another.');
    this.name = 'HandleReservedError';
  }
}

export class HandleTakenError extends Error {
  readonly statusCode = 409;
  readonly code = 'HANDLE_TAKEN';
  constructor() {
    super('That handle is taken. Pick another.');
    this.name = 'HandleTakenError';
  }
}

export class HandleTooSimilarError extends Error {
  readonly statusCode = 409;
  readonly code = 'HANDLE_TOO_SIMILAR';
  constructor() {
    // Deliberately a different message from "taken". The handle they typed is
    // free; what it collides with is another handle's shape, and being told
    // "taken" sends them off trying variants that collide the same way.
    super('That handle is too close to one already in use. Pick another.');
    this.name = 'HandleTooSimilarError';
  }
}

export class PageAlreadyExistsError extends Error {
  readonly statusCode = 409;
  readonly code = 'PAGE_EXISTS';
  constructor() {
    super('You already have a page.');
    this.name = 'PageAlreadyExistsError';
  }
}

/** Which unique index a P2002 came from. Prisma reports the field names. */
function violatedFields(error: unknown): string[] {
  if (typeof error !== 'object' || error === null) return [];
  // Narrowed by the `in` check above, so no assertion is needed on `code`.
  // The one on `meta` below IS needed -- nothing narrows that.
  if (!('code' in error) || error.code !== 'P2002') return [];
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) ? target.map(String) : [];
}

/**
 * Claims a handle and creates the owner's one page.
 *
 * The unique indexes on `handle`, `skeleton` and `accountId` are the
 * serialisation point; there is no read-then-write check here, because two
 * simultaneous claims would both pass it. Each index maps to its own error,
 * because "taken", "too similar" and "you already have a page" are three
 * different facts and only one of them is fixed by choosing another handle.
 */
export async function claimHandle(
  prisma: PrismaClient,
  accountId: string,
  input: { handle: string; displayName: string },
): Promise<{ pageId: string; handle: string }> {
  const checked = checkHandle(input.handle);
  if (!checked.ok) {
    throw checked.reason === 'RESERVED' ? new HandleReservedError() : new HandleInvalidError();
  }

  try {
    const page = await prisma.page.create({
      data: {
        accountId,
        handle: checked.handle,
        skeleton: checked.skeleton,
        displayName: input.displayName.trim(),
      },
      select: { id: true, handle: true },
    });
    return { pageId: page.id, handle: page.handle };
  } catch (error) {
    const fields = violatedFields(error);
    if (fields.includes('accountId')) throw new PageAlreadyExistsError();
    if (fields.includes('skeleton')) throw new HandleTooSimilarError();
    if (fields.includes('handle')) throw new HandleTakenError();
    throw error;
  }
}
