import {
  ADMIN_ACTIONS,
  isBigPriceChange,
  resolveSettings,
  type Settings,
  type SwitchKey,
} from '@curios/core';
import { Prisma, type PrismaClient } from '@curios/db';
import type { AdminActor } from './admin-pages.service.js';
import { writeAudit } from './audit.js';

export class SwitchStateError extends Error {
  readonly statusCode = 409;
  readonly code = 'SWITCH_STATE';

  constructor(on: boolean) {
    super(on ? 'That is already on.' : 'That is already off.');
    this.name = 'SwitchStateError';
  }
}

export class BigChangeError extends Error {
  readonly statusCode = 409;
  readonly code = 'BIG_CHANGE';

  constructor(readonly fields: ('monthly' | 'yearly')[]) {
    super('That is a big price change. Confirm it to go ahead.');
    this.name = 'BigChangeError';
  }
}

export class NoChangeError extends Error {
  readonly statusCode = 409;
  readonly code = 'NO_CHANGE';

  constructor() {
    super('Nothing is different from what is saved.');
    this.name = 'NoChangeError';
  }
}

export interface LimitsInput {
  cap: number;
  freeLeads: number;
  freeOrders: number;
  monthlyRm: number;
  yearlyRm: number;
  reason: string;
  confirmBig?: boolean;
}

/** The stored rows laid over the defaults, read inside the writer's transaction so the check and the write agree. */
async function current(tx: Prisma.TransactionClient): Promise<Settings> {
  return resolveSettings(await tx.systemSetting.findMany({ select: { key: true, value: true } }));
}

function put(tx: Prisma.TransactionClient, adminId: string, key: string, value: boolean | number | string | null) {
  // A JSON null is not a database NULL in Prisma; the banner's "none" is stored as the JSON value.
  const stored = value === null ? Prisma.JsonNull : value;
  return tx.systemSetting.upsert({
    where: { key },
    create: { key, value: stored, updatedById: adminId },
    update: { value: stored, updatedById: adminId },
  });
}

const audit = (
  tx: Prisma.TransactionClient,
  actor: AdminActor,
  action: (typeof ADMIN_ACTIONS)[keyof typeof ADMIN_ACTIONS],
  targetId: string,
  reason: string,
  metadata?: Prisma.InputJsonValue,
) =>
  writeAudit(tx, {
    adminUserId: actor.adminId,
    action,
    targetType: 'Setting',
    targetId,
    targetLabel: 'everyone',
    reason,
    metadata,
    ip: actor.ip,
  });

export async function setSwitch(
  prisma: PrismaClient,
  actor: AdminActor,
  key: SwitchKey,
  on: boolean,
  reason: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if ((await current(tx)).switches[key] === on) throw new SwitchStateError(on);
    await put(tx, actor.adminId, `switch.${key}`, on);
    await audit(tx, actor, on ? ADMIN_ACTIONS.TURNED_ON : ADMIN_ACTIONS.TURNED_OFF, key, reason);
  });
}

export async function setLimits(prisma: PrismaClient, actor: AdminActor, input: LimitsInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const now = await current(tx);
    const was = {
      cap: now.cap,
      freeLeads: now.freeLeads,
      freeOrders: now.freeOrders,
      monthlyRm: now.prices.MONTHLY / 100,
      yearlyRm: now.prices.ANNUAL / 100,
    };
    const next = {
      cap: input.cap,
      freeLeads: input.freeLeads,
      freeOrders: input.freeOrders,
      monthlyRm: input.monthlyRm,
      yearlyRm: input.yearlyRm,
    };
    const changed = (Object.keys(was) as (keyof typeof was)[]).filter((k) => was[k] !== next[k]);
    if (changed.length === 0) throw new NoChangeError();

    const big: ('monthly' | 'yearly')[] = [];
    if (changed.includes('monthlyRm') && isBigPriceChange(now.prices.MONTHLY, next.monthlyRm * 100)) big.push('monthly');
    if (changed.includes('yearlyRm') && isBigPriceChange(now.prices.ANNUAL, next.yearlyRm * 100)) big.push('yearly');
    if (big.length > 0 && input.confirmBig !== true) throw new BigChangeError(big);

    const rows = {
      cap: ['cap', next.cap],
      freeLeads: ['freeLeads', next.freeLeads],
      freeOrders: ['freeOrders', next.freeOrders],
      monthlyRm: ['price.MONTHLY', next.monthlyRm * 100],
      yearlyRm: ['price.ANNUAL', next.yearlyRm * 100],
    } as const;
    for (const k of changed) await put(tx, actor.adminId, rows[k][0], rows[k][1]);

    const from: Record<string, number> = {};
    const to: Record<string, number> = {};
    for (const k of changed) {
      from[k] = was[k];
      to[k] = next[k];
    }
    await audit(tx, actor, ADMIN_ACTIONS.CHANGED_LIMITS, 'limits', input.reason, { from, to });
  });
}

/** `text` null takes the banner down. */
export async function setBanner(
  prisma: PrismaClient,
  actor: AdminActor,
  text: string | null,
  reason?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await put(tx, actor.adminId, 'banner', text);
    if (text === null) await audit(tx, actor, ADMIN_ACTIONS.TOOK_BANNER_DOWN, 'banner', reason ?? 'Taken down');
    else await audit(tx, actor, ADMIN_ACTIONS.SHOWED_BANNER, 'banner', text);
  });
}
