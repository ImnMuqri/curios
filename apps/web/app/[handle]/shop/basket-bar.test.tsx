import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { BasketBar } from './basket-bar.js';
import { defaultStorageKey, writeBasket } from './basket.js';

const items = [
  { id: 'cake', name: 'Kek Batik', priceCents: null, options: [{ id: 'k1', label: '1kg', priceCents: 9500 }] },
  { id: 'cookie', name: 'Cookies', priceCents: 2500, options: [] },
];
const base = { handle: 'nadia', displayName: 'Kek Lina', language: 'en', items, canTakeOrders: true, whatsapp: '60123456789' as string | null };

beforeEach(() => window.sessionStorage.clear());

describe('BasketBar', () => {
  it('draws nothing while the basket is empty', () => {
    const { container } = render(<BasketBar {...base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows "N items · RM… · Checkout" and "Still in your basket" when the basket has something', () => {
    writeBasket(defaultStorageKey('nadia'), [
      { itemId: 'cake', optionId: 'k1', quantity: 1 },
      { itemId: 'cookie', optionId: null, quantity: 2 },
    ]);
    render(<BasketBar {...base} />);
    expect(screen.getByText('3 items · RM145')).toBeInTheDocument();
    expect(screen.getByText('Still in your basket')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Checkout' })).toHaveAttribute('href', '/nadia/shop/checkout');
  });

  it('prices from the shelf as it is now, dropping what is gone', () => {
    writeBasket(defaultStorageKey('nadia'), [
      { itemId: 'gone', optionId: null, quantity: 4 },
      { itemId: 'cookie', optionId: null, quantity: 1 },
    ]);
    render(<BasketBar {...base} />);
    expect(screen.getByText('1 item · RM25')).toBeInTheDocument();
  });

  it('follows the basket when it changes on the page', () => {
    const { container } = render(<BasketBar {...base} />);
    expect(container).toBeEmptyDOMElement();
    act(() => writeBasket(defaultStorageKey('nadia'), [{ itemId: 'cookie', optionId: null, quantity: 1 }]));
    expect(screen.getByText('1 item · RM25')).toBeInTheDocument();
  });

  it('a paused shop points at WhatsApp instead of checkout', () => {
    writeBasket(defaultStorageKey('nadia'), [{ itemId: 'cookie', optionId: null, quantity: 1 }]);
    render(<BasketBar {...base} canTakeOrders={false} />);
    expect(screen.queryByRole('link', { name: 'Checkout' })).toBeNull();
    expect(screen.getByText('Checkout is paused. Send your basket to Kek Lina on WhatsApp instead.')).toBeInTheDocument();
    const order = screen.getByRole('link', { name: 'Order on WhatsApp' });
    expect(order.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/60123456789\?text=/);
  });

  it('a paused shop with no WhatsApp says how to reach them', () => {
    writeBasket(defaultStorageKey('nadia'), [{ itemId: 'cookie', optionId: null, quantity: 1 }]);
    render(<BasketBar {...base} canTakeOrders={false} whatsapp={null} />);
    expect(screen.getByText('To order, contact Kek Lina through the links on their page.')).toBeInTheDocument();
  });
});
