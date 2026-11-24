import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ItemStats } from '@curios/db-read';
import { ItemsList, statLine } from './items-list.js';
import { PHYSICAL_ITEM, type EditorItem } from './store-types.js';

const base = { ...PHYSICAL_ITEM, slug: 'x', category: null, tag: null, sku: null, description: null, photoKey: null, photoUrl: null, options: [] };
const items: EditorItem[] = [
  { ...base, id: 'a', name: 'Kek coklat', priceCents: null, available: true, options: [{ id: 'o1', label: '1kg', priceCents: 9500 }, { id: 'o2', label: '2kg', priceCents: 17000 }] },
  { ...base, id: 'b', name: 'Kek batik', priceCents: 4500, available: true, category: 'Cakes' },
  { ...base, id: 'c', name: 'Burnt cheesecake', priceCents: 8500, available: false, photoUrl: 'https://files.example/c.webp' },
];

function show(list = items, stats: Record<string, ItemStats> = {}) {
  const props = { onMove: vi.fn(), onAvailable: vi.fn(), error: '' };
  const view = render(<ItemsList items={list} stats={stats} {...props} />);
  return { ...props, ...view };
}

/** The card an item is on: found by the link that opens it. */
const card = (name: string) => screen.getByRole('link', { name: `Edit ${name}` }).closest('li')!;

describe('ItemsList', () => {
  it('says what a digital item is sent by, after its price', () => {
    show([{ ...base, id: 'd', name: 'E-book', priceCents: 2500, available: true, kind: 'DIGITAL', delivery: 'FILES' }]);
    expect(card('E-book')).toHaveTextContent('RM25 · Digital, sent by email');
  });

  it('gives a session item its next time in place of "sent by email"', () => {
    const session: EditorItem = { ...base, id: 'k', name: 'Online class: Kek batik', priceCents: 6000, available: true, kind: 'DIGITAL', delivery: 'SESSION', sessionMinutes: 90 };
    show([session], { k: { sold: 0, enquiries: 0, seats: { startsAt: new Date('2026-11-07T12:00:00Z'), taken: 6, total: 12 } } });
    expect(card('Online class: Kek batik')).toHaveTextContent('RM60 · Sat 7 Nov, 8:00pm');
    expect(card('Online class: Kek batik')).toHaveTextContent('6 of 12 seats taken');
  });

  it("says an Ask item's starting price, or Price on request, never Needs a price", () => {
    show([
      { ...base, id: 'k', name: 'Custom birthday cake', priceCents: 18000, askForPrice: true, available: true },
      { ...base, id: 'w', name: 'Wedding cake', priceCents: null, askForPrice: true, available: true },
    ]);
    expect(card('Custom birthday cake')).toHaveTextContent('From RM180, ask for a price');
    expect(card('Wedding cake')).toHaveTextContent('Price on request');
    expect(screen.queryByText('Needs a price')).toBeNull();
  });

  it('counts the filters, and narrows to each', () => {
    show([...items, { ...base, id: 'd', name: 'E-book', priceCents: 2500, available: true, kind: 'DIGITAL', delivery: 'FILES' }]);
    const filters = within(screen.getByRole('group', { name: 'Show items' }));
    expect(filters.getByRole('button', { name: 'All 4' })).toHaveAttribute('aria-pressed', 'true');
    expect(filters.getByRole('button', { name: 'In your shop 3' })).toBeInTheDocument();
    expect(filters.getByRole('button', { name: 'Hidden 1' })).toBeInTheDocument();
    expect(filters.getByRole('button', { name: 'Digital 1' })).toBeInTheDocument();

    fireEvent.click(filters.getByRole('button', { name: 'Hidden 1' }));
    expect(screen.queryByRole('link', { name: 'Edit Kek batik' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Edit Burnt cheesecake' })).toBeInTheDocument();

    fireEvent.click(filters.getByRole('button', { name: 'Digital 1' }));
    expect(screen.getAllByRole('link', { name: /^Edit / })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Edit E-book' })).toBeInTheDocument();
  });

  it('searches the name and the category, and says when nothing matches', () => {
    show();
    const box = screen.getByRole('searchbox', { name: 'Search your items' });
    fireEvent.change(box, { target: { value: 'cakes' } });
    expect(screen.getAllByRole('link', { name: /^Edit / }).map((a) => a.getAttribute('aria-label'))).toEqual(['Edit Kek batik']);

    fireEvent.change(box, { target: { value: 'cheese' } });
    expect(screen.getByRole('link', { name: 'Edit Burnt cheesecake' })).toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByText(/No items match\. Try another word, or/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'add an item' })).toHaveAttribute('href', '/app/store/items/new');
  });

  it('says what an empty filter means', () => {
    show([items[0]!]);
    fireEvent.click(screen.getByRole('button', { name: 'Hidden 0' }));
    expect(screen.getByText('Nothing is hidden. Every item is in your shop.')).toBeInTheDocument();
  });

  it('shows each item with what customers see for its price, and whether it is in the shop', () => {
    show();
    expect(card('Kek coklat')).toHaveTextContent('1kg RM95 · 2kg RM170');
    expect(within(card('Kek coklat')).getByRole('switch', { name: 'Show Kek coklat in your shop' })).toHaveAttribute('aria-checked', 'true');
    expect(card('Burnt cheesecake')).toHaveTextContent('Hidden from your shop');
    expect(card('Burnt cheesecake')).toHaveAttribute('data-hidden');
  });

  it('shows a photo, or the first letter where there is none', () => {
    const { container } = show();
    expect(container.querySelector('img[src="https://files.example/c.webp"]')).not.toBeNull();
    expect(within(card('Kek batik')).getByText('K')).toBeInTheDocument();
  });

  it('opens an item on its own address, and offers a new one', () => {
    show();
    expect(screen.getByRole('link', { name: 'Edit Kek batik' })).toHaveAttribute('href', '/app/store/items/b');
    expect(screen.getByRole('link', { name: '+ Add an item' })).toHaveAttribute('href', '/app/store/items/new');
  });

  it('hands up a switch, and moves an item from its menu, past the neighbour it has', () => {
    const props = show();
    fireEvent.click(screen.getByRole('switch', { name: 'Show Kek batik in your shop' }));
    expect(props.onAvailable).toHaveBeenCalledWith('b', false);

    fireEvent.click(screen.getByRole('button', { name: 'More for Kek batik' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move earlier' }));
    expect(props.onMove).toHaveBeenCalledWith(1, 0);

    fireEvent.click(screen.getByRole('button', { name: 'More for Kek batik' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move later' }));
    expect(props.onMove).toHaveBeenLastCalledWith(1, 2);
  });

  it('moves past the next card that is shown, not one a filter hides', () => {
    const props = show([
      items[0]!,
      { ...items[2]!, id: 'h', name: 'Hidden one' },
      items[1]!,
    ]);
    fireEvent.click(within(screen.getByRole('group', { name: 'Show items' })).getByRole('button', { name: 'In your shop 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'More for Kek coklat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move later' }));
    // Kek coklat is at 0 and Kek batik at 2: the hidden item between them is not in the way.
    expect(props.onMove).toHaveBeenCalledWith(0, 2);
  });

  it('keeps the focus on the moved card menu button, wherever the card goes', () => {
    function Harness() {
      const [list, setList] = useState(items);
      return (
        <ItemsList
          items={list}
          stats={{}}
          error=""
          onAvailable={() => undefined}
          onMove={(from, to) => setList((was) => { const next = [...was]; next.splice(to, 0, next.splice(from, 1)[0]!); return next; })}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'More for Kek batik' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move earlier' }));
    expect(screen.getAllByRole('link', { name: /^Edit / })[0]).toHaveAttribute('aria-label', 'Edit Kek batik');
    expect(screen.getByRole('button', { name: 'More for Kek batik' })).toHaveFocus();
  });

  it('reads a session next time from the item itself when the store read gave none', () => {
    const session: EditorItem = {
      ...base, id: 'k', name: 'Class', priceCents: 6000, available: true, kind: 'DIGITAL', delivery: 'SESSION', sessionMinutes: 90,
      sessions: [{ id: 's', startsAt: new Date('2099-11-07T12:00:00Z'), seats: 12, booked: 6, seatsLeft: 6 }],
    };
    show([session]);
    expect(card('Class')).toHaveTextContent('Sat 7 Nov, 8:00pm');
    expect(card('Class')).toHaveTextContent('6 of 12 seats taken');
  });

  it('shows only hidden items when asked from outside', () => {
    const view = render(<ItemsList items={items} stats={{}} error="" onMove={vi.fn()} onAvailable={vi.fn()} showFilter={null} />);
    view.rerender(<ItemsList items={items} stats={{}} error="" onMove={vi.fn()} onAvailable={vi.fn()} showFilter={{ filter: 'off', n: 1 }} />);
    expect(screen.getAllByRole('link', { name: /^Edit / })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Edit Burnt cheesecake' })).toBeInTheDocument();
  });

  it('cannot move the first item earlier or the last item later', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'More for Kek coklat' }));
    expect(screen.getByRole('button', { name: 'Move earlier' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'More for Burnt cheesecake' }));
    expect(screen.getByRole('button', { name: 'Move later' })).toBeDisabled();
  });

  it('invites the first item on an empty shelf', () => {
    show([]);
    expect(screen.getByRole('heading', { name: 'Your shelf is empty' })).toBeInTheDocument();
    expect(screen.getByText(/It shows in your shop, and the chat/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ Add your first item' })).toHaveAttribute('href', '/app/store/items/new');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('stops offering to add at the limit', () => {
    show(Array.from({ length: 60 }, (_u, i) => ({ ...items[1]!, id: `${i}`, name: `Item ${i}` })));
    expect(screen.queryByRole('link', { name: '+ Add an item' })).toBeNull();
    expect(screen.getByText(/items is the most a shop holds/)).toBeInTheDocument();
  });

  it('shows what an item has done lately, as the board words it, and nothing for a 0', () => {
    show(items, {
      a: { sold: 12, enquiries: 0, seats: null },
      b: { sold: 0, enquiries: 0, seats: null },
      c: { sold: 3, enquiries: 0, seats: null },
    });
    expect(card('Kek coklat')).toHaveTextContent('12 sold in 30 days');
    expect(card('Kek batik')).not.toHaveTextContent(/sold|enquir|seats/);
    // A hidden item says it is hidden, not what it sold.
    expect(card('Burnt cheesecake')).not.toHaveTextContent('sold');
  });
});

describe('statLine', () => {
  const none: ItemStats = { sold: 0, enquiries: 0, seats: null };
  it('says sold, enquiries or seats, whichever the item has, and nothing when it has none', () => {
    expect(statLine(undefined)).toBeNull();
    expect(statLine(none)).toBeNull();
    expect(statLine({ ...none, sold: 12 })).toBe('12 sold in 30 days');
    expect(statLine({ ...none, enquiries: 4 })).toBe('4 enquiries in 30 days');
    expect(statLine({ ...none, enquiries: 1 })).toBe('1 enquiry in 30 days');
    expect(statLine({ ...none, seats: { startsAt: new Date(), taken: 6, total: 12 } })).toBe('6 of 12 seats taken');
    // A session with no seat taken still says how many it holds: the capacity is data, a 0 of sales is not.
    expect(statLine({ ...none, seats: { startsAt: new Date(), taken: 0, total: 12 } })).toBe('0 of 12 seats taken');
  });
});
