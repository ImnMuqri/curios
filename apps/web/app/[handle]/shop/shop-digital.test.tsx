import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PHYSICAL_FACTS } from '@curios/core/digital';
import { ShopPageView } from './shop-page.js';
import { ProductView } from './[slug]/product-view.js';
import { defaultStorageKey, readBasket } from './basket.js';
import { shopCopy } from './copy.js';

const en = shopCopy('en');
const ms = shopCopy('ms');
const shelf = { category: null, tag: 'Raya', description: null, photoKey: null, photoUrl: null, options: [] };
const cake = { ...shelf, ...PHYSICAL_FACTS, id: 'cake', name: 'Kek batik', slug: 'cake', priceCents: 4500 };
const ebook = { ...shelf, ...PHYSICAL_FACTS, kind: 'DIGITAL' as const, delivery: 'FILES' as const, format: { kinds: ['PDF'], count: 2 }, id: 'ebook', name: 'Recipe e-book', slug: 'ebook', priceCents: 2500, category: 'Recipes' };
const voucher = { ...shelf, ...PHYSICAL_FACTS, kind: 'DIGITAL' as const, delivery: 'CODES' as const, soldOut: true, id: 'voucher', name: 'Gift voucher', slug: 'voucher', priceCents: 5000 };
const cls = {
  ...shelf,
  ...PHYSICAL_FACTS,
  kind: 'DIGITAL' as const,
  delivery: 'SESSION' as const,
  minutes: 90,
  place: 'ONLINE' as const,
  id: 'class',
  name: 'Online class',
  slug: 'class',
  priceCents: 6000,
  sessions: [
    { id: 't-full', startsAt: '2026-11-07T12:00:00.000Z', seatsLeft: 0 },
    { id: 't-open', startsAt: '2026-11-15T07:00:00.000Z', seatsLeft: 10 },
  ],
};

const shopBase = {
  handle: 'keklina',
  displayName: 'Kek Lina',
  language: 'en',
  items: [cake, ebook, voucher, cls],
  pickupEnabled: true,
  pickupNote: null,
  deliveryMode: 'NONE' as const,
  canTakeOrders: true,
  nextDay: null,
  description: null,
  halal: false,
};
const productBase = { handle: 'keklina', displayName: 'Kek Lina', language: 'en', items: [cake, ebook, cls], halal: false, noticeDays: 2, nextDay: '2026-10-17' as string | null, pickup: true, onDone: vi.fn() };
const key = defaultStorageKey('keklina');
beforeEach(() => {
  window.sessionStorage.clear();
  productBase.onDone.mockClear();
});

describe('the shop with digital items', () => {
  it('tags digital cards "Digital", gives them their own category, and filters by it', async () => {
    const user = userEvent.setup();
    render(<ShopPageView {...shopBase} />);
    const chips = screen.getByRole('group', { name: en.categories });
    expect(chips).toHaveTextContent('Digital3');
    // The owner's own category for a digital item is not shown beside it.
    expect(chips).not.toHaveTextContent('Recipes');
    expect(screen.getAllByText('Digital')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: /^Digital/ }));
    expect(screen.queryByText('Kek batik')).toBeNull();
    expect(screen.getByText('Recipe e-book')).toBeInTheDocument();
  });

  it('shows Sold out at zero codes, with no add button', () => {
    render(<ShopPageView {...shopBase} />);
    expect(screen.getByText(en.soldOut)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Gift voucher/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Recipe e-book' })).toBeInTheDocument();
  });

  it('says Sold out in Malay', () => {
    render(<ShopPageView {...shopBase} language="ms" />);
    expect(screen.getByText(ms.soldOut)).toBeInTheDocument();
  });
});

describe('the digital item page', () => {
  it('shows the tag, arrival text and format instead of notice days', () => {
    render(<ProductView {...productBase} item={ebook} />);
    expect(screen.getByText('Digital')).toBeInTheDocument();
    expect(screen.getByText(en.getLine('FILES'))).toBeInTheDocument();
    expect(screen.getByText('PDF, 2 files. Download up to 5 times.')).toBeInTheDocument();
    expect(screen.queryByText(/Needs 2 days/)).toBeNull();
  });

  it('offers "Pick a time" with seats left, full times disabled, and adds the picked time', async () => {
    const user = userEvent.setup();
    render(<ProductView {...productBase} item={cls} />);
    expect(screen.getByText(en.pickATime)).toBeInTheDocument();
    const full = screen.getByRole('radio', { name: /Sat 7 Nov, 8:00pm/ });
    expect(full).toBeDisabled();
    expect(full).toHaveTextContent(en.full);
    const open = screen.getByRole('radio', { name: /Sun 15 Nov, 3:00pm/ });
    expect(open).toHaveTextContent('10 seats left');
    expect(open).toBeChecked();
    await user.click(screen.getByRole('button', { name: en.addToBasket('RM60') }));
    expect(readBasket(key)).toEqual([{ itemId: 'class', optionId: null, quantity: 1, sessionId: 't-open' }]);
  });

  it('cannot add more seats than are left at the picked time', async () => {
    const user = userEvent.setup();
    render(<ProductView {...productBase} item={{ ...cls, sessions: [{ id: 'two', startsAt: '2026-11-15T07:00:00.000Z', seatsLeft: 2 }] }} />);
    const more = screen.getByRole('button', { name: en.oneMore });
    await user.click(more);
    await user.click(more);
    await user.click(more);
    expect(screen.getByTestId('qty')).toHaveTextContent('2');
  });

  it('shows Sold out in place of Add to basket, and times in Malay', () => {
    const { rerender } = render(<ProductView {...productBase} item={voucher} />);
    expect(screen.getByRole('button', { name: en.soldOut })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Add to basket/ })).toBeNull();
    rerender(<ProductView {...productBase} language="ms" item={cls} />);
    expect(screen.getByText(ms.pickATime)).toBeInTheDocument();
    expect(screen.getByText('Ahd 15 Nov, 15:00')).toBeInTheDocument();
    expect(screen.getByText('Penuh')).toBeInTheDocument();
  });
});
