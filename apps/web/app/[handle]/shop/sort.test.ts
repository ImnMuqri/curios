import { describe, expect, it } from 'vitest';
import { sortItems } from './sort.js';

const item = (id: string, createdAt: string | undefined, priceCents: number | null, options: number[] = []) => ({
  id,
  createdAt,
  priceCents,
  options: options.map((p, i) => ({ id: `${id}${i}`, label: `o${i}`, priceCents: p })),
});

// The owner's order: a, b, c, d.
const items = [
  item('a', '2026-11-01T00:00:00Z', 3000),
  item('b', '2026-11-20T00:00:00Z', null, [5000, 1500]), // options: from RM15
  item('c', '2026-11-10T00:00:00Z', null), // Price on request
  item('d', '2026-11-05T00:00:00Z', 9000),
];
const ids = (list: { id: string }[]) => list.map((i) => i.id).join('');

describe('sortItems', () => {
  it("keeps the owner's order by default", () => {
    expect(ids(sortItems(items, 'shop'))).toBe('abcd');
  });

  it('orders by date, newest or oldest first', () => {
    expect(ids(sortItems(items, 'latest'))).toBe('bcda');
    expect(ids(sortItems(items, 'earliest'))).toBe('adcb');
  });

  it('orders by the lowest on-sale price, with no-price items last either way', () => {
    expect(ids(sortItems(items, 'low'))).toBe('badc');
    expect(ids(sortItems(items, 'high'))).toBe('dabc');
  });

  it("keeps the owner's order for ties and for items with no date", () => {
    const tied = [item('x', undefined, 1000), item('y', undefined, 1000), item('z', '2026-11-02T00:00:00Z', 1000)];
    expect(ids(sortItems(tied, 'latest'))).toBe('xyz');
    expect(ids(sortItems(tied, 'low'))).toBe('xyz');
  });

  it('does not change the list it was given', () => {
    const copy = [...items];
    sortItems(items, 'high');
    expect(items).toEqual(copy);
  });
});
