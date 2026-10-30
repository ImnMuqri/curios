/**
 * The voucher rules a browser and the API must agree on: what a voucher saves
 * on a basket, which one wins, and what an owner may make.
 *
 * Imports only `orders.ts`, which imports nothing, so a client component can load it by its
 * subpath.
 */

import { ORDER_TOTAL_MAX_CENTS } from './orders.js';

export type VoucherMode = 'AUTO' | 'CODE';
export type VoucherKind = 'PERCENT' | 'AMOUNT';
export type VoucherState = 'on' | 'off' | 'ended' | 'usedUp';

export const VOUCHER_CODE = /^[A-Z0-9]{3,20}$/;
export const VOUCHER_NAME_MAX = 40;
const VOUCHER_MAX_USES = 100_000;

/** A live voucher's terms, as the server sends them and the basket judges them. `label` is the code or the name. */
export interface VoucherTerms {
  id: string;
  mode: VoucherMode;
  kind: VoucherKind;
  percent: number | null;
  amountCents: number | null;
  itemId: string | null;
  minSpendCents: number | null;
  label: string;
}

/** A voucher as the owner sees it in the dashboard. */
export interface OwnerVoucher extends VoucherTerms {
  code: string | null;
  name: string | null;
  /** ISO time the voucher stops working. */
  endsAt: string | null;
  maxUses: number | null;
  active: boolean;
  uses: number;
  state: VoucherState;
  itemName: string | null;
}

export type VoucherLine = { itemId: string; unitCents: number; quantity: number };

/** Prisma `where` for the orders that count as a use of a voucher: those cancelled before being paid do not. */
export const COUNTED_ORDER_WHERE = { NOT: { status: 'CANCELLED', paidAt: null } } as const;

export function normalizeVoucherCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * What a voucher takes off, in sen; 0 when it does not fit the basket. A
 * percent is floored to the sen, and an amount is taken once per order. Neither
 * takes more than the lines it covers cost. The minimum spend is judged on
 * every item, whatever the voucher covers.
 */
export function voucherSaving(v: VoucherTerms, lines: VoucherLine[]): number {
  const total = (ls: VoucherLine[]) => ls.reduce((sum, l) => sum + l.unitCents * l.quantity, 0);
  if (v.minSpendCents !== null && total(lines) < v.minSpendCents) return 0;
  const base = total(v.itemId === null ? lines : lines.filter((l) => l.itemId === v.itemId));
  const saving = v.kind === 'PERCENT' ? Math.floor((base * (v.percent ?? 0)) / 100) : (v.amountCents ?? 0);
  return Math.max(0, Math.min(saving, base));
}

/**
 * The voucher that saves the customer most. A typed code that saves as much as
 * the best automatic one wins the tie, since the customer chose it. A typed id
 * that is not among the candidates is ignored.
 */
export function pickVoucher(
  candidates: VoucherTerms[],
  lines: VoucherLine[],
  typedId?: string | null,
): { voucher: VoucherTerms; savingCents: number } | null {
  let best: { voucher: VoucherTerms; savingCents: number } | null = null;
  for (const voucher of candidates) {
    const savingCents = voucherSaving(voucher, lines);
    if (savingCents === 0) continue;
    const beats =
      best === null || savingCents > best.savingCents || (savingCents === best.savingCents && voucher.id === typedId);
    if (beats) best = { voucher, savingCents };
  }
  return best;
}

export interface VoucherInput {
  mode: VoucherMode;
  code: string | null;
  name: string | null;
  kind: VoucherKind;
  percent: number | null;
  amountCents: number | null;
  itemId: string | null;
  minSpendCents: number | null;
  /** `YYYY-MM-DD`, the last day the voucher works. */
  endsOn: string | null;
  maxUses: number | null;
}

/** The owner-facing reason an input is refused, or null when it is fine. */
export function checkVoucherInput(input: VoucherInput): string | null {
  if (input.mode === 'CODE') {
    if (!VOUCHER_CODE.test(normalizeVoucherCode(input.code ?? ''))) return 'The code is 3 to 20 letters and numbers.';
  } else {
    const length = (input.name ?? '').trim().length;
    if (length < 1 || length > VOUCHER_NAME_MAX) return `Give it a name of 1 to ${VOUCHER_NAME_MAX} characters.`;
  }

  if (input.kind === 'PERCENT') {
    const p = input.percent;
    if (p === null || !Number.isInteger(p) || p < 1 || p > 100 || input.amountCents !== null) {
      return 'A percent voucher takes 1 to 100 percent off.';
    }
  } else {
    const a = input.amountCents;
    if (a === null || !Number.isInteger(a) || a <= 0 || a > ORDER_TOTAL_MAX_CENTS || input.percent !== null) {
      return 'An amount voucher takes more than RM0, and at most RM1,000,000, off.';
    }
  }

  const uses = input.maxUses;
  if (uses !== null && (!Number.isInteger(uses) || uses < 1 || uses > VOUCHER_MAX_USES)) {
    return `Uses can be 1 to ${VOUCHER_MAX_USES}.`;
  }
  const min = input.minSpendCents;
  if (min !== null && (!Number.isInteger(min) || min <= 0 || min > ORDER_TOTAL_MAX_CENTS)) {
    return 'The minimum spend must be more than RM0, and at most RM1,000,000.';
  }
  if (input.endsOn !== null && !isDay(input.endsOn)) return 'The last day is not a date.';
  return null;
}

function isDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const ms = Date.parse(`${day}T00:00:00Z`);
  // Rejects 2026-02-31 and its kind, which a date parser would roll over.
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === day;
}

/** When a voucher whose last day is `endsOn` stops: the next midnight in Malaysia, so the whole day counts. */
export function voucherEndsAt(endsOn: string): Date {
  const next = new Date(Date.parse(`${endsOn}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return new Date(`${next}T00:00:00+08:00`);
}

/** `off` beats `ended` beats `usedUp`, whatever else is true. */
export function voucherState(
  v: { active: boolean; endsAt: Date | string | null; maxUses: number | null },
  uses: number,
  now: Date,
): VoucherState {
  if (!v.active) return 'off';
  if (v.endsAt !== null && new Date(v.endsAt).getTime() <= now.getTime()) return 'ended';
  if (v.maxUses !== null && uses >= v.maxUses) return 'usedUp';
  return 'on';
}
