import { fromPrice, type PricedItem } from '@curios/core/store';

/** How a visitor can order the shop (owner, 26 Nov): the owner's own order first, as it always was. */
export const SHOP_SORTS = ['shop', 'latest', 'earliest', 'low', 'high'] as const;
export type ShopSort = (typeof SHOP_SORTS)[number];

type Sortable = PricedItem & { createdAt?: string; askForPrice?: boolean };

/** An item's price to sort by: its lowest on-sale price, or null for one with none (Price on request). */
function sortPrice(item: Sortable): number | null {
  return fromPrice(item);
}

/**
 * The shop's items in the visitor's chosen order. Stable: ties (and items with no date or no price) keep the
 * owner's order. In the price sorts an item with no price goes last either way, never first.
 */
export function sortItems<T extends Sortable>(items: readonly T[], sort: ShopSort): T[] {
  const indexed = items.map((item, index) => ({ item, index }));
  const byIndex = (a: { index: number }, b: { index: number }) => a.index - b.index;
  if (sort === 'latest' || sort === 'earliest') {
    const sign = sort === 'latest' ? -1 : 1;
    indexed.sort((a, b) => {
      const at = a.item.createdAt ? Date.parse(a.item.createdAt) : NaN;
      const bt = b.item.createdAt ? Date.parse(b.item.createdAt) : NaN;
      if (Number.isNaN(at) || Number.isNaN(bt) || at === bt) return byIndex(a, b);
      return sign * (at - bt);
    });
  } else if (sort === 'low' || sort === 'high') {
    const sign = sort === 'low' ? 1 : -1;
    indexed.sort((a, b) => {
      const ap = sortPrice(a.item);
      const bp = sortPrice(b.item);
      if (ap === null && bp === null) return byIndex(a, b);
      if (ap === null) return 1;
      if (bp === null) return -1;
      return ap === bp ? byIndex(a, b) : sign * (ap - bp);
    });
  }
  return indexed.map(({ item }) => item);
}
