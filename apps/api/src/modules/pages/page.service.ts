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
  input: { handle: string; displayName: string; mode?: 'PERSONAL' | 'BUSINESS' },
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
        // The column's own default, spelled out so the claim reads without the
        // schema open. The onboarding form always sends a choice.
        mode: input.mode ?? 'BUSINESS',
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

export class NoPageError extends Error {
  readonly statusCode = 404;
  readonly code = 'NO_PAGE';
  constructor() {
    super('Claim a handle first.');
    this.name = 'NoPageError';
  }
}

/**
 * The deliberate owner action that makes a page visible.
 *
 * Takes no page id. One page per account is a database constraint, so the
 * caller's page is unambiguous, and an id parameter would only add an
 * authorization surface to get wrong.
 *
 * Slice 1 already filters both read paths on `published`, which is why this
 * had to exist in this slice at all: without it nothing an owner does can ever
 * be seen.
 */
export async function publishPage(prisma: PrismaClient, accountId: string): Promise<void> {
  const published = await prisma.page.updateMany({
    where: { accountId },
    data: { published: true },
  });

  if (published.count !== 1) throw new NoPageError();
}

/**
 * Makes the owner's personal page a business page. One-way: nothing leads
 * back, because going from business to personal would need rules for paid
 * time, captured leads and indexed FAQ pages that nothing needs yet.
 *
 * A page that is already business succeeds without change -- a second click or
 * a stale screen is not an error. Zero rows changed means one of two things,
 * so a read tells them apart; the read cannot race anything, because the only
 * write it could miss is this same idempotent one.
 *
 * What the page gains needs no further write: a personal page never captures,
 * so `leadsCaptured` is still 0 and the full trial is there; `trialResetAt` is
 * still null, so the reset is too; and FAQ pages and indexing follow from the
 * mode itself.
 */
export async function upgradeToBusiness(prisma: PrismaClient, accountId: string): Promise<void> {
  const upgraded = await prisma.page.updateMany({
    where: { accountId, mode: 'PERSONAL' },
    data: { mode: 'BUSINESS' },
  });
  if (upgraded.count === 1) return;

  const page = await prisma.page.findUnique({ where: { accountId }, select: { id: true } });
  if (!page) throw new NoPageError();
}

/**
 * Whether the owner's page may appear in search results, if it is personal.
 * Accepted for any page: a business page is indexed regardless (`shouldIndex`
 * in @curios/core), so setting this there changes nothing anyone sees.
 */
/** Which owner emails are on (Settings, "Email me when"). Today: each lead. */
export async function setNotifications(
  prisma: PrismaClient,
  accountId: string,
  input: { leads: boolean },
): Promise<void> {
  const updated = await prisma.page.updateMany({
    where: { accountId },
    data: { notifyLeads: input.leads },
  });
  if (updated.count !== 1) throw new NoPageError();
}

export async function setSearchIndexing(
  prisma: PrismaClient,
  accountId: string,
  allow: boolean,
): Promise<void> {
  const updated = await prisma.page.updateMany({
    where: { accountId },
    data: { allowSearchIndexing: allow },
  });
  if (updated.count !== 1) throw new NoPageError();
}
