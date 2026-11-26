import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductView } from './product-view.js';
import { defaultStorageKey, readBasket } from '../basket.js';

const one = [
  { id: 'v', label: 'Vanilla', photoId: 'pv', photoKey: 'v.webp' },
  { id: 'c', label: 'Chocolate', photoId: null, photoKey: null },
  { id: 'r', label: 'Red velvet', photoId: null, photoKey: null },
];
const two = [
  { id: 's', label: '500g', photoId: null, photoKey: null },
  { id: 'l', label: '1kg', photoId: null, photoKey: null },
];
const combos = [
  { id: 'o1', label: 'Vanilla · 500g', oneId: 'v', twoId: 's', priceCents: 6000, available: false },
  { id: 'o2', label: 'Vanilla · 1kg', oneId: 'v', twoId: 'l', priceCents: 8000, available: true },
  { id: 'o3', label: 'Chocolate · 500g', oneId: 'c', twoId: 's', priceCents: 6500, available: true },
  { id: 'o4', label: 'Chocolate · 1kg', oneId: 'c', twoId: 'l', priceCents: 9000, available: false },
  { id: 'o5', label: 'Red velvet · 500g', oneId: 'r', twoId: 's', priceCents: 7000, available: false },
  { id: 'o6', label: 'Red velvet · 1kg', oneId: 'r', twoId: 'l', priceCents: 9500, available: false },
];
const onSale = combos.filter((c) => c.available).map((c) => ({ id: c.id, label: c.label, priceCents: c.priceCents }));

const cake = {
  id: 'cake',
  name: 'Kek',
  slug: 'kek',
  category: null,
  tag: null,
  description: null,
  photoKey: 'a.webp',
  photoUrl: 'https://cdn.test/a.webp',
  photoUrls: ['https://cdn.test/a.webp', 'https://cdn.test/v.webp'],
  photoKeys: ['a.webp', 'v.webp'],
  priceCents: null,
  options: onSale,
  choices: { groupOne: { name: 'Flavour', choices: one }, groupTwo: { name: 'Size', choices: two }, combos },
};
const base = { handle: 'k', displayName: 'Kek Lina', language: 'en', item: cake, items: [cake], halal: false, noticeDays: 0, nextDay: null, pickup: true, onDone: vi.fn() };

beforeEach(() => {
  window.sessionStorage.clear();
  Element.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe('ProductView choices', () => {
  it('preselects the first available combination and shows its price and the picked values', () => {
    render(<ProductView {...base} />);
    expect(screen.getByTestId('price')).toHaveTextContent('RM80');
    expect(screen.getByText('Flavour: Vanilla')).toBeInTheDocument();
    expect(screen.getByText('Size: 1kg')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Vanilla/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: '1kg' })).toBeChecked();
  });

  it('shows group one as photo tiles when one choice has a photo, group two as chips', () => {
    render(<ProductView {...base} />);
    const flavour = screen.getByRole('radiogroup', { name: /Flavour/ });
    expect(within(flavour).getByRole('radio', { name: /Vanilla/ }).querySelector('img')).toHaveAttribute('src', 'https://cdn.test/v.webp');
    expect(within(screen.getByRole('radiogroup', { name: /Size/ })).queryAllByRole('img')).toHaveLength(0);
  });

  it('greys a choice whose every combination is off and a group-two chip that is off for the pick', async () => {
    render(<ProductView {...base} />);
    expect(screen.getByRole('radio', { name: /Red velvet/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('radio', { name: /500g/ })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('radio', { name: /500g/ }));
    expect(screen.getByTestId('price')).toHaveTextContent('RM80');
    await userEvent.click(screen.getByRole('radio', { name: /Red velvet/ }));
    expect(screen.getByRole('radio', { name: /Vanilla/ })).toBeChecked();
  });

  it('moves group two to the first available when group one changes, and the price follows', async () => {
    render(<ProductView {...base} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Chocolate' }));
    expect(screen.getByRole('radio', { name: '500g' })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^1kg/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('price')).toHaveTextContent('RM65');
    expect(screen.getByText('Flavour: Chocolate')).toBeInTheDocument();
  });

  it('adds the picked combination by its option id', async () => {
    render(<ProductView {...base} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Chocolate' }));
    await userEvent.click(screen.getByRole('button', { name: /^Add/ }));
    expect(readBasket(defaultStorageKey('k'))).toMatchObject([{ itemId: 'cake', optionId: 'o3', quantity: 1 }]);
  });

  it('steps with arrow keys over the available choices only', async () => {
    render(<ProductView {...base} />);
    screen.getByRole('radio', { name: /Vanilla/ }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Chocolate' })).toBeChecked();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /Vanilla/ })).toBeChecked();
  });

  it('picking a choice with a photo shows that photo in the gallery', async () => {
    render(<ProductView {...base} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Chocolate' }));
    vi.mocked(Element.prototype.scrollTo).mockClear();
    await userEvent.click(screen.getByRole('radio', { name: /Vanilla/ }));
    expect(Element.prototype.scrollTo).toHaveBeenCalled();
  });

  it('uses chips for group one when no choice has a photo, and one group alone works', () => {
    const plain = { ...cake, choices: { groupOne: { name: 'Flavour', choices: one.map((c) => ({ ...c, photoKey: null, photoId: null })) }, groupTwo: null, combos: [{ id: 'a', label: 'Vanilla', oneId: 'v', twoId: null, priceCents: 5000, available: true }, { id: 'b', label: 'Chocolate', oneId: 'c', twoId: null, priceCents: 5500, available: true }, { id: 'c', label: 'Red velvet', oneId: 'r', twoId: null, priceCents: 6000, available: false }] }, options: [] };
    render(<ProductView {...base} item={plain} />);
    expect(screen.queryAllByRole('radiogroup')).toHaveLength(1);
    expect(screen.getByTestId('price')).toHaveTextContent('RM50');
    expect(document.querySelector('[role=radio] img')).toBeNull();
  });
});
