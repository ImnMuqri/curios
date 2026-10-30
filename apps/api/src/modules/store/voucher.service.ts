import type { Prisma, PrismaClient } from '@curios/db';
import {
  checkVoucherInput,
  COUNTED_ORDER_WHERE,
  normalizeVoucherCode,
  voucherEndsAt,
  voucherState,
  type OwnerVoucher,
  type VoucherInput,
  type VoucherTerms,
} from '@curios/core/vouchers';
import { VoucherCodeTakenError, VoucherInvalidError, VoucherNotFoundError, VoucherUnknownError } from './store.errors.js';
import { storePageFor } from './store-page.js';

export type VoucherPatch = Partial<VoucherInput> & { active?: boolean };

const SELECT = {
  id: true,
  mode: true,
  code: true,
  name: true,
  kind: true,
  percent: true,
  amountCents: true,
  itemId: true,
  minSpendCents: true,
  endsAt: true,
  maxUses: true,
  active: true,
  item: { select: { name: true } },
} as const;

type Row = Prisma.ShopVoucherGetPayload<{ select: typeof SELECT }>;

/**
 * How many orders each voucher is on: not those cancelled before they were paid, which give the use back.
 * Takes a transaction too, so placing an order counts under the page lock it holds.
 */
async function usesOf(db: Pick<Prisma.TransactionClient, 'order'>, ids: string[]): Promise<Map<string, number>> {
  const uses = new Map(ids.map((id) => [id, 0]));
  if (ids.length === 0) return uses;
  const groups = await db.order.groupBy({
    by: ['voucherId'],
    where: { voucherId: { in: ids }, ...COUNTED_ORDER_WHERE },
    _count: { _all: true },
  });
  for (const g of groups) if (g.voucherId) uses.set(g.voucherId, g._count._all);
  return uses;
}

function termsOf(row: Row, label: string): VoucherTerms {
  return {
    id: row.id,
    mode: row.mode,
    kind: row.kind,
    percent: row.percent,
    amountCents: row.amountCents,
    itemId: row.itemId,
    minSpendCents: row.minSpendCents,
    label,
  };
}

function toOwnerVoucher(row: Row, uses: number, now: Date): OwnerVoucher {
  return {
    ...termsOf(row, row.code ?? row.name ?? ''),
    code: row.code,
    name: row.name,
    endsAt: row.endsAt?.toISOString() ?? null,
    maxUses: row.maxUses,
    active: row.active,
    uses,
    state: voucherState(row, uses, now),
    itemName: row.item?.name ?? null,
  };
}

/** The last day a stored `endsAt` works: the Malaysian day before that midnight, which is what `voucherEndsAt` was given. */
function endsOnOf(endsAt: Date | null): string | null {
  return endsAt === null ? null : new Date(endsAt.getTime() + 8 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
}

function judge(input: VoucherInput): void {
  const problem = checkVoucherInput(input);
  if (problem) throw new VoucherInvalidError(problem);
}

async function checkItem(prisma: PrismaClient, pageId: string, itemId: string | null): Promise<void> {
  if (itemId === null) return;
  const item = await prisma.item.findFirst({ where: { id: itemId, pageId }, select: { id: true } });
  if (!item) throw new VoucherInvalidError('Choose one of your own items.');
}

/** What is stored for a judged input: a code voucher keeps its normalised code and no name, an automatic one its name and no code. */
function columns(input: VoucherInput) {
  return {
    mode: input.mode,
    code: input.mode === 'CODE' ? normalizeVoucherCode(input.code ?? '') : null,
    name: input.mode === 'AUTO' ? (input.name ?? '').trim() : null,
    kind: input.kind,
    percent: input.percent,
    amountCents: input.amountCents,
    itemId: input.itemId,
    minSpendCents: input.minSpendCents,
    endsAt: input.endsOn === null ? null : voucherEndsAt(input.endsOn),
    maxUses: input.maxUses,
  };
}

/** A unique-constraint failure on (page, code): another voucher took it between the read and the write. */
function codeRaced(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

export async function listVouchers(prisma: PrismaClient, accountId: string, now = new Date()): Promise<OwnerVoucher[]> {
  const page = await storePageFor(prisma, accountId);
  const rows = await prisma.shopVoucher.findMany({
    where: { pageId: page.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: SELECT,
  });
  const uses = await usesOf(prisma, rows.map((r) => r.id));
  return rows.map((r) => toOwnerVoucher(r, uses.get(r.id) ?? 0, now));
}

async function oneVoucher(prisma: PrismaClient, id: string, now: Date): Promise<OwnerVoucher> {
  const row = await prisma.shopVoucher.findUniqueOrThrow({ where: { id }, select: SELECT });
  return toOwnerVoucher(row, (await usesOf(prisma, [id])).get(id) ?? 0, now);
}

export async function addVoucher(prisma: PrismaClient, accountId: string, input: VoucherInput): Promise<OwnerVoucher> {
  const page = await storePageFor(prisma, accountId);
  judge(input);
  await checkItem(prisma, page.id, input.itemId);
  try {
    const created = await prisma.shopVoucher.create({ data: { pageId: page.id, ...columns(input) }, select: { id: true } });
    return await oneVoucher(prisma, created.id, new Date());
  } catch (error) {
    if (codeRaced(error)) throw new VoucherCodeTakenError();
    throw error;
  }
}

export async function updateVoucher(prisma: PrismaClient, accountId: string, id: string, patch: VoucherPatch): Promise<OwnerVoucher> {
  const page = await storePageFor(prisma, accountId);
  const stored = await prisma.shopVoucher.findFirst({ where: { id, pageId: page.id }, select: SELECT });
  if (!stored) throw new VoucherNotFoundError();
  const { active, ...fields } = patch;
  // The voucher as the owner made it, the patch over it, and the whole judged.
  const merged: VoucherInput = {
    mode: stored.mode,
    code: stored.code,
    name: stored.name,
    kind: stored.kind,
    percent: stored.percent,
    amountCents: stored.amountCents,
    itemId: stored.itemId,
    minSpendCents: stored.minSpendCents,
    endsOn: endsOnOf(stored.endsAt),
    maxUses: stored.maxUses,
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  };
  judge(merged);
  if (merged.itemId !== stored.itemId) await checkItem(prisma, page.id, merged.itemId);
  try {
    await prisma.shopVoucher.update({ where: { id }, data: { ...columns(merged), ...(active === undefined ? {} : { active }) } });
  } catch (error) {
    if (codeRaced(error)) throw new VoucherCodeTakenError();
    throw error;
  }
  return oneVoucher(prisma, id, new Date());
}

/** Orders that used it keep their snapshot: the foreign key sets their `voucherId` to null. */
export async function removeVoucher(prisma: PrismaClient, accountId: string, id: string): Promise<void> {
  const page = await storePageFor(prisma, accountId);
  const { count } = await prisma.shopVoucher.deleteMany({ where: { id, pageId: page.id } });
  if (count === 0) throw new VoucherNotFoundError();
}

/**
 * The vouchers that can come off an order being placed now: every automatic voucher that is
 * working (on, not ended, under its cap), oldest first as the shop lists them, and the code
 * voucher the customer typed if it is working too. An unknown, ended or used-up code is simply
 * absent. Called with the placement's transaction, under its page lock, so the uses counted
 * here are the ones the order is numbered against.
 */
export async function liveVouchers(
  db: Pick<Prisma.TransactionClient, 'shopVoucher' | 'order'>,
  pageId: string,
  now: Date,
  typedCode?: string | null,
): Promise<{ auto: VoucherTerms[]; typed: VoucherTerms | null }> {
  const code = typedCode ? normalizeVoucherCode(typedCode) : '';
  const rows = await db.shopVoucher.findMany({
    where: {
      pageId,
      active: true,
      AND: [
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        { OR: [{ mode: 'AUTO' }, ...(code ? [{ mode: 'CODE' as const, code }] : [])] },
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: SELECT,
  });
  const uses = await usesOf(db, rows.map((r) => r.id));
  const working = rows.filter((r) => voucherState(r, uses.get(r.id) ?? 0, now) === 'on');
  const typed = working.find((r) => r.mode === 'CODE');
  return {
    auto: working.filter((r) => r.mode === 'AUTO').map((r) => termsOf(r, r.name ?? '')),
    typed: typed ? termsOf(typed, code) : null,
  };
}

/**
 * A customer's typed code. Only a published, unsuspended Business shop that takes orders answers, and only for a
 * code voucher that is on, not ended and not used up; every other case is the same refusal.
 */
export async function checkVoucherCode(prisma: PrismaClient, handle: string, rawCode: string, now = new Date()): Promise<VoucherTerms> {
  const page = await prisma.page.findUnique({
    where: { handle: handle.toLowerCase(), published: true },
    select: { id: true, mode: true, storeEnabled: true, suspendedAt: true },
  });
  if (!page || page.suspendedAt !== null || page.mode !== 'BUSINESS' || !page.storeEnabled) throw new VoucherUnknownError();
  const code = normalizeVoucherCode(rawCode);
  const row = await prisma.shopVoucher.findFirst({ where: { pageId: page.id, mode: 'CODE', code }, select: SELECT });
  if (!row) throw new VoucherUnknownError();
  const uses = (await usesOf(prisma, [row.id])).get(row.id) ?? 0;
  if (voucherState(row, uses, now) !== 'on') throw new VoucherUnknownError();
  return termsOf(row, code);
}
