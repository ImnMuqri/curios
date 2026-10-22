import { ITEM_CATEGORY_MAX, ITEM_DESCRIPTION_MAX, ITEM_NAME_MAX, ITEM_TAG_MAX, parseRinggit, pricingProblem, type Pricing } from '@curios/core/store';

/**
 * An item's fields as the owner types them, and the checks that turn them
 * into what the API takes -- in the order the owner reads them, so the first
 * thing wrong is the thing said.
 */

export const PRICE_PARSE_SENTENCE = 'That price does not look right. Use ringgit and sen, like 95 or 95.50.';
export const NAME_SENTENCE = `Give the item a name, up to ${ITEM_NAME_MAX} characters.`;
export const DESCRIPTION_SENTENCE = `A description is up to ${ITEM_DESCRIPTION_MAX} characters.`;
export const CATEGORY_SENTENCE = `A category is up to ${ITEM_CATEGORY_MAX} characters.`;
export const TAG_SENTENCE = `A tag is up to ${ITEM_TAG_MAX} characters. Try a shorter word, like New.`;

/** 9500 -> "95", 9550 -> "95.50": a price as the owner would type it. */
export function centsText(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export type OptionDraft = { key: number; label: string; price: string };
export type PricingDraft = { kind: 'single' | 'options'; price: string; options: OptionDraft[] };

let nextKey = 1;
export const blankOption = (): OptionDraft => ({ key: nextKey++, label: '', price: '' });

export function draftOf(item: { priceCents: number | null; options: { label: string; priceCents: number }[] } | null): PricingDraft {
  if (item && item.options.length > 0) {
    return {
      kind: 'options',
      price: '',
      options: item.options.map((o) => ({ key: nextKey++, label: o.label, price: centsText(o.priceCents) })),
    };
  }
  return { kind: 'single', price: item?.priceCents != null ? centsText(item.priceCents) : '', options: [blankOption()] };
}

/** The pricing to send, or the sentence the owner should read instead. */
export function pricingOf(draft: PricingDraft): { pricing: Pricing } | { error: string } {
  let pricing: Pricing;
  if (draft.kind === 'single') {
    const cents = parseRinggit(draft.price);
    if (cents === null) return { error: PRICE_PARSE_SENTENCE };
    pricing = { kind: 'single', priceCents: cents };
  } else {
    const options: { label: string; priceCents: number }[] = [];
    for (const option of draft.options) {
      const cents = parseRinggit(option.price);
      if (cents === null) return { error: PRICE_PARSE_SENTENCE };
      options.push({ label: option.label.trim(), priceCents: cents });
    }
    pricing = { kind: 'options', options };
  }
  const problem = pricingProblem(pricing);
  return problem ? { error: problem } : { pricing };
}

export type CheckedItem = { name: string; description: string | null; category: string | null; tag: string | null; pricing: Pricing };

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Name, description, category, tag and pricing, checked in the order the owner reads them. */
export function checkFields(
  name: string,
  description: string,
  draft: PricingDraft,
  extras: { category: string; tag: string } = { category: '', tag: '' },
): CheckedItem | { error: string } {
  const trimmed = name.trim();
  if (trimmed === '' || [...trimmed].length > ITEM_NAME_MAX) return { error: NAME_SENTENCE };
  // The server trims before it counts, so a description that fits once trimmed is not refused for its spaces.
  if ([...description.trim()].length > ITEM_DESCRIPTION_MAX) return { error: DESCRIPTION_SENTENCE };
  const category = tidy(extras.category);
  if ([...category].length > ITEM_CATEGORY_MAX) return { error: CATEGORY_SENTENCE };
  const tag = tidy(extras.tag);
  if ([...tag].length > ITEM_TAG_MAX) return { error: TAG_SENTENCE };
  const priced = pricingOf(draft);
  if ('error' in priced) return priced;
  return { name: trimmed, description: description.trim() || null, category: category || null, tag: tag || null, pricing: priced.pricing };
}

/** The price fields of an item as the API and the shop hold them. */
export function pricedFields(pricing: Pricing): { priceCents: number | null; options: { label: string; priceCents: number }[] } {
  return pricing.kind === 'single' ? { priceCents: pricing.priceCents, options: [] } : { priceCents: null, options: pricing.options };
}
