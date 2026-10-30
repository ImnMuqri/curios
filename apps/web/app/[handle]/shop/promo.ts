import { formatRinggit } from '@curios/core/store';
import { voucherSaving, type VoucherTerms } from '@curios/core/vouchers';

/** Customers only ever see automatic vouchers; a code is typed, never advertised. */
const live = (vouchers: VoucherTerms[] | undefined) => (vouchers ?? []).filter((v) => v.mode === 'AUTO');

/** The order a voucher is judged on when it names no minimum spend: RM100 of what it applies to. */
const REFERENCE_BASKET_CENTS = 10_000;

/**
 * What a voucher saves on a reference basket: its minimum spend when it has one (the smallest order it
 * works on), otherwise RM100, all of it what the voucher applies to. A percent and an amount compare in
 * ringgit, so 1% off never outranks RM50 off.
 */
const referenceSaving = (v: VoucherTerms) =>
  voucherSaving(v, [{ itemId: v.itemId ?? '', unitCents: v.minSpendCents ?? REFERENCE_BASKET_CENTS, quantity: 1 }]);

/** The one headline worth a sign: the voucher that saves most on a typical order. */
const rank = (a: VoucherTerms, b: VoucherTerms) => referenceSaving(b) - referenceSaving(a);

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
