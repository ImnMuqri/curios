import { COUNTED_ORDER_WHERE, voucherState, type OwnerVoucher, type VoucherTerms } from '@curios/core/vouchers';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prismaRead } from './client.js';

export type { OwnerVoucher } from '@curios/core/vouchers';

/** A voucher that is switched on and has not ended; whether it is used up is a count, which `voucherUses` gives. */
export function liveVoucherWhere(now: Date): Prisma.ShopVoucherWhereInput {
  return { active: true, OR: [{ endsAt: null }, { endsAt: { gt: now } }] };
}

/**
 * How many orders each voucher is on: placed, paid or finished, but not one cancelled before it
 * was paid, which gives the use back. A voucher with none is 0, not missing.
 */
export async function voucherUses(db: Pick<PrismaClient, 'order'>, voucherIds: string[]): Promise<Map<string, number>> {
  const uses = new Map(voucherIds.map((id) => [id, 0]));
  if (voucherIds.length === 0) return uses;
  const groups = await db.order.groupBy({
    by: ['voucherId'],
    where: { voucherId: { in: voucherIds }, ...COUNTED_ORDER_WHERE },
    _count: { _all: true },
  });
  for (const g of groups) if (g.voucherId) uses.set(g.voucherId, g._count._all);
  return uses;
}

const TERMS_SELECT = {
  id: true,
  mode: true,
  kind: true,
  percent: true,
  amountCents: true,
  itemId: true,
  minSpendCents: true,
  code: true,
  name: true,
} as const;

function termsOf({ code, name, ...terms }: Prisma.ShopVoucherGetPayload<{ select: typeof TERMS_SELECT }>): VoucherTerms {
  return { ...terms, label: code ?? name ?? '' };
}

/**
 * The automatic vouchers checkout applies by itself: switched on, not ended and not used up.
 * Code vouchers are left out; a customer has to type one, and the API looks it up then.
 */
export async function getLiveAutoVouchers(pageId: string, now: Date): Promise<VoucherTerms[]> {
  const rows = await prismaRead.shopVoucher.findMany({
    where: { pageId, mode: 'AUTO', ...liveVoucherWhere(now) },
    orderBy: { createdAt: 'asc' },
    select: { ...TERMS_SELECT, maxUses: true },
  });
  const uses = await voucherUses(prismaRead, rows.map((r) => r.id));
  return rows.filter((r) => r.maxUses === null || (uses.get(r.id) ?? 0) < r.maxUses).map(({ maxUses: _maxUses, ...row }) => termsOf(row));
}

/** The owner's vouchers, newest first, each with its uses and whether it is working. */
export async function getOwnerVouchers(accountId: string, now = new Date()): Promise<OwnerVoucher[]> {
  const rows = await prismaRead.shopVoucher.findMany({
    where: { page: { accountId } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { ...TERMS_SELECT, endsAt: true, maxUses: true, active: true, item: { select: { name: true } } },
  });
  const uses = await voucherUses(prismaRead, rows.map((r) => r.id));
  return rows.map(({ item, endsAt, ...row }) => {
    const used = uses.get(row.id) ?? 0;
    return {
      ...termsOf(row),
      code: row.code,
      name: row.name,
      endsAt: endsAt?.toISOString() ?? null,
      maxUses: row.maxUses,
      active: row.active,
      uses: used,
      state: voucherState({ active: row.active, endsAt, maxUses: row.maxUses }, used, now),
      itemName: item?.name ?? null,
    };
  });
}
