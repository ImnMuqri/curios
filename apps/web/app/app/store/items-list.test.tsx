import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ItemsList } from './items-list.js';
import { PHYSICAL_ITEM, type EditorItem } from './store-types.js';

const base = { ...PHYSICAL_ITEM, slug: 'x', category: null, tag: null, sku: null, description: null, photoKey: null, photoUrl: null, options: [] };
const items: EditorItem[] = [
  { ...base, id: 'a', name: 'Kek coklat', priceCents: null, available: true, options: [{ id: 'o1', label: '1kg', priceCents: 9500 }, { id: 'o2', label: '2kg', priceCents: 17000 }] },
  { ...base, id: 'b', name: 'Kek batik', priceCents: 4500, available: true },
  { ...base, id: 'c', name: 'Burnt cheesecake', priceCents: 8500, available: false, photoUrl: 'https://files.example/c.webp' },
];

function show(list = items) {
  const props = { onMove: vi.fn(), onAvailable: vi.fn(), onEdit: vi.fn(), onAdd: vi.fn(), error: '' };
  const view = render(<ItemsList items={list} {...props} />);
  return { ...props, ...view };
}

describe('ItemsList', () => {
  it('says Digital before the price of a digital item', () => {
    show([{ ...base, id: 'd', name: 'E-book', priceCents: 2500, available: true, kind: 'DIGITAL', delivery: 'FILES' }]);
    expect(screen.getByRole('listitem', { name: 'E-book' })).toHaveTextContent('Digital · RM25');
  });

  it('counts the items and how many are in the shop', () => {
    show();
    expect(screen.getByText('3 items · 2 in your shop')).toBeInTheDocument();
  });

  it('shows each item with what customers see for its price, and whether it is in the shop', () => {
    show();
    const coklat = screen.getByRole('listitem', { name: 'Kek coklat' });
    expect(coklat).toHaveTextContent('1kg RM95 · 2kg RM170');
    expect(within(coklat).getByRole('switch', { name: 'In your shop: Kek coklat' })).toHaveAttribute('aria-checked', 'true');
    const cheesecake = screen.getByRole('listitem', { name: 'Burnt cheesecake' });
    expect(cheesecake).toHaveTextContent('Hidden');
    expect(cheesecake).toHaveAttribute('data-hidden');
  });

  it('shows a photo, or the first letter where there is none', () => {
    const { container } = show();
    expect(container.querySelector('img[src="https://files.example/c.webp"]')).not.toBeNull();
    expect(within(screen.getByRole('listitem', { name: 'Kek batik' })).getByText('K')).toBeInTheDocument();
  });

  it('hands up a switch, a move and an edit', () => {
    const props = show();
    fireEvent.click(screen.getByRole('switch', { name: 'In your shop: Kek batik' }));
    expect(props.onAvailable).toHaveBeenCalledWith('b', false);
    fireEvent.click(screen.getByRole('button', { name: 'Move Kek batik up' }));
    expect(props.onMove).toHaveBeenCalledWith(1, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kek batik' }));
    expect(props.onEdit).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('button', { name: /^Kek coklat/ }));
    expect(props.onEdit).toHaveBeenLastCalledWith('a');
  });

  it('cannot move the first item up or the last item down', () => {
    show();
    expect(screen.getByRole('button', { name: 'Move Kek coklat up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Burnt cheesecake down' })).toBeDisabled();
  });

  it('invites the first item on an empty shelf', () => {
    const props = show([]);
    expect(screen.getByRole('heading', { name: 'Your shelf is empty' })).toBeInTheDocument();
    expect(screen.getByText(/It shows in your shop, and the chat/)).toBeInTheDocument();
    expect(screen.queryByText(/Shop tab/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Add your first item' }));
    expect(props.onAdd).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '+ Add item' })).toBeNull();
  });

  it('stops offering to add at the limit', () => {
    show(Array.from({ length: 60 }, (_u, i) => ({ ...items[1]!, id: `${i}`, name: `Item ${i}` })));
    expect(screen.queryByRole('button', { name: '+ Add item' })).toBeNull();
    expect(screen.getByText(/items is the most a shop holds/)).toBeInTheDocument();
  });
});
