import { describe, expect, it } from 'vitest';
import { PICKUP_NOTE_MAX, pickupLine, windowLabel, windowProblem } from './pickup';

describe('windowLabel', () => {
  it('writes minutes only when not :00', () => {
    expect(windowLabel(600, 720)).toBe('10am–12pm');
    expect(windowLabel(570, 660)).toBe('9:30am–11am');
    expect(windowLabel(720, 780)).toBe('12pm–1pm');
    expect(windowLabel(0, 1440)).toBe('12am–12am');
  });
});

describe('windowProblem', () => {
  it('says which two overlap, in sorted order', () => {
    const overlap = 'Two pickup times overlap: 10am–12pm and 11:40am–1:20pm.';
    expect(
      windowProblem([
        { from: 600, to: 720, limit: null },
        { from: 700, to: 800, limit: 5 },
      ]),
    ).toBe(overlap);
    expect(
      windowProblem([
        { from: 700, to: 800, limit: 5 },
        { from: 600, to: 720, limit: null },
      ]),
    ).toBe(overlap);
  });

  it('allows windows that touch', () => {
    expect(
      windowProblem([
        { from: 600, to: 720, limit: null },
        { from: 720, to: 800, limit: null },
      ]),
    ).toBeNull();
  });

  it('rejects a window that ends before it starts, or leaves the day', () => {
    const problem = 'A pickup time has to end after it starts.';
    expect(windowProblem([{ from: 720, to: 600, limit: null }])).toBe(problem);
    expect(windowProblem([{ from: 600, to: 1441, limit: null }])).toBe(problem);
  });

  it('keeps a limit to 1 to 999, or none', () => {
    for (const limit of [0, 1000, 1.5]) {
      expect(windowProblem([{ from: 600, to: 720, limit }])).toBe(
        'A limit is 1 to 999 orders, or none.',
      );
    }
    expect(windowProblem([{ from: 600, to: 720, limit: 999 }])).toBeNull();
    expect(windowProblem([{ from: 600, to: 720, limit: null }])).toBeNull();
  });
});

describe('pickupLine', () => {
  const base = {
    dayLabel: 'Sat 5 Dec',
    pickupFrom: null,
    pickupTo: null,
    pickupPlaceName: null,
  };

  it('joins the parts that are there', () => {
    expect(
      pickupLine({
        ...base,
        method: 'PICKUP',
        pickupFrom: 600,
        pickupTo: 720,
        pickupPlaceName: 'Home, Seksyen 7',
      }),
    ).toBe('Pickup · Sat 5 Dec, 10am–12pm · Home, Seksyen 7');
    expect(pickupLine({ ...base, method: 'PICKUP' })).toBe('Pickup · Sat 5 Dec');
  });

  it('takes the word for pickup in the page’s language', () => {
    expect(pickupLine({ ...base, method: 'PICKUP', pickupFrom: 600, pickupTo: 720, label: 'Ambil sendiri' })).toBe('Ambil sendiri · Sat 5 Dec, 10am–12pm');
  });

  it('is null for delivery', () => {
    expect(pickupLine({ ...base, method: 'DELIVERY' })).toBeNull();
    expect(pickupLine({ ...base, method: null })).toBeNull();
  });

  it('re-exports the note limit from store', () => {
    expect(PICKUP_NOTE_MAX).toBe(120);
  });
});
