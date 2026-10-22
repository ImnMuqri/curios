import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShopPageView } from './shop-page.js';
import { defaultStorageKey, readBasket, writeBasket } from './basket.js';
import { shopCopy } from './copy.js';

const items = [
  { id: 'cake', name: 'Kek Batik', slug: 'kek-batik', category: 'Kek', tag: 'Best seller', description: null, photoKey: null, photoUrl: null, priceCents: null, options: [{ id: 'k1', label: '1kg', priceCents: 9500 }, { id: 'k2', label: '2kg', priceCents: 17000 }] },
  { id: 'tart', name: 'Tart nenas', slug: 'tart-nenas', category: 'Raya', tag: null, description: null, photoKey: 'x.webp', photoUrl: 'https://cdn.test/x.webp', priceCents: 4500, options: [] },
  { id: 'cookie', name: 'Cookies balang', slug: 'cookies-balang', category: 'Kek', tag: null, description: null, photoKey: null, photoUrl: null, priceCents: 2500, options: [] },
];

const base = {
  handle: 'keklina',
  displayName: 'Kek Lina',
  language: 'en',
  items,
  pickupEnabled: true,
  pickupNote: 'Seksyen 7, Shah Alam' as string | null,
  deliveryMode: 'FLAT' as const,
  canTakeOrders: true,
  nextDay: '2026-10-17' as string | null,
  description: 'Homemade cakes, baked fresh.' as string | null,
  halal: false,
};

const key = defaultStorageKey('keklina');
beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('ShopPageView', () => {
  it('has the top bar: back to the page, the shop address, share', () => {
    render(<ShopPageView {...base} />);
    expect(screen.getByRole('link', { name: 'Back to Kek Lina' })).toHaveAttribute('href', '/keklina');
    expect(screen.getByText('curios.my/keklina/shop')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share the shop' })).toBeInTheDocument();
  });

  it('shares through the Web Share API when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const user = userEvent.setup();
    render(<ShopPageView {...base} />);
    await user.click(screen.getByRole('button', { name: 'Share the shop' }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: 'Kek Lina', url: expect.stringContaining('/keklina/shop') }));
    Reflect.deleteProperty(navigator, 'share');
  });

  it('copies the link and says so when it cannot share', async () => {
    Reflect.deleteProperty(navigator, 'share');
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<ShopPageView {...base} />);
    await user.click(screen.getByRole('button', { name: 'Share the shop' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/keklina/shop'));
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('draws the sign: open for orders, the name, area, pickup or delivery, next pickup day', () => {
    render(<ShopPageView {...base} />);
    expect(screen.getByText('Open for orders')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Kek Lina' })).toBeInTheDocument();
    expect(screen.getByText('Seksyen 7, Shah Alam')).toBeInTheDocument();
    expect(screen.getByText('Pickup or delivery')).toBeInTheDocument();
    expect(screen.getByText('Next pickup Sat 17 Oct')).toBeInTheDocument();
  });

  it('leaves the area out when there is none, and says Pickup alone or Delivery alone', () => {
    const { rerender } = render(<ShopPageView {...base} pickupNote={null} deliveryMode="NONE" />);
    expect(screen.queryByText('Seksyen 7, Shah Alam')).toBeNull();
    expect(screen.getByText('Pickup')).toBeInTheDocument();
    rerender(<ShopPageView {...base} pickupEnabled={false} />);
    expect(screen.getByText('Delivery')).toBeInTheDocument();
    expect(screen.getByText('Next delivery Sat 17 Oct')).toBeInTheDocument();
  });

  it('says orders are paused, with no day, when the shop cannot take orders', () => {
    render(<ShopPageView {...base} canTakeOrders={false} nextDay={null} />);
    expect(screen.queryByText('Open for orders')).toBeNull();
    expect(screen.getByText(shopCopy('en').ordersPaused)).toBeInTheDocument();
    expect(screen.queryByText(/Next pickup/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Add / })).toHaveLength(3);
  });

  it('shows the owner note as a bubble with their initial and name, and no date', () => {
    render(<ShopPageView {...base} />);
    const note = screen.getByRole('note');
    expect(within(note).getByText('Homemade cakes, baked fresh.')).toBeInTheDocument();
    expect(within(note).getByText('K')).toBeInTheDocument();
    expect(within(note).getByText('Kek Lina')).toBeInTheDocument();
  });

  it('has no bubble without a note', () => {
    render(<ShopPageView {...base} description={null} />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('has category chips with counts, All first, and filters by them', async () => {
    const user = userEvent.setup();
    render(<ShopPageView {...base} />);
    const chips = within(screen.getByRole('group', { name: 'Categories' })).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['All3', 'Kek2', 'Raya1']);
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
    await user.click(chips[2]!);
    expect(chips[2]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Kek Batik')).toBeNull();
    expect(screen.getByText('Tart nenas')).toBeInTheDocument();
  });

  it('hides the chips when no item has a category', () => {
    render(<ShopPageView {...base} items={items.map((i) => ({ ...i, category: null }))} />);
    expect(screen.queryByRole('group', { name: 'Categories' })).toBeNull();
    expect(screen.getByText('Kek Batik')).toBeInTheDocument();
  });

  it('draws a card per item with the tag, name and price, "from" when it has options', () => {
    render(<ShopPageView {...base} />);
    expect(screen.getByText('Best seller')).toBeInTheDocument();
    expect(screen.getByText('from RM95')).toBeInTheDocument();
    expect(screen.getByText('RM45')).toBeInTheDocument();
    expect(document.querySelector('img[src="https://cdn.test/x.webp"]')).not.toBeNull();
  });

  it('adds the first option with the + and turns it into the count, across options', async () => {
    const user = userEvent.setup();
    render(<ShopPageView {...base} />);
    await user.click(screen.getByRole('button', { name: /^Add Kek Batik/ }));
    expect(readBasket(key)).toEqual([{ itemId: 'cake', optionId: 'k1', quantity: 1 }]);
    expect(screen.getByRole('button', { name: /^Add Kek Batik/ })).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: /^Add Kek Batik/ }));
    expect(screen.getByRole('button', { name: /^Add Kek Batik/ })).toHaveTextContent('2');
    act(() => writeBasket(key, [...readBasket(key), { itemId: 'cake', optionId: 'k2', quantity: 3 }]));
    expect(screen.getByRole('button', { name: /^Add Kek Batik/ })).toHaveTextContent('5');
  });

  it('labels the + with how many are in the basket, and announces a tap', async () => {
    const user = userEvent.setup();
    render(<ShopPageView {...base} />);
    expect(screen.getByRole('button', { name: 'Add Kek Batik' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Kek Batik' }));
    expect(screen.getByRole('button', { name: 'Add Kek Batik, 1 in basket' })).toBeInTheDocument();
    expect(screen.getByText('Kek Batik added. 1 in basket.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Kek Batik, 1 in basket' }));
    expect(screen.getByRole('button', { name: 'Add Kek Batik, 2 in basket' })).toBeInTheDocument();
    expect(screen.getByText('Kek Batik added. 2 in basket.')).toBeInTheDocument();
  });

  it('does both in Malay', async () => {
    const user = userEvent.setup();
    render(<ShopPageView {...base} language="ms" />);
    await user.click(screen.getByRole('button', { name: 'Tambah Kek Batik' }));
    expect(screen.getByRole('button', { name: 'Tambah Kek Batik, 1 dalam bakul' })).toBeInTheDocument();
    expect(screen.getByText('Kek Batik ditambah. 1 dalam bakul.')).toBeInTheDocument();
  });

  it('adds an item with no options with a null option', async () => {
    const user = userEvent.setup();
    render(<ShopPageView {...base} />);
    await user.click(screen.getByRole('button', { name: 'Add Tart nenas' }));
    expect(readBasket(key)).toEqual([{ itemId: 'tart', optionId: null, quantity: 1 }]);
  });

  it('links the card’s name and photo to the product page, and opens no sheet', () => {
    render(<ShopPageView {...base} />);
    const name = screen.getByRole('link', { name: 'Kek Batik' });
    expect(name).toHaveAttribute('href', '/keklina/shop/kek-batik');
    expect(screen.getByRole('link', { name: 'Tart nenas' })).toHaveAttribute('href', '/keklina/shop/tart-nenas');
    const photo = document.querySelector('img[src="https://cdn.test/x.webp"]')?.closest('a');
    expect(photo).toHaveAttribute('href', '/keklina/shop/tart-nenas');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ends with "Want something not listed?" and a way to ask', () => {
    render(<ShopPageView {...base} />);
    expect(screen.getByText('Want something not listed?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask a question' })).toHaveAttribute('href', '/keklina#ask');
  });

  it('shows the empty state, and no chips or ask card, when there are no items', () => {
    render(<ShopPageView {...base} items={[]} />);
    expect(screen.getByText('New items are coming soon')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask Kek Lina' })).toHaveAttribute('href', '/keklina#ask');
    expect(screen.queryByText('Want something not listed?')).toBeNull();
  });

  it('marks a halal shop', () => {
    render(<ShopPageView {...base} halal />);
    expect(screen.getByText('Halal')).toBeInTheDocument();
  });

  it('speaks Malay on a Malay page', () => {
    render(<ShopPageView {...base} language="ms" />);
    expect(screen.getByText('Buka untuk tempahan')).toBeInTheDocument();
  });
});
