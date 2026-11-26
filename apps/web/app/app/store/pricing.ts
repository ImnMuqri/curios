import { choiceCombos, CHOICE_SEPARATOR, lowestAvailablePrice, ITEM_CATEGORY_MAX, ITEM_DESCRIPTION_MAX, ITEM_NAME_MAX, ITEM_SKU_MAX, ITEM_TAG_MAX, formatRinggit, parseRinggit, priceLine, pricingProblem, type ChoicesPricing, type ItemChoices, type Pricing } from '@curios/core/store';

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
export const SKU_SENTENCE = `An item code is up to ${ITEM_SKU_MAX} characters.`;

/** 9500 -> "95", 9550 -> "95.50": a price as the owner would type it. */
export function centsText(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** An Ask item's starting price that is not a number of ringgit (the Dash board's words). */
export const FROM_PARSE_SENTENCE = 'That starting price does not look right. Use ringgit, like 180, or leave it empty.';

export type OptionDraft = { key: number; label: string; price: string };
/**
 * `ask` is "How they order: Ask for a price" (HANDOFF "Shop: Ask items", 8 Nov 2026); absent or
 * false is Add to basket. An Ask item's starting price is typed in `price`, the box the one price
 * uses, as the board shares it; `kind` and `options` wait there for a switch back to the basket.
 */
export type PricingDraft = { kind: 'single' | 'options'; ask?: boolean; price: string; options: OptionDraft[]; choices?: ChoicesDraft | null };

/** A choice inside a group ("Chocolate", "1kg"). `photoId` is one of the item's own photos, group one only. */
export type ChoiceDraft = { key: number; label: string; photoId: string | null };
/** One combination's price as typed, and whether it is on sale. */
export type CellDraft = { price: string; available: boolean };
/**
 * Options in one or two named groups. `cells` holds a price per combination, keyed by `cellKey`;
 * with `same` on (two groups only) the price is held once per group-two choice, under '*', and fills every group-one choice.
 */
export type ChoicesDraft = { nameOne: string; one: ChoiceDraft[]; nameTwo: string; two: ChoiceDraft[] | null; same: boolean; cells: Record<string, CellDraft> };

let nextKey = 1;
export const blankOption = (): OptionDraft => ({ key: nextKey++, label: '', price: '' });

export const blankChoice = (): ChoiceDraft => ({ key: nextKey++, label: '', photoId: null });
export const cellKey = (one: number | '*', two: number | null) => `${one}:${two ?? ''}`;
const BLANK_CELL: CellDraft = { price: '', available: true };

/** The combination's cell: in "same price" mode every group-one choice reads the shared one. */
export function cellOf(c: ChoicesDraft, oneKey: number, twoKey: number | null): CellDraft {
  const own = c.cells[cellKey(oneKey, twoKey)];
  if (!c.same || !c.two) return own ?? BLANK_CELL;
  // Shared mode: the price is the shared one; on or off stays per combination.
  return { price: c.cells[cellKey('*', twoKey)]?.price ?? own?.price ?? '', available: own?.available ?? true };
}

/** What the owner's editor holds for an item's stored choices. */
export function choicesDraftOf(choices: ItemChoices): ChoicesDraft {
  const one = choices.groupOne.choices.map((choice) => ({ key: nextKey++, label: choice.label, photoId: choice.photoId }));
  const two = choices.groupTwo ? choices.groupTwo.choices.map((choice) => ({ key: nextKey++, label: choice.label, photoId: null })) : null;
  const cells: Record<string, CellDraft> = {};
  for (const combo of choices.combos) {
    const oneAt = choices.groupOne.choices.findIndex((choice) => choice.id === combo.oneId);
    const twoAt = combo.twoId && choices.groupTwo ? choices.groupTwo.choices.findIndex((choice) => choice.id === combo.twoId) : -1;
    const o = one[oneAt];
    if (!o) continue;
    cells[cellKey(o.key, twoAt >= 0 && two ? (two[twoAt]?.key ?? null) : null)] = { price: centsText(combo.priceCents), available: combo.available };
  }
  return { nameOne: choices.groupOne.name, one, nameTwo: choices.groupTwo?.name ?? '', two, same: false, cells };
}

/** "Add a choice group": the plain options become group one's choices, with their prices, and a second group starts empty. */
export function startChoices(options: OptionDraft[]): ChoicesDraft {
  const one = options.map((option) => ({ key: nextKey++, label: option.label, photoId: null }));
  const two = [blankChoice()];
  const cells: Record<string, CellDraft> = {};
  one.forEach((choice, i) => {
    cells[cellKey(choice.key, two[0]!.key)] = { price: options[i]?.price ?? '', available: true };
  });
  return { nameOne: '', one, nameTwo: '', two, same: false, cells };
}

/** Group two goes: each group-one choice keeps the price it had in the first group-two column. */
export function dropGroupTwo(c: ChoicesDraft): ChoicesDraft {
  const first = c.two?.[0] ?? null;
  const cells: Record<string, CellDraft> = {};
  for (const choice of c.one) cells[cellKey(choice.key, null)] = first ? cellOf(c, choice.key, first.key) : BLANK_CELL;
  return { ...c, two: null, nameTwo: '', same: false, cells };
}

/** A second group starts with one empty choice; what each group-one choice cost carries into it. */
export function addGroupTwo(c: ChoicesDraft): ChoicesDraft {
  const two = [blankChoice()];
  const cells: Record<string, CellDraft> = {};
  for (const choice of c.one) cells[cellKey(choice.key, two[0]!.key)] = c.cells[cellKey(choice.key, null)] ?? BLANK_CELL;
  return { ...c, two, nameTwo: '', same: false, cells };
}

/**
 * "Same price for every ..." on or off. On seeds the shared prices from the first row and touches nothing else (on or off stays
 * per combination). Off gives every row back its own price, unless the shared price was changed while ticked: then that price is kept for the column.
 */
export function setSame(c: ChoicesDraft, same: boolean): ChoicesDraft {
  if (!c.two || same === c.same) return c;
  const cells = { ...c.cells };
  if (same) {
    const first = c.one[0];
    for (const t of c.two) cells[cellKey('*', t.key)] = { price: first ? (c.cells[cellKey(first.key, t.key)]?.price ?? '') : '', available: true };
  } else {
    const first = c.one[0];
    for (const t of c.two) {
      const shared = c.cells[cellKey('*', t.key)]?.price ?? '';
      // The shared price still being what the tick set (the first row's own) means it was not touched: every row gets its own back.
      const untouched = !first || shared === (c.cells[cellKey(first.key, t.key)]?.price ?? '');
      for (const o of c.one) {
        const own = c.cells[cellKey(o.key, t.key)];
        cells[cellKey(o.key, t.key)] = { price: untouched && own?.price.trim() ? own.price : shared, available: own?.available ?? true };
      }
    }
  }
  return { ...c, same, cells };
}

/**
 * Back to a plain list: each combination on sale becomes an option named like the combination
 * ("Chocolate · 1kg") with its price. Combinations switched off are left out (all of them are kept when none is on).
 */
export function choicesToOptions(c: ChoicesDraft): OptionDraft[] {
  const all: { label: string; price: string; available: boolean }[] = [];
  for (const o of c.one) {
    for (const t of c.two ?? [null]) {
      const cell = cellOf(c, o.key, t?.key ?? null);
      all.push({ label: t ? `${o.label.trim()}${CHOICE_SEPARATOR}${t.label.trim()}` : o.label.trim(), price: cell.price, available: cell.available });
    }
  }
  const on = all.filter((combo) => combo.available);
  const kept = on.length > 0 ? on : all;
  return kept.length > 0 ? kept.map((combo) => ({ key: nextKey++, label: combo.label, price: combo.price })) : [blankOption()];
}

/** The choices as the API takes them, or the sentence the owner should read. `photoIds` are the item's own photos: a pick that is not one of them is dropped. */
export function choicesPricingOf(c: ChoicesDraft, photoIds?: string[]): { pricing: ChoicesPricing } | { error: string } {
  const combos: ChoicesPricing['combos'] = [];
  c.one.forEach((o, one) => {
    (c.two ?? [null]).forEach((t, two) => {
      const cell = cellOf(c, o.key, t?.key ?? null);
      const cents = parseRinggit(cell.price);
      if (cents === null) return;
      combos.push({ one, ...(t ? { two } : {}), priceCents: cents, available: cell.available });
    });
  });
  const expected = c.one.length * (c.two ? c.two.length : 1);
  if (combos.length < expected) return { error: PRICE_PARSE_SENTENCE };
  const pricing: ChoicesPricing = {
    kind: 'choices',
    groupOne: {
      name: c.nameOne.trim(),
      choices: c.one.map((o) => ({ label: o.label.trim(), ...(o.photoId && (!photoIds || photoIds.includes(o.photoId)) ? { photoId: o.photoId } : {}) })),
    },
    ...(c.two ? { groupTwo: { name: c.nameTwo.trim(), choices: c.two.map((t) => ({ label: t.label.trim() })) } } : {}),
    combos,
  };
  const problem = pricingProblem(pricing);
  return problem ? { error: problem } : { pricing };
}

export function draftOf(item: { priceCents: number | null; askForPrice?: boolean; options: { label: string; priceCents: number }[]; choices?: ItemChoices | null } | null): PricingDraft {
  if (item?.choices && !item.askForPrice) {
    return { kind: 'options', price: '', options: [blankOption()], choices: choicesDraftOf(item.choices) };
  }
  if (item?.askForPrice) {
    return { kind: 'single', ask: true, price: item.priceCents != null ? centsText(item.priceCents) : '', options: [blankOption()] };
  }
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
export function pricingOf(draft: PricingDraft, photoIds?: string[]): { pricing: Pricing } | { error: string } {
  let pricing: Pricing;
  if (draft.ask) {
    // No starting price is a choice ("Price on request"), not a mistake.
    const typed = draft.price.trim();
    const cents = typed === '' ? null : parseRinggit(typed);
    if (typed !== '' && cents === null) return { error: FROM_PARSE_SENTENCE };
    pricing = { kind: 'ask', fromCents: cents };
  } else if (draft.kind === 'single') {
    const cents = parseRinggit(draft.price);
    if (cents === null) return { error: PRICE_PARSE_SENTENCE };
    pricing = { kind: 'single', priceCents: cents };
  } else if (draft.choices) {
    const checked = choicesPricingOf(draft.choices, photoIds);
    if ('error' in checked) return checked;
    pricing = checked.pricing;
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

export type CheckedItem = { name: string; description: string | null; category: string | null; tag: string | null; sku: string | null; pricing: Pricing };

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Name, description, category, tag, item code and pricing, checked in the order the owner reads them. */
export function checkFields(
  name: string,
  description: string,
  draft: PricingDraft,
  extras: { category: string; tag: string; sku?: string; photoIds?: string[] } = { category: '', tag: '' },
): CheckedItem | { error: string } {
  const trimmed = name.trim();
  if (trimmed === '' || [...trimmed].length > ITEM_NAME_MAX) return { error: NAME_SENTENCE };
  // The server trims before it counts, so a description that fits once trimmed is not refused for its spaces.
  if ([...description.trim()].length > ITEM_DESCRIPTION_MAX) return { error: DESCRIPTION_SENTENCE };
  const category = tidy(extras.category);
  if ([...category].length > ITEM_CATEGORY_MAX) return { error: CATEGORY_SENTENCE };
  const tag = tidy(extras.tag);
  if ([...tag].length > ITEM_TAG_MAX) return { error: TAG_SENTENCE };
  const sku = (extras.sku ?? '').trim();
  if ([...sku].length > ITEM_SKU_MAX) return { error: SKU_SENTENCE };
  const priced = pricingOf(draft, extras.photoIds);
  if ('error' in priced) return priced;
  return { name: trimmed, description: description.trim() || null, category: category || null, tag: tag || null, sku: sku || null, pricing: priced.pricing };
}

/** The price fields of an item as the API and the shop hold them. */
export function pricedFields(pricing: Pricing): { priceCents: number | null; askForPrice: boolean; options: { label: string; priceCents: number }[] } {
  if (pricing.kind === 'single') return { priceCents: pricing.priceCents, askForPrice: false, options: [] };
  if (pricing.kind === 'ask') return { priceCents: pricing.fromCents, askForPrice: true, options: [] };
  if (pricing.kind === 'choices') return { priceCents: null, askForPrice: false, options: choiceCombos(pricing).filter((combo) => combo.available).map(({ label, priceCents }) => ({ label, priceCents })) };
  return { priceCents: null, askForPrice: false, options: pricing.options };
}

/**
 * The price as the owner's screens say it (the deleted Store board's `pricing().line`): an Ask item's
 * "From RM180, ask for a price" or "Price on request", else core's line ("RM25", "1kg RM95 · 2kg RM170").
 */
export function ownerPriceLine(item: { priceCents: number | null; askForPrice?: boolean; options: { label: string; priceCents: number }[]; choices?: ItemChoices | null }): string {
  // Choice groups: "From RM45", the lowest combination on sale. Switched-off ones never count.
  if (item.choices) {
    const lowest = lowestAvailablePrice(item.choices.combos);
    return lowest === null ? '' : `From ${formatRinggit(lowest)}`;
  }
  if (item.askForPrice) return item.priceCents === null ? 'Price on request' : `From ${formatRinggit(item.priceCents)}, ask for a price`;
  return priceLine(item);
}

/** The line under the price: "From RM45" for choices (the lowest on sale), else the usual price line. */
export function ownerPricingLine(pricing: Pricing): string {
  if (pricing.kind === 'choices') {
    const lowest = lowestAvailablePrice(choiceCombos(pricing));
    return lowest === null ? '' : `From ${formatRinggit(lowest)}`;
  }
  return ownerPriceLine(pricedFields(pricing));
}

/** The choices of an item being edited, as the preview reads them: ids only tell them apart, photo keys come from the item's photos. */
export function previewChoicesOf(pricing: ChoicesPricing, photos: { id: string; squareKey: string }[]): ItemChoices {
  const group = (name: string, choices: { label: string; photoId?: string | null }[], tag: string) => ({
    name,
    choices: choices.map((choice, i) => {
      const photo = photos.find((p) => p.id === choice.photoId);
      return { id: `draft-${tag}${i}`, label: choice.label, photoId: photo?.id ?? null, photoKey: photo?.squareKey ?? null };
    }),
  });
  return {
    groupOne: group(pricing.groupOne.name, pricing.groupOne.choices, 'a'),
    groupTwo: pricing.groupTwo ? group(pricing.groupTwo.name, pricing.groupTwo.choices, 'b') : null,
    combos: choiceCombos(pricing).map((combo) => ({
      id: `draft-${combo.position}`,
      label: combo.label,
      oneId: `draft-a${combo.one}`,
      twoId: combo.two === null ? null : `draft-b${combo.two}`,
      priceCents: combo.priceCents,
      available: combo.available,
    })),
  };
}
