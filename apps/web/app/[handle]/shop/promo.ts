import { formatRinggit } from '@curios/core/store';
import type { VoucherTerms } from '@curios/core/vouchers';

/** Customers only ever see automatic vouchers; a code is typed, never advertised. */
const live = (vouchers: VoucherTerms[] | undefined) => (vouchers ?? []).filter((v) => v.mode === 'AUTO');

/** Percent first (by value), then a fixed amount (by value): the one headline worth a sign. */
function rank(a: VoucherTerms, b: VoucherTerms): number {
  if (a.kind !== b.kind) return a.kind === 'PERCENT' ? -1 : 1;
  return (b.percent ?? b.amountCents ?? 0) - (a.percent ?? a.amountCents ?? 0);
}

const best = (list: VoucherTerms[]) => [...list].sort(rank)[0] ?? null;

/** The one whole-order voucher the shop's sign shows, or null. */
export function shopPromo(vouchers: VoucherTerms[] | undefined): VoucherTerms | null {
  return best(live(vouchers).filter((v) => v.itemId === null));
}

/** The one-item voucher for this item (the biggest, when there are several), or null. */
export function itemPromo(vouchers: VoucherTerms[] | undefined, itemId: string): VoucherTerms | null {
  return best(live(vouchers).filter((v) => v.itemId === itemId));
}

/** "10%" or "RM5": what the voucher takes off. */
export function offText(v: VoucherTerms): string {
  return v.kind === 'PERCENT' ? `${v.percent ?? 0}%` : formatRinggit(v.amountCents ?? 0);
}

/** "RM50" when the voucher needs a minimum spend, else null. */
export function minText(v: VoucherTerms): string | null {
  return v.minSpendCents ? formatRinggit(v.minSpendCents) : null;
}
