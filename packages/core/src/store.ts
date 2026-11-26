/**
 * The rules of a page's shop, shared by the API, the public shop and the
 * owner's editor -- so the editor cannot accept what the API refuses.
 *
 * Imports only money.ts, which imports nothing, like bento.ts: client components load it through
 * `@curios/core/store`, and the barrel reaches `node:crypto`.
 *
 * Money is integer sen throughout. A float ringgit would make RM0.10 + RM0.20
 * a different number from RM0.30, on a page whose whole promise is that it
 * never says a wrong price.
 */

import { ringgit } from './money.js';

export const MAX_ITEMS = 40;
export const MAX_OPTIONS = 10;
export const ITEM_NAME_MAX = 60;
export const ITEM_DESCRIPTION_MAX = 280;
export const OPTION_LABEL_MAX = 30;
/** Choice groups inside options ("Flavour" x "Size"): a group's name and a choice's label, and how many choices a group holds. */
export const CHOICE_NAME_MAX = 40;
export const CHOICE_LABEL_MAX = 40;
export const MAX_CHOICES = 10;
/** What joins the two choices in a combination's label ("Chocolate · 1kg"); a choice's own label may not hold it. */
export const CHOICE_SEPARATOR = ' · ';
export const ITEM_CATEGORY_MAX = 30;
/** The tag on an item's card: one short word, so it fits the corner of a photo. */
export const ITEM_TAG_MAX = 20;
/** The tags the editor offers; the owner may type their own instead. */
export const ITEM_TAG_PRESETS = ['Best seller', 'Pre-order', 'New'] as const;
/** The owner's own reference for an item (a SKU); only the owner sees it. */
export const ITEM_SKU_MAX = 40;
/** RM10,000. A cake shop's whole catalogue sits far below it; a typo of three extra zeros does not. */
export const PRICE_MAX_CENTS = 1_000_000;
export const PICKUP_NOTE_MAX = 120;
/** One line under the delivery mode at checkout, as the pickup note is under pickup. */
export const DELIVERY_NOTE_MAX = 120;
/** "About your shop": a line or two above the shelf. */
export const SHOP_DESCRIPTION_MAX = 160;
/** The shop's own name, over its items and on the page's shop pill. Unset, it is "Shop". */
export const SHOP_NAME_MAX = 40;
export const BANK_NAME_MAX = 60;
export const BANK_ACCOUNT_NAME_MAX = 80;
export const DELIVERY_FEE_MAX_CENTS = 50_000;
export const MIN_NOTICE_DAYS_MAX = 30;
/** An Ask item's enquiry: one message in the customer's own words, and the name they give. */
export const ENQUIRY_MESSAGE_MAX = 1000;
export const ENQUIRY_NAME_MAX = 80;

export const DELIVERY_MODES = ['NONE', 'FLAT', 'RIDER'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export type Pricing =
  | { kind: 'single'; priceCents: number }
  | { kind: 'options'; options: { label: string; priceCents: number }[] }
  /**
   * An Ask item (HANDOFF "Shop: Ask items", 8 Nov 2026): no basket, an enquiry instead. Physical only.
   * `fromCents` is the optional starting price the page answers "how much?" with; null for none.
   */
  | { kind: 'ask'; fromCents: number | null }
  | ChoicesPricing;

/**
 * Options in one or two named groups ("Flavour" x "Size"), a price for every combination (item choices,
 * 26 Nov 2026). `one` and `two` index into the group's `choices`; `photoId` is one of the item's own photos.
 * Each combination is stored as an option whose label is built by choiceCombos.
 */
export interface ChoicesPricing {
  kind: 'choices';
  groupOne: { name: string; choices: { label: string; photoId?: string | null }[] };
  groupTwo?: { name: string; choices: { label: string }[] };
  combos: { one: number; two?: number; priceCents: number; available: boolean }[];
}

/** A choice group as a reader gets it. `photoKey` is the public square of the choice's photo, joined to the storage base like any item photo. */
export interface ItemChoiceGroup {
  name: string;
  choices: { id: string; label: string; photoId: string | null; photoKey: string | null }[];
}

/** One combination as a reader gets it: the option's id and label, the choices it is made of, and whether it is on sale. */
export interface ItemChoiceCombo {
  id: string;
  label: string;
  oneId: string;
  twoId: string | null;
  priceCents: number;
  available: boolean;
}

/** An item's choice groups and every combination, off ones included; null on an item with a plain options list or one price. */
export interface ItemChoices {
  groupOne: ItemChoiceGroup;
  groupTwo: ItemChoiceGroup | null;
  combos: ItemChoiceCombo[];
}

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
  if (pricing.kind === 'ask') return pricing.fromCents === null || isPrice(pricing.fromCents) ? null : `A starting price is above RM0, up to ${formatRinggit(PRICE_MAX_CENTS)}. Or leave it empty.`;

  if (pricing.kind === 'choices') return choicesProblem(pricing);

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

function groupProblem(group: { name: string; choices: { label: string }[] }, which: string): string | null {
  const name = group.name.trim();
  if (name === '' || [...name].length > CHOICE_NAME_MAX) return `Name ${which}, up to ${CHOICE_NAME_MAX} characters.`;
  if (group.choices.length === 0) return `Add at least one choice to "${name}".`;
  if (group.choices.length > MAX_CHOICES) return `"${name}" holds at most ${MAX_CHOICES} choices.`;
  const seen = new Set<string>();
  for (const choice of group.choices) {
    const label = choice.label.trim();
    if (label === '' || [...label].length > CHOICE_LABEL_MAX) return `Give each choice in "${name}" a name, up to ${CHOICE_LABEL_MAX} characters.`;
    if (label.includes(CHOICE_SEPARATOR) || label.includes('·')) return `"${label}" cannot hold the "·" sign. Take it out.`;
    const key = label.toLowerCase();
    if (seen.has(key)) return `"${label}" is listed twice in "${name}". Give each choice its own name.`;
    seen.add(key);
  }
  return null;
}

/** Why this choices pricing cannot be stored, or null when it can: the groups, every combination exactly once, a price each, one on. */
function choicesProblem(pricing: ChoicesPricing): string | null {
  const { groupOne, groupTwo, combos } = pricing;
  const problem = groupProblem(groupOne, 'the first group') ?? (groupTwo ? groupProblem(groupTwo, 'the second group') : null);
  if (problem) return problem;
  const wantTwo = groupTwo ? groupTwo.choices.length : 0;
  const expected = groupOne.choices.length * (groupTwo ? wantTwo : 1);
  const seen = new Set<string>();
  for (const combo of combos) {
    const inRange =
      Number.isInteger(combo.one) &&
      combo.one >= 0 &&
      combo.one < groupOne.choices.length &&
      (groupTwo ? Number.isInteger(combo.two) && (combo.two as number) >= 0 && (combo.two as number) < wantTwo : combo.two === undefined);
    if (!inRange) return 'Give a price for every combination, each once.';
    seen.add(`${combo.one}:${combo.two ?? ''}`);
  }
  if (combos.length !== expected || seen.size !== expected) return 'Give a price for every combination, each once.';
  for (const combo of combos) {
    if (!isPrice(combo.priceCents)) return `"${comboLabelOf(pricing, combo)}": ${PRICE_SENTENCE}`;
  }
  if (!combos.some((combo) => combo.available)) return 'Keep at least one combination on sale.';
  return null;
}

function comboLabelOf(pricing: ChoicesPricing, combo: { one: number; two?: number }): string {
  const one = pricing.groupOne.choices[combo.one]?.label.trim() ?? '';
  const two = combo.two === undefined ? undefined : pricing.groupTwo?.choices[combo.two]?.label.trim();
  return two === undefined ? one : `${one}${CHOICE_SEPARATOR}${two}`;
}

/**
 * The options a choices pricing is stored as: every combination in group-one-major order, with its
 * label ("Chocolate · 1kg", or just the choice with one group) and position. Call after pricingProblem is null.
 */
export function choiceCombos(pricing: ChoicesPricing): { one: number; two: number | null; label: string; priceCents: number; available: boolean; position: number }[] {
  const byKey = new Map(pricing.combos.map((combo) => [`${combo.one}:${combo.two ?? ''}`, combo]));
  const out: ReturnType<typeof choiceCombos> = [];
  const twos = pricing.groupTwo ? pricing.groupTwo.choices.map((_, index) => index) : [null];
  for (let one = 0; one < pricing.groupOne.choices.length; one++) {
    for (const two of twos) {
      const combo = byKey.get(`${one}:${two ?? ''}`);
      if (!combo) continue;
      out.push({ one, two, label: comboLabelOf(pricing, { one, ...(two === null ? {} : { two }) }), priceCents: combo.priceCents, available: combo.available, position: out.length });
    }
  }
  return out;
}

/** The columns and relations an item is read with to know its choices; see itemChoicesOf. */
export interface ChoicesRow {
  choiceGroupOne: string | null;
  choiceGroupTwo: string | null;
  choices: { id: string; group: number; label: string; position: number; photoId: string | null; photo: { squareKey: string } | null }[];
  options: { id: string; label: string; priceCents: number; available: boolean; choiceOneId: string | null; choiceTwoId: string | null }[];
}

/** An item's choices as a reader gets them (choices in order, every combination, off ones included), or null on an item without choice groups. */
export function itemChoicesOf(row: ChoicesRow): ItemChoices | null {
  if (row.choiceGroupOne === null) return null;
  const group = (n: number, name: string): ItemChoiceGroup => ({
    name,
    choices: row.choices
      .filter((c) => c.group === n)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, label: c.label, photoId: c.photoId, photoKey: c.photo?.squareKey ?? null })),
  });
  return {
    groupOne: group(1, row.choiceGroupOne),
    groupTwo: row.choiceGroupTwo === null ? null : group(2, row.choiceGroupTwo),
    combos: row.options
      .filter((o) => o.choiceOneId !== null)
      .map((o) => ({ id: o.id, label: o.label, oneId: o.choiceOneId as string, twoId: o.choiceTwoId, priceCents: o.priceCents, available: o.available })),
  };
}

/** The lowest price among the combinations on sale, for "From RM45"; null when none is. */
export function lowestAvailablePrice(combos: { priceCents: number; available: boolean }[]): number | null {
  const on = combos.filter((combo) => combo.available).map((combo) => combo.priceCents);
  return on.length === 0 ? null : Math.min(...on);
}

/**
 * What the chat is told of an item's price. Plain options read as priceLine does; with choice groups
 * the groups are named first and the combinations are separated by "; " (their labels hold " · ").
 * Pass only the combinations on sale.
 */
export function catalogLine(item: PricedItem & { choiceGroups?: string[] }): string {
  const groups = item.choiceGroups ?? [];
  if (groups.length === 0 || item.options.length === 0) return priceLine(item);
  return `${groups.join(' / ')}: ${item.options.map((option) => `${option.label} ${formatRinggit(option.priceCents)}`).join('; ')}`;
}

/** RM95, RM95.50, RM1,234.56 -- the way a Malaysian price tag reads. */
export function formatRinggit(cents: number): string {
  return ringgit(cents);
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
  /** The owner connected their own CHIP account (Store -> Payment), so customers can pay online. */
  chipConnected: boolean;
  /** The shop has a physical item, switched on or not: something will have to be handed over. */
  physicalItems: boolean;
}

export type StoreGap = 'payment' | 'fulfilment';

/**
 * What stops this shop from opening. A customer will pay the moment they
 * order (slice 18), so a shop with no way to pay would take orders nobody can
 * pay for; and one with neither pickup nor delivery has no way to hand them over --
 * which matters only while it lists something physical: a shop of digital items alone
 * sends everything by email, and needs neither.
 */
export function storeGaps(s: StoreReadiness): StoreGap[] {
  const gaps: StoreGap[] = [];
  const bank = Boolean(s.bankName && s.bankAccountName && s.bankAccountNumber);
  if (!s.paymentQrKey && !bank && !s.chipConnected) gaps.push('payment');
  if (s.physicalItems && !s.pickupEnabled && s.deliveryMode === 'NONE') gaps.push('fulfilment');
  return gaps;
}

export function storeGapMessage(gaps: StoreGap[]): string {
  const parts = [
    ...(gaps.includes('payment') ? ['add a way to pay (connect CHIP, or add a DuitNow QR or your bank account)'] : []),
    ...(gaps.includes('fulfilment') ? ['turn on pickup or delivery'] : []),
  ];
  return `Before your shop can open, ${parts.join(' and ')}.`;
}
