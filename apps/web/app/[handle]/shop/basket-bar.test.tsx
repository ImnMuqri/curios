import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

  it('says what it is given under the count, in place of the default line', () => {
    writeBasket(defaultStorageKey('nadia'), [{ itemId: 'cookie', optionId: null, quantity: 1 }]);
    render(<BasketBar {...base} note="Pickup Sat 17 Oct" />);
    expect(screen.getByText('Pickup Sat 17 Oct')).toBeInTheDocument();
    expect(screen.queryByText('Still in your basket')).toBeNull();
  });
});

describe('BasketBar: the basket sheet', () => {
  const fill = () =>
    writeBasket(defaultStorageKey('nadia'), [
      { itemId: 'cake', optionId: 'k1', quantity: 1 },
      { itemId: 'cookie', optionId: null, quantity: 2 },
    ]);
  const openSheet = () => fireEvent.click(screen.getByRole('button', { name: /3 items · RM145/ }));

  it('opens from the count, with each line, the total and checkout', () => {
    fill();
    render(<BasketBar {...base} />);
    openSheet();
    const sheet = within(screen.getByRole('dialog', { name: 'Your basket' }));
    expect(sheet.getByText('Kek Batik')).toBeInTheDocument();
    expect(sheet.getByText('1kg · RM95 each')).toBeInTheDocument();
    expect(sheet.getByText('RM145')).toBeInTheDocument();
    expect(sheet.getByRole('link', { name: 'Checkout' })).toHaveAttribute('href', '/nadia/shop/checkout');
  });

  it('changes the basket from the sheet, and the bar follows', () => {
    fill();
    render(<BasketBar {...base} />);
    openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'One more: Cookies' }));
    expect(screen.getByRole('button', { name: /4 items · RM170/ })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'One less: Kek Batik' }));
    expect(screen.queryByText('Kek Batik')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3 items · RM75/ })).toBeInTheDocument();
  });

  it('closes on a tap outside it, on Escape, and on its close button, but not on a tap inside it', () => {
    fill();
    render(<BasketBar {...base} />);
    openSheet();
    fireEvent.click(screen.getByRole('heading', { name: 'Your basket' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    openSheet();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close basket' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes by itself when the last line is taken out, and the bar goes with it', () => {
    writeBasket(defaultStorageKey('nadia'), [{ itemId: 'cookie', optionId: null, quantity: 1 }]);
    const { container } = render(<BasketBar {...base} />);
    fireEvent.click(screen.getByRole('button', { name: /1 item · RM25/ }));
    fireEvent.click(screen.getByRole('button', { name: 'One less: Cookies' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('has no sheet in the Store preview, whose bar is a picture inside the phone', () => {
    fill();
    window.sessionStorage.setItem('preview-key', window.sessionStorage.getItem(defaultStorageKey('nadia'))!);
    render(<BasketBar {...base} preview={{ storageKey: 'preview-key', onCheckout: () => {} }} />);
    expect(screen.queryByRole('button', { name: /3 items/ })).not.toBeInTheDocument();
    expect(screen.getByText('3 items · RM145')).toBeInTheDocument();
  });
});
