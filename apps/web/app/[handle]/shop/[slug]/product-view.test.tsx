import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductView } from './product-view.js';
import { defaultStorageKey, readBasket, writeBasket } from '../basket.js';

const cake = {
  id: 'cake',
  name: 'Kek Coklat Moist',
  slug: 'kek-coklat-moist',
  category: 'Kek',
  tag: 'Best seller',
  description: 'Rich and moist, with a ganache top.',
  photoKey: 'x.webp',
  photoUrl: 'https://cdn.test/x.webp',
  priceCents: null,
  options: [
    { id: 'k1', label: '1kg', priceCents: 9500 },
    { id: 'k2', label: '2kg', priceCents: 17000 },
  ],
};
const cookie = { ...cake, id: 'cookie', name: 'Cookies', slug: 'cookies', tag: null, description: null, photoKey: null, photoUrl: null, priceCents: 2500, options: [] };

const base = {
  handle: 'keklina',
  displayName: 'Kek Lina',
  language: 'en',
  item: cake,
  items: [cake, cookie],
  halal: false,
  noticeDays: 2,
  nextDay: '2026-10-17' as string | null,
  pickup: true,
  onDone: vi.fn(),
};

const key = defaultStorageKey('keklina');
beforeEach(() => {
  window.sessionStorage.clear();
  base.onDone.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('ProductView', () => {
  it('shows the photo, tag, name, price and description', () => {
    const { container } = render(<ProductView {...base} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/x.webp');
    expect(screen.getByText('Best seller')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Kek Coklat Moist' })).toBeInTheDocument();
    expect(screen.getByTestId('price')).toHaveTextContent('RM95');
    expect(screen.getByText('Rich and moist, with a ganache top.')).toBeInTheDocument();
  });

  it('shows an initial when there is no photo, and no tag or sizes that are not there', () => {
    const { container } = render(<ProductView {...base} item={cookie} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.queryByText('Best seller')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByTestId('price')).toHaveTextContent('RM25');
  });

  it('has a top bar: back to the shop, the shop’s name, the basket with its count', () => {
    writeBasket(key, [
      { itemId: 'cookie', optionId: null, quantity: 2 },
      { itemId: 'gone', optionId: null, quantity: 5 },
    ]);
    render(<ProductView {...base} />);
    expect(screen.getByRole('link', { name: 'Back to the shop' })).toHaveAttribute('href', '/keklina/shop');
    expect(screen.getByText('Kek Lina’s shop')).toBeInTheDocument();
    const basket = screen.getByRole('link', { name: 'Basket' });
    expect(basket).toHaveAttribute('href', '/keklina/shop/checkout');
    expect(basket).toHaveTextContent('2');
  });

  it('shows no count on an empty basket', () => {
    render(<ProductView {...base} />);
    expect(screen.getByRole('link', { name: 'Basket' })).toHaveTextContent('');
  });

  it('changes the price with the chosen size card', async () => {
    const user = userEvent.setup();
    render(<ProductView {...base} />);
    expect(screen.getByRole('radio', { name: /1kg/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: /2kg/ }));
    expect(screen.getByRole('radio', { name: /2kg/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('price')).toHaveTextContent('RM170');
    expect(screen.getByRole('button', { name: 'Add to basket · RM170' })).toBeInTheDocument();
  });

  it('says how much notice it needs and the earliest day', () => {
    render(<ProductView {...base} />);
    expect(screen.getByText('Needs 2 days. Earliest pickup Sat 17 Oct.')).toBeInTheDocument();
  });

  it('says delivery for a shop that only delivers, and drops what it cannot promise', () => {
    const { rerender } = render(<ProductView {...base} pickup={false} />);
    expect(screen.getByText('Needs 2 days. Earliest delivery Sat 17 Oct.')).toBeInTheDocument();
    rerender(<ProductView {...base} nextDay={null} />);
    expect(screen.getByText('Needs 2 days.')).toBeInTheDocument();
    rerender(<ProductView {...base} noticeDays={0} />);
    expect(screen.getByText('Earliest pickup Sat 17 Oct.')).toBeInTheDocument();
    rerender(<ProductView {...base} noticeDays={0} nextDay={null} />);
    expect(screen.queryByText(/Earliest|Needs/)).toBeNull();
  });

  it('says halal only when the shop does', () => {
    const { rerender } = render(<ProductView {...base} />);
    expect(screen.queryByText(/Halal/)).toBeNull();
    rerender(<ProductView {...base} halal />);
    expect(screen.getByText('Halal ingredients.')).toBeInTheDocument();
  });

  it('sends "Ask about this" to the page’s Ask tab with the question typed in', () => {
    render(<ProductView {...base} />);
    const ask = screen.getByRole('link', { name: /Ask about this/ });
    const href = ask.getAttribute('href') ?? '';
    expect(href.startsWith('/keklina?q=')).toBe(true);
    expect(href.endsWith('#ask')).toBe(true);
    expect(new URL(href, 'https://x.test').searchParams.get('q')).toBe('I have a question about Kek Coklat Moist.');
    expect(screen.getByText('What’s in it? Is it OK for kids?')).toBeInTheDocument();
  });

  it('steps the quantity, never below one, and prices the button by it', async () => {
    const user = userEvent.setup();
    render(<ProductView {...base} item={cookie} />);
    await user.click(screen.getByRole('button', { name: 'One less' }));
    expect(screen.getByTestId('qty')).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: 'One more' }));
    await user.click(screen.getByRole('button', { name: 'One more' }));
    expect(screen.getByTestId('qty')).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Add to basket · RM75' })).toBeInTheDocument();
  });

  it('adds the chosen size and quantity to the shop’s basket, says so, and goes back to the shop', async () => {
    const user = userEvent.setup();
    writeBasket(key, [{ itemId: 'cake', optionId: 'k2', quantity: 1 }]);
    render(<ProductView {...base} />);
    await user.click(screen.getByRole('radio', { name: /2kg/ }));
    await user.click(screen.getByRole('button', { name: 'One more' }));
    await user.click(screen.getByRole('button', { name: 'Add to basket · RM340' }));
    expect(readBasket(key)).toEqual([{ itemId: 'cake', optionId: 'k2', quantity: 3 }]);
    expect(screen.getByRole('status')).toHaveTextContent('Kek Coklat Moist added. 3 in basket.');
    expect(base.onDone).toHaveBeenCalledTimes(1);
    // The page is about to be left, so it leaves the line for the shop to say.
    expect(window.sessionStorage.getItem('curios-added:keklina')).toBe('Kek Coklat Moist added. 3 in basket.');
  });

  it('keeps the arrow keys inside the size cards, one tab stop', async () => {
    const user = userEvent.setup();
    render(<ProductView {...base} />);
    expect(screen.getByRole('radio', { name: /1kg/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: /2kg/ })).toHaveAttribute('tabindex', '-1');
    screen.getByRole('radio', { name: /1kg/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /2kg/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /2kg/ })).toHaveFocus();
  });

  it('hides the initial from a screen reader', () => {
    render(<ProductView {...base} item={cookie} />);
    expect(screen.getByText('C')).toHaveAttribute('aria-hidden', 'true');
  });

  it('adds an item with no sizes with no option', async () => {
    const user = userEvent.setup();
    render(<ProductView {...base} item={cookie} />);
    await user.click(screen.getByRole('button', { name: 'Add to basket · RM25' }));
    expect(readBasket(key)).toEqual([{ itemId: 'cookie', optionId: null, quantity: 1 }]);
  });

  it('speaks Malay on a Malay page', () => {
    render(<ProductView {...base} language="ms" halal />);
    expect(screen.getByRole('link', { name: 'Kembali ke kedai' })).toBeInTheDocument();
    expect(screen.getByText('Kedai Kek Lina')).toBeInTheDocument();
    expect(screen.getByText('Perlu 2 hari. Awal ambil Sab 17 Okt.')).toBeInTheDocument();
    expect(screen.getByText('Bahan halal.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Masuk bakul · RM95' })).toBeInTheDocument();
  });

  it('writes the preview’s own basket and stays put when it is inline', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<ProductView {...base} inline storageKey="curios-store-preview" onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'Add to basket · RM95' }));
    expect(readBasket('curios-store-preview')).toHaveLength(1);
    expect(window.sessionStorage.getItem('curios-added:keklina')).toBeNull();
    expect(readBasket(key)).toHaveLength(0);
    expect(onDone).toHaveBeenCalled();
  });

  it('sends the preview’s back arrow to onDone instead of leaving', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<ProductView {...base} inline onDone={onDone} />);
    await user.click(screen.getByRole('link', { name: 'Back to the shop' }));
    expect(onDone).toHaveBeenCalled();
  });
});
