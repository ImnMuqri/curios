/**
 * The rules of a page's shop, shared by the API, the public shop and the
 * owner's editor -- so the editor cannot accept what the API refuses.
 *
 * Imports nothing, like bento.ts: client components load it through
 * `@curios/core/store`, and the barrel reaches `node:crypto`.
 *
 * Money is integer sen throughout. A float ringgit would make RM0.10 + RM0.20
 * a different number from RM0.30, on a page whose whole promise is that it
 * never says a wrong price.
 */

export const MAX_ITEMS = 40;
export const MAX_OPTIONS = 10;
export const ITEM_NAME_MAX = 60;
export const ITEM_DESCRIPTION_MAX = 280;
export const OPTION_LABEL_MAX = 30;
export const ITEM_CATEGORY_MAX = 30;
/** The tag on an item's card: one short word, so it fits the corner of a photo. */
export const ITEM_TAG_MAX = 20;
/** The tags the editor offers; the owner may type their own instead. */
export const ITEM_TAG_PRESETS = ['Best seller', 'Pre-order', 'New'] as const;
/** RM10,000. A cake shop's whole catalogue sits far below it; a typo of three extra zeros does not. */
export const PRICE_MAX_CENTS = 1_000_000;
export const PICKUP_NOTE_MAX = 120;
/** One line under the delivery mode at checkout, as the pickup note is under pickup. */
export const DELIVERY_NOTE_MAX = 120;
/** "About your shop": a line or two above the shelf. */
export const SHOP_DESCRIPTION_MAX = 160;
export const BANK_NAME_MAX = 60;
export const BANK_ACCOUNT_NAME_MAX = 80;
export const DELIVERY_FEE_MAX_CENTS = 50_000;
export const MIN_NOTICE_DAYS_MAX = 30;

export const DELIVERY_MODES = ['NONE', 'FLAT', 'RIDER'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export type Pricing =
  | { kind: 'single'; priceCents: number }
  | { kind: 'options'; options: { label: string; priceCents: number }[] };

/** What a price line needs to know about an item, as stored. */
export interface PricedItem {
  priceCents: number | null;
  options: { label: string; priceCents: number }[];
}

export function isPrice(cents: number): boolean {
  return Number.isInteger(cents) && cents > 0 && cents <= PRICE_MAX_CENTS;
}

const PRICE_SENTENCE = `Give it a price above RM0, up to ${formatRinggit(PRICE_MAX_CENTS)}.`;

/** Why this pricing cannot be stored, or null when it can. The one statement of the price-or-options rule. */
export function pricingProblem(pricing: Pricing): string | null {
  if (pricing.kind === 'single') return isPrice(pricing.priceCents) ? null : PRICE_SENTENCE;

  const { options } = pricing;
  if (options.length === 0) return 'Add at least one option, or give the item one price.';
  if (options.length > MAX_OPTIONS) return `An item holds at most ${MAX_OPTIONS} options.`;
  const seen = new Set<string>();
  for (const option of options) {
    const label = option.label.trim();
    if (label === '' || [...label].length > OPTION_LABEL_MAX) {
      return `Give each option a name, up to ${OPTION_LABEL_MAX} characters.`;
    }
    const key = label.toLowerCase();
    if (seen.has(key)) return `"${label}" is listed twice. Give each option its own name.`;
    seen.add(key);
    if (!isPrice(option.priceCents)) return `"${label}": ${PRICE_SENTENCE}`;
  }
  return null;
}

/** RM95, RM95.50, RM1,234.56 -- the way a Malaysian price tag reads. */
export function formatRinggit(cents: number): string {
  const ringgit = Math.floor(cents / 100);
  const sen = cents % 100;
  const whole = ringgit.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sen === 0 ? `RM${whole}` : `RM${whole}.${sen.toString().padStart(2, '0')}`;
}

/**
 * A price as an owner types it -- "95", "RM 95", "95.5", "1,200" -- in sen,
 * or null when it is not a number of ringgit. Zero parses: whether zero is a
 * price is `isPrice`'s question, and the editor says so in its own words.
 */
export function parseRinggit(text: string): number | null {
  const cleaned = text.trim().replace(/^rm\s*/i, '').replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** "RM25", or "1kg RM95 · 2kg RM170" in the owner's own order. */
export function priceLine(item: PricedItem): string {
  if (item.options.length === 0) return item.priceCents === null ? '' : formatRinggit(item.priceCents);
  return item.options.map((option) => `${option.label} ${formatRinggit(option.priceCents)}`).join(' · ');
}

/** The lowest price, for "from RM95" on a card. */
export function fromPrice(item: PricedItem): number | null {
  if (item.options.length === 0) return item.priceCents;
  return Math.min(...item.options.map((option) => option.priceCents));
}

/** Digits only, 6 to 20 of them -- every Malaysian bank's account numbers fall inside that. */
export function normalizeBankAccountNumber(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{6,20}$/.test(digits) ? digits : null;
}

export interface StoreReadiness {
  pickupEnabled: boolean;
  deliveryMode: DeliveryMode;
  paymentQrKey: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
}

export type StoreGap = 'payment' | 'fulfilment';

/**
 * What stops this shop from opening. A customer will pay the moment they
 * order (slice 18), so a shop with no way to pay would take orders nobody can
 * pay for; and one with neither pickup nor delivery has no way to hand them over.
 */
export function storeGaps(s: StoreReadiness): StoreGap[] {
  const gaps: StoreGap[] = [];
  const bank = Boolean(s.bankName && s.bankAccountName && s.bankAccountNumber);
  if (!s.paymentQrKey && !bank) gaps.push('payment');
  if (!s.pickupEnabled && s.deliveryMode === 'NONE') gaps.push('fulfilment');
  return gaps;
}

export function storeGapMessage(gaps: StoreGap[]): string {
  const parts = [
    ...(gaps.includes('payment') ? ['add a way to pay (a DuitNow QR or your bank account)'] : []),
    ...(gaps.includes('fulfilment') ? ['turn on pickup or delivery'] : []),
  ];
  return `Before your shop can open, ${parts.join(' and ')}.`;
}
