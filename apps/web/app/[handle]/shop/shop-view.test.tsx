import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShopView } from './shop-view.js';
import { shopCopy } from './copy.js';

const copy = shopCopy('en');

const items = [
  { id: 'cake', name: 'Kek Batik', slug: 'cake', category: null, tag: null, description: 'Chilled, with Marie biscuits.', photoKey: null, photoUrl: null, priceCents: null, options: [{ id: 'k1', label: '1kg', priceCents: 9500 }, { id: 'k2', label: '2kg', priceCents: 17000 }] },
  { id: 'cookie', name: 'Cookies balang', slug: 'cookie', category: null, tag: null, description: null, photoKey: null, photoUrl: null, priceCents: 2500, options: [] },
];

const base = {
  handle: 'nadia',
  displayName: 'Kek Lina',
  language: 'en',
  items,
  whatsapp: '60123456789' as string | null,
  pickupEnabled: true,
  pickupNote: null,
  deliveryMode: 'NONE' as const,
  deliveryFeeCents: null,
  minNoticeDays: 1,
  initialItemId: null as string | null,
};

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

async function addCake(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Kek Batik/ }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('radio', { name: /2kg/ }));
  fireEvent.change(within(dialog).getByLabelText(copy.quantity), { target: { value: '2' } });
  await user.click(within(dialog).getByRole('button', { name: copy.add }));
}

describe('ShopView', () => {
  it('shows each item with its price, "from" when it has options', () => {
    render(<ShopView {...base} />);
    expect(screen.getByText('Kek Batik')).toBeInTheDocument();
    expect(screen.getByText('from RM95')).toBeInTheDocument();
    expect(screen.getByText('RM25')).toBeInTheDocument();
  });

  it('says so when the shelf is empty', () => {
    render(<ShopView {...base} items={[]} />);
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
  });

  it('opens an item, adds a chosen option and quantity, and the basket bar totals it', async () => {
    const user = userEvent.setup();
    render(<ShopView {...base} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await addCake(user);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('2 in basket · RM340')).toBeInTheDocument();
  });

  it('has the item named by ?item= open on first render, and ignores an unknown one', () => {
    const { unmount } = render(<ShopView {...base} initialItemId="cake" />);
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Kek Batik' })).toBeInTheDocument();
    unmount();
    render(<ShopView {...base} initialItemId="gone" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the sheet as a modal, so Escape can close it, and that close leaves the sheet gone', () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, writable: true, value: showModal });
    try {
      render(<ShopView {...base} initialItemId="cake" />);
      expect(showModal).toHaveBeenCalledTimes(1);
      // What the browser fires when Escape (or dialog.close()) ends a modal dialog.
      fireEvent(screen.getByRole('dialog'), new Event('close'));
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      delete (HTMLDialogElement.prototype as unknown as Record<string, unknown>).showModal;
    }
  });

  // The Store editor's preview: a modal there would cover the editor itself.
  it('opens the sheet in place, not as a modal, when asked to', () => {
    const showModal = vi.fn();
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, writable: true, value: showModal });
    try {
      render(<ShopView {...base} initialItemId="cake" sheet="inline" />);
      expect(showModal).not.toHaveBeenCalled();
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('open');
      expect(dialog).toHaveAttribute('data-inline');
    } finally {
      delete (HTMLDialogElement.prototype as unknown as Record<string, unknown>).showModal;
    }
  });

  it('says what the shop is about, above the terms, when the owner has written it', () => {
    const { unmount } = render(<ShopView {...base} description="Homemade cakes, baked fresh." />);
    expect(screen.getByText('Homemade cakes, baked fresh.')).toBeInTheDocument();
    unmount();
    const { container } = render(<ShopView {...base} description={null} />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('closes the sheet from its Close button without adding anything', async () => {
    const user = userEvent.setup();
    render(<ShopView {...base} initialItemId="cookie" />);
    await user.click(screen.getByRole('button', { name: copy.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/in basket/)).toBeNull();
  });

  it('adds the same item and option twice as one line', async () => {
    const user = userEvent.setup();
    render(<ShopView {...base} />);
    await addCake(user);
    await addCake(user);
    expect(screen.getByText('4 in basket · RM680')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: copy.remove })).toHaveLength(1);
  });

  it('offers Checkout when orders are allowed, and Order on WhatsApp when they are not', async () => {
    const user = userEvent.setup();
    const open = render(<ShopView {...base} canTakeOrders />);
    await addCake(user);
    expect(screen.getByRole('link', { name: copy.checkout })).toHaveAttribute('href', '/nadia/shop/checkout');
    expect(screen.queryByRole('link', { name: copy.orderOnWhatsApp })).toBeNull();
    expect(screen.queryByText(copy.paused('Kek Lina'))).toBeNull();
    open.unmount();

    render(<ShopView {...base} canTakeOrders={false} />);
    expect(await screen.findByText(copy.paused('Kek Lina'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.orderOnWhatsApp }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/60123456789\?text=/);
    expect(screen.queryByRole('link', { name: copy.checkout })).toBeNull();
  });

  it('links Order on WhatsApp with the basket as the message', async () => {
    const user = userEvent.setup();
    render(<ShopView {...base} />);
    await addCake(user);
    const href = screen.getByRole('link', { name: copy.orderOnWhatsApp }).getAttribute('href') ?? '';
    expect(href.startsWith('https://wa.me/60123456789?text=')).toBe(true);
    expect(decodeURIComponent(href.split('?text=')[1] ?? '')).toBe("Hi Kek Lina, I'd like to order:\n• 2 × Kek Batik (2kg) — RM340\nTotal: RM340");
  });

  it('writes the message in the page language', async () => {
    const user = userEvent.setup();
    render(<ShopView {...base} language="ms" />);
    await user.click(screen.getByRole('button', { name: /Cookies/ }));
    await user.click(screen.getByRole('button', { name: shopCopy('ms').add }));
    const href = screen.getByRole('link', { name: shopCopy('ms').orderOnWhatsApp }).getAttribute('href') ?? '';
    expect(decodeURIComponent(href.split('?text=')[1] ?? '')).toBe('Hai Kek Lina, saya nak tempah:\n• 1 × Cookies balang — RM25\nJumlah: RM25');
  });

  it('with no WhatsApp number, offers no order link and says how to reach the shop', async () => {
    const user = userEvent.setup();
    render(<ShopView {...base} whatsapp={null} />);
    await addCake(user);
    expect(screen.queryByRole('link', { name: copy.orderOnWhatsApp })).toBeNull();
    expect(screen.getByText(copy.noWhatsApp('Kek Lina'))).toBeInTheDocument();
  });

  it('removes a basket line', async () => {
    const user = userEvent.setup();
    render(<ShopView {...base} />);
    await addCake(user);
    await user.click(screen.getByRole('button', { name: copy.remove }));
    expect(screen.queryByText(/in basket/)).toBeNull();
  });

  it('keeps the basket across a re-mount', async () => {
    const user = userEvent.setup();
    const first = render(<ShopView {...base} />);
    await addCake(user);
    first.unmount();
    render(<ShopView {...base} />);
    expect(await screen.findByText('2 in basket · RM340')).toBeInTheDocument();
  });

  it('keeps each shop\'s basket apart', async () => {
    const user = userEvent.setup();
    const first = render(<ShopView {...base} />);
    await addCake(user);
    first.unmount();
    render(<ShopView {...base} handle="someone-else" />);
    expect(screen.queryByText(/in basket/)).toBeNull();
  });

  it('never writes an empty basket over a saved one while loading it', async () => {
    window.sessionStorage.setItem('curios-basket:nadia', JSON.stringify([{ itemId: 'cookie', optionId: null, quantity: 1 }]));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<ShopView {...base} />);
    expect(await screen.findByText('1 in basket · RM25')).toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalledWith('curios-basket:nadia', '[]');
  });

  it('ignores a saved basket that is not a list', () => {
    window.sessionStorage.setItem('curios-basket:nadia', '{"a":1}');
    render(<ShopView {...base} />);
    expect(screen.getByText('Kek Batik')).toBeInTheDocument();
    expect(screen.queryByText(/in basket/)).toBeNull();
  });

  it('keeps the valid lines of a saved basket and drops the rest', async () => {
    window.sessionStorage.setItem(
      'curios-basket:nadia',
      JSON.stringify([null, 7, { itemId: 'cookie', optionId: null, quantity: 0 }, { itemId: 'cookie', optionId: null, quantity: 1.5 }, { itemId: 'cookie', optionId: null, quantity: 1 }]),
    );
    render(<ShopView {...base} />);
    expect(await screen.findByText('1 in basket · RM25')).toBeInTheDocument();
  });

  it('ignores a garbled saved basket', async () => {
    window.sessionStorage.setItem('curios-basket:nadia', '{not json');
    render(<ShopView {...base} />);
    expect(screen.getByText('Kek Batik')).toBeInTheDocument();
    expect(screen.queryByText(/in basket/)).toBeNull();
  });

  it('still works when sessionStorage throws', async () => {
    const blocked = vi.spyOn(window, 'sessionStorage', 'get');
    blocked.mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    render(<ShopView {...base} />);
    await addCake(user);
    expect(screen.getByText('2 in basket · RM340')).toBeInTheDocument();
  });

  it('links Back to the page', () => {
    render(<ShopView {...base} />);
    expect(screen.getByRole('link', { name: /Back/ })).toHaveAttribute('href', '/nadia');
  });

  it('states pickup, delivery and notice', () => {
    render(<ShopView {...base} pickupNote="Shah Alam" deliveryMode="FLAT" deliveryFeeCents={800} minNoticeDays={2} />);
    expect(screen.getByText('Pickup: Shah Alam')).toBeInTheDocument();
    expect(screen.getByText('Delivery: RM8')).toBeInTheDocument();
    expect(screen.getByText('Order at least 2 days ahead')).toBeInTheDocument();
  });

  it('hands the order message to onOrder instead of linking to WhatsApp, when asked to', async () => {
    const user = userEvent.setup();
    const onOrder = vi.fn();
    render(<ShopView {...base} onOrder={onOrder} showBack={false} />);
    await addCake(user);
    await user.click(screen.getByRole('button', { name: copy.orderOnWhatsApp }));
    expect(onOrder).toHaveBeenCalledWith(expect.stringContaining('Kek'));
    expect(screen.queryByRole('link', { name: copy.orderOnWhatsApp })).toBeNull();
    expect(screen.queryByRole('link', { name: /back/i })).toBeNull();
  });

  it('shows the order button with the given label, even with no WhatsApp number', async () => {
    const user = userEvent.setup();
    render(<ShopView {...base} whatsapp={null} onOrder={vi.fn()} orderLabel="See it" />);
    await addCake(user);
    expect(screen.getByRole('button', { name: 'See it' })).toBeInTheDocument();
    expect(screen.queryByText(copy.noWhatsApp('Kek Lina'))).toBeNull();
  });

  it('keeps its basket under the storage key it is given', async () => {
    const user = userEvent.setup();
    render(<ShopView {...base} storageKey="landing-demo" />);
    await addCake(user);
    expect(window.sessionStorage.getItem('landing-demo')).toContain('"quantity":2');
    expect(window.sessionStorage.getItem('curios-basket:nadia')).toBeNull();
  });

  it('marks itself embedded when asked, and as a page otherwise', () => {
    const { container, rerender } = render(<ShopView {...base} variant="embedded" />);
    expect(container.querySelector('[data-variant="embedded"]')).not.toBeNull();
    rerender(<ShopView {...base} />);
    expect(container.querySelector('[data-variant="embedded"]')).toBeNull();
  });
});
